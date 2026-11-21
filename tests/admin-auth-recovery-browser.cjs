// Real sign-in/recovery controls with synthetic Auth; no live accounts or emails.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("admin-auth-recovery");
const auth = `
let recoveryListeners=[],syntheticUser={id:h1,email:'organizer@example.invalid'},authUser=window.__authMode==='valid'||window.__existingSession?syntheticUser:null;
let recoveryEmitted=false;
window.__authWrites=[];window.__resetRequests=[];window.__signouts=[];window.__setupChecks=0;
client.auth.getUser=async()=>({data:{user:window.__switchedUser?{...syntheticUser,id:h2}:authUser},error:null});
client.auth.getSession=async()=>{
 const session=authUser?{user:authUser,access_token:'synthetic-auth-token',refresh_token:'synthetic-refresh-token'}:null;
 if(window.__authMode==='valid'&&!recoveryEmitted){recoveryEmitted=true;setTimeout(()=>recoveryListeners.forEach(fn=>fn('PASSWORD_RECOVERY',session)),0);}
 return {data:{session},error:null};
};
client.auth.onAuthStateChange=fn=>{recoveryListeners.push(fn);return {data:{subscription:{unsubscribe(){recoveryListeners=recoveryListeners.filter(x=>x!==fn);}}}};};
client.auth.resetPasswordForEmail=async(email,options)=>{
 window.__resetRequests.push({email,...options});
 if(window.__holdRequest)await new Promise(resolve=>window.__releaseRequest=resolve);
 if(window.__requestFailure){const status=window.__requestFailure;window.__requestFailure=0;return {error:{status,message:'Synthetic request error'}};}
 return {data:{},error:null};
};
client.auth.updateUser=async values=>{
 window.__authWrites.push(values);
 if(window.__holdUpdate)await new Promise(resolve=>window.__releaseUpdate=resolve);
 if(window.__updateFailure){const status=window.__updateFailure;window.__updateFailure=0;return {error:{status,message:'Synthetic update error'}};}
 return {data:{user:authUser},error:null};
};
client.auth.signOut=async options=>{
 window.__signouts.push(options);
 if(window.__signoutFailure){window.__signoutFailure=false;return {error:{message:'Synthetic signout failure'}};}
 authUser=null;recoveryListeners.forEach(fn=>fn('SIGNED_OUT',null));return {error:null};
};
client.auth.signInWithPassword=async()=>{authUser=window.__nextHeaderUser||syntheticUser;return {data:{user:authUser},error:null};};
const initialAuthRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='get_setup_status'){window.__setupChecks++;return window.__setupError?{error:{message:'Synthetic setup outage'}}:{data:{initialized:window.__setupInitialized!==false,setup_locked:window.__setupLocked===true}};}
 return initialAuthRpc(name,args);
};
`;
const realSdk = fs.readFileSync(require.resolve("@supabase/supabase-js").replace(/dist[\\/]main[\\/]index.js$/, "dist/umd/supabase.js"), "utf8");
const sdkUser = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "sdk-organizer@example.invalid" };
const otherSdkUser = { ...sdkUser, id: "22222222-2222-4222-8222-222222222222", email: "other-organizer@example.invalid" };
const sdkTokens = new Map();
function recoveryToken(user = sdkUser) {
  if (sdkTokens.has(user.id)) return sdkTokens.get(user.id);
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000) })).toString("base64url"),
    "synthetic-signature"].join(".");
  sdkTokens.set(user.id, token);
  return token;
}
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    async function device(mode = "none", width = 390, query = "", options = {}) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ mode, options }) => {
        if (window !== window.top) return;
        localStorage.setItem("rsvp-interface-language", "en");
        window.__authMode = mode;
        Object.assign(window, options);
      }, { mode, options });
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + auth);
      await page.route("**/version.json", route => route.fulfill({ json: { version: "0.9.0-alpha.8" } }));
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/" + query);
      await page.waitForFunction(() => window.__setupChecks > 0);
      return { page, context, errors };
    }
    const desktop = await device("none", 1160);
    const version = desktop.page.locator("#adminVersion");
    const identity = desktop.page.locator("#loggedInAs");
    await version.filter({ hasText: "v0.9.0-alpha.8" }).waitFor({ state: "attached" });
    assert.equal(await version.isVisible(), false, "release metadata alone does not show the version");
    async function signIn(email) {
      await desktop.page.locator("#loginEmail").fill(email);
      await desktop.page.locator("#loginPassword").fill("Synthetic admin password!");
      await desktop.page.locator("#loginForm button[type=submit]").click();
      await version.waitFor({ state: "visible" });
      assert.equal(await identity.textContent(), email);
    }
    await signIn("organizer@example.invalid");
    const nameBox = await identity.boundingBox(), versionBox = await version.boundingBox();
    assert.ok(versionBox.y >= nameBox.y + nameBox.height, "version sits directly below the login name");
    assert.ok(Math.abs(versionBox.x + versionBox.width - nameBox.x - nameBox.width) < 1, "version aligns with the login name");
    await desktop.page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(await version.isVisible(), false, "the compact phone header hides the version");
    await desktop.page.setViewportSize({ width: 1160, height: 1000 });
    await desktop.page.evaluate(() => document.dispatchEvent(new Event("rsvp:admin-access-lost")));
    await version.waitFor({ state: "hidden" });
    await desktop.page.evaluate(() => {
      window.__nextHeaderUser = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.invalid" };
    });
    await signIn("other@example.invalid");
    await desktop.page.locator("#logout").click();
    await desktop.page.locator("#loginPanel").waitFor({ state: "visible" });
    assert.equal(await version.isVisible(), false, "signing out hides the version");
    assert.deepEqual(desktop.errors, []);
    await desktop.context.close();

    const examplePassword = "Synthetic new passphrase!";
    for (const width of [390, 1160]) {
      const { page, context, errors } = await device("none", width);
      const login = page.locator("#loginPanel");
      await login.waitFor({ state: "visible" });
      for (const [id, name, autocomplete] of [["loginEmail", "username", "username"], ["loginPassword", "password", "current-password"]]) {
        assert.equal(await page.locator("#" + id).getAttribute("name"), name);
        assert.equal(await page.locator("#" + id).getAttribute("autocomplete"), autocomplete);
      }
      assert.equal(await page.locator("#adminSetupHelp").isVisible(), false, "configured installation hides setup link");
      await page.locator("#loginEmail").fill("organizer@example.invalid");
      await page.locator("#forgotPassword").click();
      assert.equal(await page.locator("#recoveryRequestEmail").inputValue(), "organizer@example.invalid");
      assert.equal(await login.isVisible(), false);
      await page.evaluate(() => window.__requestFailure = 503);
      await page.locator("#passwordRecoveryRequestForm button[type=submit]").click();
      await page.locator("#passwordRecoveryRequestStatus").filter({ hasText: "Could not request" }).waitFor();
      assert.equal(await page.locator("#passwordRecoveryRequestForm button[type=submit]").isEnabled(), true, "request failure can retry");
      await page.locator("#passwordRecoveryRequestForm button[type=submit]").click();
      await page.locator("#passwordRecoveryRequestStatus").filter({ hasText: "If an account matches" }).waitFor();
      const neutral = await page.locator("#passwordRecoveryRequestStatus").textContent();
      await page.evaluate(() => window.__requestFailure = 400);
      await page.locator("#passwordRecoveryRequestForm button[type=submit]").click();
      await page.waitForFunction(() => window.__resetRequests.length === 3);
      assert.equal(await page.locator("#passwordRecoveryRequestStatus").textContent(), neutral, "account-specific errors do not enumerate users");
      const request = await page.evaluate(() => window.__resetRequests[0]);
      assert.equal(request.redirectTo, "http://127.0.0.1:" + server.address().port + "/admin/");
      await page.locator("#cancelPasswordRecoveryRequest").click();
      await login.waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await context.close();

      const valid = await device("valid", width, "#access_token=synthetic&refresh_token=synthetic&type=recovery");
      const reset = valid.page.locator("#passwordRecoveryForm");
      await reset.waitFor({ state: "visible" });
      assert.equal(await valid.page.locator("#adminApp").isVisible(), false, "recovery never enters the dashboard");
      assert.equal(await valid.page.locator("#adminVersion").isVisible(), false, "recovery never shows the signed-in version");
      assert.equal(await valid.page.evaluate(() => window.__calls.some(call => call.name === "admin_load_data")), false);
      assert.equal(new URL(valid.page.url()).hash, "", "credentials stripped from URL");
      assert.equal(new URL(valid.page.url()).search, "?auth=recovery", "safe marker holds recovery gate through reload");
      assert.equal(await valid.page.locator("#recoveryEmail").inputValue(), "organizer@example.invalid");
      for (const id of ["recoveryPassword", "recoveryPasswordConfirm"])
        assert.equal(await valid.page.locator("#" + id).getAttribute("autocomplete"), "new-password");
      await valid.page.locator("#recoveryPassword").fill(examplePassword);
      await valid.page.locator("#recoveryPasswordConfirm").fill("Different synthetic phrase!");
      await reset.locator("button[type=submit]").click();
      assert.equal(await valid.page.evaluate(() => window.__authWrites.length), 0, "mismatch never writes");
      await valid.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
      await valid.page.evaluate(() => window.__updateFailure = 503);
      await reset.locator("button[type=submit]").click();
      await valid.page.locator("#passwordRecoveryStatus").filter({ hasText: "Could not save" }).waitFor();
      assert.equal(await valid.page.locator("#recoveryPassword").inputValue(), examplePassword, "failed save retains draft");
      await reset.locator("button[type=submit]").click();
      await valid.page.locator("#loginPanel").waitFor({ state: "visible" });
      assert.equal(await valid.page.locator("#recoveryPassword").inputValue(), "");
      assert.equal(await valid.page.locator("#recoveryPasswordConfirm").inputValue(), "");
      assert.equal(await valid.page.locator("#loginPassword").inputValue(), "");
      assert.equal(new URL(valid.page.url()).search, "");
      assert.deepEqual(await valid.page.evaluate(() => window.__signouts), [{ scope: "local" }]);
      assert.deepEqual(await valid.page.evaluate(() => window.__authWrites.map(write => Object.keys(write))), [["password"], ["password"]], "recovery changes no metadata/permissions");
      assert.equal(await valid.page.locator("#adminApp").isVisible(), false);
      assert.deepEqual(valid.errors, []);
      await valid.context.close();
    }
    for (const suffix of ["#error=access_denied&error_code=otp_expired", "?auth=recovery", "?auth=recovery&code=already-used"]) {
      const { page, context, errors } = await device("expired", 390, suffix);
      await page.locator("#passwordRecoveryStatus").filter({ hasText: "invalid, expired or already used" }).waitFor();
      assert.equal(await page.locator("#passwordRecoveryForm").isVisible(), false);
      assert.equal(await page.locator("#adminApp").isVisible(), false);
      assert.equal(await page.evaluate(() => window.__authWrites.length), 0);
      await page.locator("#requestAnotherReset").click();
      await page.locator("#recoveryRequestEmail").fill("organizer@example.invalid");
      await page.locator("#passwordRecoveryRequestForm button[type=submit]").click();
      await page.locator("#passwordRecoveryRequestStatus").filter({ hasText: "If an account matches" }).waitFor();
      await page.locator("#cancelPasswordRecoveryRequest").click();
      assert.deepEqual(await page.evaluate(() => window.__signouts), [{ scope: "local" }], "invalid recovery sessions are cleaned before sign-in");
      assert.deepEqual(errors, []);
      await context.close();
    }
    const switched = await device("valid", 390, "?auth=recovery#type=recovery");
    await switched.page.locator("#passwordRecoveryForm").waitFor({ state: "visible" });
    await switched.page.locator("#recoveryPassword").fill(examplePassword);
    await switched.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
    await switched.page.evaluate(() => window.__switchedUser = true);
    await switched.page.locator("#passwordRecoveryForm button[type=submit]").click();
    await switched.page.locator("#passwordRecoveryStatus").filter({ hasText: "invalid, expired or already used" }).waitFor();
    assert.equal(await switched.page.evaluate(() => window.__authWrites.length), 0, "changed Auth account never receives the reset");
    await switched.context.close();

    const cleanupFailure = await device("valid", 390, "?auth=recovery#type=recovery");
    await cleanupFailure.page.locator("#passwordRecoveryForm").waitFor({ state: "visible" });
    await cleanupFailure.page.evaluate(() => window.__signoutFailure = true);
    await cleanupFailure.page.locator("#cancelPasswordRecovery").click();
    await cleanupFailure.page.locator("#passwordRecoveryStatus").filter({ hasText: "Could not end" }).waitFor();
    assert.equal(await cleanupFailure.page.locator("#loginPanel").isVisible(), false, "failed cleanup cannot unlock sign-in/admin views");
    await cleanupFailure.page.locator("#cancelPasswordRecovery").click();
    await cleanupFailure.page.locator("#loginPanel").waitFor({ state: "visible" });
    await cleanupFailure.context.close();

    const pending = await device("valid", 390, "#type=recovery");
    await pending.page.locator("#passwordRecoveryForm").waitFor({ state: "visible" });
    await pending.page.locator("#recoveryPassword").fill(examplePassword);
    await pending.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
    await pending.page.evaluate(() => window.__holdUpdate = true);
    await pending.page.locator("#passwordRecoveryForm button[type=submit]").click();
    await pending.page.waitForFunction(() => window.__authWrites.length === 1);
    assert(await pending.page.locator("#passwordRecoveryForm button[type=submit]").isDisabled());
    assert(await pending.page.locator("#recoveryPassword").isDisabled());
    await pending.page.evaluate(() => document.querySelector("#passwordRecoveryForm").dispatchEvent(new Event("submit", { cancelable: true })));
    assert.equal(await pending.page.evaluate(() => window.__authWrites.length), 1, "pending save cannot submit twice");
    await pending.page.evaluate(() => window.__releaseUpdate());
    await pending.page.locator("#loginPanel").waitFor({ state: "visible" });
    await pending.context.close();

    const expiredWrite = await device("valid", 390, "#type=recovery");
    await expiredWrite.page.locator("#passwordRecoveryForm").waitFor({ state: "visible" });
    await expiredWrite.page.locator("#recoveryPassword").fill(examplePassword);
    await expiredWrite.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
    await expiredWrite.page.evaluate(() => window.__updateFailure = 401);
    await expiredWrite.page.locator("#passwordRecoveryForm button[type=submit]").click();
    await expiredWrite.page.locator("#passwordRecoveryStatus").filter({ hasText: "invalid, expired or already used" }).waitFor();
    assert.equal(await expiredWrite.page.locator("#passwordRecoveryForm").isVisible(), false);
    assert.equal(await expiredWrite.page.locator("#recoveryPassword").inputValue(), "");
    assert.equal(await expiredWrite.page.locator("#adminApp").isVisible(), false);
    await expiredWrite.context.close();

    const processed = await device("none", 390, "?auth=recovery", { __existingSession: true });
    await processed.page.locator("#passwordRecoveryStatus").filter({ hasText: "invalid, expired or already used" }).waitFor();
    assert.equal(await processed.page.locator("#adminApp").isVisible(), false, "processed-link reload cannot use its cached session to enter Admin");
    assert.equal(await processed.page.evaluate(() => window.__calls.some(call => call.name === "admin_load_data")), false);
    await processed.page.locator("#cancelPasswordRecovery").click();
    assert.deepEqual(await processed.page.evaluate(() => window.__signouts), [{ scope: "local" }]);
    await processed.context.close();

    const open = await device("none", 390, "", { __setupInitialized: false });
    await open.page.locator("#adminSetupLink").waitFor({ state: "visible" });
    await open.context.close();
    for (const flags of [{ __setupInitialized: false, __setupLocked: true }, { __setupError: true }]) {
      const closed = await device("none", 390, "", flags);
      assert.equal(await closed.page.locator("#adminSetupLink").isVisible(), false);
      await closed.context.close();
    }
    // Exercise the pinned 2.50.0 SDK's real URL parsing and deferred auth event.
    async function sdkDevice(suffix = "", language = "en") {
      const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
      const page = await context.newPage(), errors = [], calls = [], consoleErrors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if(message.type() === "error") consoleErrors.push(message.text()); });
      await page.addInitScript(language => { if (window === window.top) localStorage.setItem("rsvp-interface-language", language); }, language);
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.endsWith("/supabase.min.js"))
          return route.fulfill({ contentType: "application/javascript", body: realSdk + `
;(() => {
 const factory=window.supabase.createClient;
 window.supabase.createClient=(url,key,options)=>{
  const client=factory(url,key,options);
  if(options?.auth?.persistSession===false)window.__recoveryAuthClient=client;
  return client;
 };
})();` });
        if (url.origin === "http://127.0.0.1:54321") {
          const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Content-Type": "application/json" };
          if (request.method() === "OPTIONS") return route.fulfill({ headers, body: "{}" });
          calls.push({ method: request.method(), path: url.pathname, redirect: url.searchParams.get("redirect_to"), authorization: request.headers().authorization, body: request.postDataJSON() });
          if (url.pathname === "/rest/v1/rpc/get_setup_status")
            return route.fulfill({ headers, body: JSON.stringify({ initialized: true, setup_locked: true }) });
          if (url.pathname === "/rest/v1/rpc/get_language_configuration")
            return route.fulfill({ headers, body: JSON.stringify({ languages: [{ language_code: "en", display_name: "English", enabled: true, sort_order: 1 }, { language_code: "fo", display_name: "Føroyskt", enabled: true, sort_order: 2 }], default_language: "en", fallback_language: "en", translations: [] }) });
          if (url.pathname === "/auth/v1/user")
            return route.fulfill({ headers, body: JSON.stringify(request.headers().authorization === "Bearer " + recoveryToken(otherSdkUser) ? otherSdkUser : sdkUser) });
          if (url.pathname === "/auth/v1/token")
            return route.fulfill({ headers, body: JSON.stringify({ access_token: recoveryToken(otherSdkUser), refresh_token: "synthetic-other-refresh", token_type: "bearer", expires_in: 3600, user: otherSdkUser }) });
          if (url.pathname === "/auth/v1/recover")
            return route.fulfill({ headers, body: "{}" });
          if (url.pathname === "/auth/v1/logout")
            return route.fulfill({ status: 204, headers, body: "" });
          return route.fulfill({ status: 400, headers, body: JSON.stringify({ message: "Unexpected synthetic endpoint" }) });
        }
        return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
      });
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/" + suffix);
      return { context, page, errors, calls, consoleErrors };
    }
    const sdk = await sdkDevice("#" + new URLSearchParams({ type: "recovery", access_token: recoveryToken(), refresh_token: "synthetic-recovery-refresh", expires_in: "3600", token_type: "bearer" }));
    try {
      await sdk.page.locator("#passwordRecoveryForm").waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      console.error({ errors: sdk.errors, consoleErrors: sdk.consoleErrors, calls: sdk.calls,
        status: await sdk.page.locator("#passwordRecoveryStatus").textContent(),
        adminMessage: await sdk.page.locator("#adminMessage").textContent() });
      throw error;
    }
    assert.equal(await sdk.page.locator("#recoveryEmail").inputValue(), sdkUser.email);
    assert.equal(new URL(sdk.page.url()).hash, "");
    assert.equal(new URL(sdk.page.url()).search, "?auth=recovery");
    assert.equal(await sdk.page.locator("#adminApp").isVisible(), false);
    await sdk.page.locator("#recoveryPassword").fill(examplePassword);
    await sdk.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
    await sdk.page.locator("#passwordRecoveryForm button[type=submit]").click();
    await sdk.page.locator("#loginPanel").waitFor({ state: "visible" });
    assert.deepEqual(sdk.calls.filter(call => call.method === "PUT" && call.path === "/auth/v1/user").map(call => call.body),
      [{ password: examplePassword, code_challenge: null, code_challenge_method: null }]);
    assert(sdk.calls.some(call => call.path === "/auth/v1/logout"), "real SDK ends the recovery session");
    assert(!sdk.calls.some(call => call.path.includes("admin_load_data")), "real recovery session cannot load Admin data");
    assert.deepEqual(sdk.errors, []);
    await sdk.context.close();
    const sdkExpired = await sdkDevice("#error=access_denied&error_code=otp_expired&error_description=Expired");
    await sdkExpired.page.locator("#passwordRecoveryStatus").filter({ hasText: "invalid, expired or already used" }).waitFor();
    assert.equal(await sdkExpired.page.locator("#adminApp").isVisible(), false);
    assert.equal(new URL(sdkExpired.page.url()).hash, "");
    assert.deepEqual(sdkExpired.errors, []);
    await sdkExpired.context.close();
    const localized = await sdkDevice("#error=access_denied&error_code=otp_expired", "fo");
    await localized.page.waitForFunction(() => {
      const source = "This password reset link is invalid, expired or already used. Request a new link.";
      const expected = window.RSVP_I18N.t(source);
      return expected !== source && document.querySelector("#passwordRecoveryStatus").textContent === expected;
    });
    assert.equal(await localized.page.locator("#adminApp").isVisible(), false);
    assert.deepEqual(localized.errors, []);
    await localized.context.close();
    const sdkRequest = await sdkDevice();
    await sdkRequest.page.locator("#loginPanel").waitFor({ state: "visible" });
    await sdkRequest.page.locator("#forgotPassword").click();
    await sdkRequest.page.locator("#recoveryRequestEmail").fill(sdkUser.email);
    await sdkRequest.page.locator("#passwordRecoveryRequestForm button[type=submit]").click();
    await sdkRequest.page.locator("#passwordRecoveryRequestStatus").filter({ hasText: "If an account matches" }).waitFor();
    assert.equal(sdkRequest.calls.find(call => call.path === "/auth/v1/recover").redirect, "http://127.0.0.1:" + server.address().port + "/admin/");
    assert.deepEqual(sdkRequest.errors, []);
    await sdkRequest.context.close();
    const racing = await sdkDevice("#" + new URLSearchParams({ type: "recovery", access_token: recoveryToken(), refresh_token: "synthetic-recovery-refresh", expires_in: "3600", token_type: "bearer" }));
    await racing.page.locator("#passwordRecoveryForm").waitFor({ state: "visible" });
    assert.equal(await racing.page.evaluate(async () => (await window.RSVP.getClient().auth.getSession()).data.session), null,
      "recovery credentials never enter the normal persisted client");
    await racing.page.evaluate(() => {
      const auth = window.__recoveryAuthClient.auth;
      const update = auth.updateUser.bind(auth);
      auth.updateUser = async (...args) => {
        const lock = auth.lock;
        auth.lock = async (...lockArgs) => {
          window.__recoveryUpdateQueued = true;
          await new Promise(resolve => window.__releaseRecoveryLock = resolve);
          return lock(...lockArgs);
        };
        try { return await update(...args); } finally { auth.lock = lock; }
      };
    });
    await racing.page.locator("#recoveryPassword").fill(examplePassword);
    await racing.page.locator("#recoveryPasswordConfirm").fill(examplePassword);
    await racing.page.locator("#passwordRecoveryForm button[type=submit]").click();
    await racing.page.waitForFunction(() => window.__recoveryUpdateQueued);
    const otherLogin = await racing.page.evaluate(async email => {
      const result = await window.RSVP.getClient().auth.signInWithPassword({ email, password: "Synthetic other password!" });
      return { id: result.data.user?.id, error: result.error };
    }, otherSdkUser.email);
    assert.equal(otherLogin.id, otherSdkUser.id);
    assert.equal(otherLogin.error, null);
    await racing.page.evaluate(() => window.__releaseRecoveryLock());
    await racing.page.locator("#loginPanel").waitFor({ state: "visible" });
    const changedPassword = racing.calls.filter(call => call.method === "PUT" && call.path === "/auth/v1/user");
    assert.equal(changedPassword.length, 1);
    assert.equal(changedPassword[0].authorization, "Bearer " + recoveryToken(), "queued SDK update stays bound to recovery account A");
    const loggedOut = racing.calls.filter(call => call.path === "/auth/v1/logout");
    assert.equal(loggedOut.length, 1);
    assert.equal(loggedOut[0].authorization, "Bearer " + recoveryToken(), "recovery cleanup cannot revoke normal account B");
    assert.equal(await racing.page.evaluate(async () => (await window.RSVP.getClient().auth.getSession()).data.session.user.id), otherSdkUser.id);
    assert.equal(await racing.page.evaluate(() => JSON.stringify(localStorage).includes("synthetic-recovery-refresh")), false, "recovery refresh credentials remain memory-only");
    assert.deepEqual(racing.errors, []);
    await racing.context.close();
    console.log("PASS administrator password recovery: native AutoFill fields, neutral email requests/retry, fixed same-site redirect, recovery-only gate, mismatch/failure/retry, account isolation, session cleanup, expired/used links and guarded setup link at phone/wide widths.");
    console.log("PASS pinned Supabase SDK 2.50.0: actual recovery URL parsing/PASSWORD_RECOVERY timing, verified account, password update/logout, expired callback and exact approved reset redirect with synthetic HTTP endpoints.");
    console.log("PASS real-SDK account-switch race: recovery A's queued password update/logout remain token-bound to A while shared account B signs in; B session persists and recovery credentials never enter shared storage.");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

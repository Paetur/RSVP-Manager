// Real wizard against static files and synthetic SDK/gateway adapters. No live backend.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const { createDatabase } = require("./helpers/alpha-database.cjs");
async function checkManualAdministratorSql(sql, email) {
  const db = await createDatabase();
  const admin = "11111111-1111-4111-8111-111111111111";
  const duplicate = "22222222-2222-4222-8222-222222222222";
  const count = async () => (await db.query("SELECT count(*)::int AS count FROM public.admins")).rows[0].count;
  const reject = async pattern => {
    await assert.rejects(db.exec(sql), pattern);
    await db.exec("ROLLBACK");
    assert.equal(await count(), 0, "refused manual SQL leaves administrator access empty");
  };
  try {
    await reject(/Create and confirm exactly one matching Auth account/);
    await db.query("INSERT INTO auth.users VALUES($1,$2,NULL,'unchanged')", [admin, email]);
    await reject(/Create and confirm exactly one matching Auth account/);
    await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1", [admin]);
    await db.query("INSERT INTO auth.users VALUES($1,$2,now(),'unchanged')", [duplicate, email]);
    await reject(/Create and confirm exactly one matching Auth account/);
    await db.query("DELETE FROM auth.users WHERE id=$1", [duplicate]);
    await db.exec("INSERT INTO public.households(household_name,planning_group_id,language) VALUES('Existing synthetic household','general','en')");
    await reject(/event already contains data/);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.households")).rows[0].count, 1);
    await db.exec("DELETE FROM public.households WHERE household_name='Existing synthetic household'");
    await db.exec("INSERT INTO app_private.installation_state(installation_id,schema_version,release_version,installer_hash,site_url,initialized_at) SELECT installation_id,'20261114034908','0.9.0-alpha.7',repeat('f',64),'https://setup.example.invalid/',now() FROM app_private.backup_origin WHERE singleton");
    await reject(/First-time setup is closed/);
    await db.exec("DELETE FROM app_private.installation_state WHERE id");
    const auth = (await db.query("SELECT to_jsonb(u) AS account FROM auth.users u WHERE id=$1", [admin])).rows[0].account;
    await db.exec(sql);
    assert.equal(await count(), 1);
    const member = (await db.query("SELECT user_id,access_state,access_permissions FROM public.admins")).rows[0];
    assert.equal(member.user_id, admin);
    assert.equal(member.access_state, "active");
    assert.equal(member.access_permissions.preset, "full");
    assert.deepEqual((await db.query("SELECT to_jsonb(u) AS account FROM auth.users u WHERE id=$1", [admin])).rows[0].account, auth);
    await assert.rejects(db.exec(sql), /First-time setup is closed/);
    await db.exec("ROLLBACK");
    assert.equal(await count(), 1, "manual first-admin creation is closed after success");
  } finally {
    await db.close();
  }
}

const sdk = `window.__setupCalls=[];window.supabase={createClient:()=>({rpc:async(name)=>{window.__setupCalls.push(name);if(name==='get_setup_status')return window.__setupProbeFailure?{error:{message:'Synthetic checkpoint failure'}}:{data:{initialized:!!window.__setupLocked,setup_locked:!!window.__setupLocked},error:null};if(name==='get_public_event'&&window.__schemaFailure)return {error:{message:'Synthetic schema unavailable'}};return {data:name==='is_admin'?true:null,error:null}},functions:{invoke:async()=>({data:null,error:null})},auth:{signInWithPassword:async()=>({error:null})}})};`;
const server = http.createServer((req, res) => {
  let name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (name.startsWith("/event/")) name = name.slice(6);
  if (name === "/version.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        version: fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(),
      }),
    );
    return;
  }
  const file = path.resolve(root, "." + name);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    name.endsWith(".html")
      ? "text/html"
      : name.endsWith(".js")
        ? "application/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch();
    const origin = "http://127.0.0.1:" + server.address().port;
    for (const prefix of (process.env.RSVP_SETUP_GUARDS_ONLY ? [] : ["", "/event"]))
      for (const width of [390, 1160])
        for (const language of ["en", "de", "fo"]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
            acceptDownloads: true,
          });
          const errors = [];
          page.setDefaultTimeout(7000);
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript(
            (language) =>
              localStorage.setItem("rsvp-interface-language", language),
            language,
          );
          await page.addInitScript(sdk);
          await page.route("**/supabase.min.js", (r) =>
            r.fulfill({ contentType: "application/javascript", body: sdk }),
          );
          await page.route("**/functions/v1/**", (r) =>
            r.fulfill({ contentType: "application/json", body: "null" }),
          );
          await page.goto(origin + prefix + "/setup.html");
          await page.waitForFunction(() =>
            document
              .getElementById("setupSiteSecrets")
              .textContent.includes("RSVP_SITE_URL"),
          );
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            false,
          );
          await page.locator("[name=dbMode][value=new]").check();
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            true,
          );
          assert.equal(
            await page.locator("[name=databaseLocation]:checked").count(),
            0,
          );
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator('[data-step-panel="1"]').isVisible(),
            true,
          );
          await page.locator('[data-step="2"]').click();
          assert.equal(
            await page.locator('[data-step-panel="1"]').isVisible(),
            true,
          );
          assert.equal(
            await page.locator("[value=local]+strong").textContent(),
            { en: "Local", de: "Lokal", fo: "Lokalt" }[language],
          );
          await page.locator("[name=databaseLocation][value=local]").check();
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator("#newLocalInstructions").isVisible(),
            true,
          );
          assert.equal(
            await page.locator("#newCloudInstructions").isVisible(),
            false,
          );
          assert.equal(
            await page.locator("#setupDeploymentGuide").getAttribute("href"),
            "docs/LocalSetup.html",
          );
          assert.equal(
            await page.locator("#localStudioLink").getAttribute("href"),
            "http://127.0.0.1:54323/",
          );
          assert.equal(
            await page.locator("#setupUrl").getAttribute("placeholder"),
            "http://127.0.0.1:54321",
          );
          const installer = await page.request.get(
            origin + prefix + "/supabase/install.sql",
          );
          assert.equal(installer.status(), 200);
          assert.equal(
            await installer.text(),
            fs.readFileSync(path.join(root, "supabase/install.sql"), "utf8"),
          );
          if (prefix === "" && width === 390 && language === "en") {
            const pending = page.waitForEvent("download");
            await page.locator('[download="rsvp-install.sql"]').click();
            const download = await pending;
            assert.equal(download.suggestedFilename(), "rsvp-install.sql");
            assert.equal(
              fs.readFileSync(await download.path(), "utf8"),
              fs.readFileSync(path.join(root, "supabase/install.sql"), "utf8"),
            );
          }
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            "No phone overflow " +
              prefix +
              "/" +
              width +
              "/" +
              language +
              " " +
              JSON.stringify(
                await page.evaluate(() =>
                  [...document.querySelectorAll("main *,header *,footer *")]
                    .filter((el) => {
                      const r = el.getBoundingClientRect();
                      return r.width && r.right > innerWidth + 1;
                    })
                    .map((el) => ({
                      tag: el.tagName,
                      id: el.id,
                      class: el.className,
                      width: el.getBoundingClientRect().width,
                      right: el.getBoundingClientRect().right,
                    })),
                ),
              ),
          );
          for (const target of ["local", "cloud"]) {
            if (target === "cloud") {
              await page.locator('[data-step="1"]').click();
              await page
                .locator("[name=databaseLocation][value=cloud]")
                .check();
              await page.locator('[data-step="4"]').click();
              assert.equal(
                await page.locator('[data-step-panel="1"]').isVisible(),
                true,
                "Changing target invalidates verified access",
              );
              await page.locator('[data-step-panel="1"] [data-next]').click();
              assert.equal(
                await page.locator("#newCloudInstructions").isVisible(),
                true,
              );
              assert.equal(
                await page.locator("#newLocalInstructions").isVisible(),
                false,
              );
              assert.equal(
                await page
                  .locator("#setupDeploymentGuide")
                  .getAttribute("href"),
                "docs/StudioSetup.html",
              );
            }
            if (target === "cloud") {
              const states = {
                en: ["ON", "OFF", "ON"],
                de: ["EIN", "AUS", "EIN"],
                fo: ["TENDRAÐ", "SLØKT", "TENDRAÐ"],
              }[language];
              assert.deepEqual(
                (
                  await page
                    .locator("#cloudProjectSettings strong")
                    .allTextContents()
                ).map((text) => text.trim()),
                [
                  "Enable Data API: " + states[0],
                  "Automatically expose new tables: " + states[1],
                  "Enable automatic RLS: " + states[2],
                ],
              );
            }
            assert.equal(
              await page.locator("#setupServerPrerequisites").isVisible(),
              true,
            );
            for (const id of [
              "setupSiteSecrets",
              "setupAuthURLs",
              "setupDeploymentGuide",
            ]) {
              assert.equal(
                await page.locator("#" + id).isVisible(),
                true,
                id + " must be available before Test connection",
              );
              assert.equal(
                await page
                  .locator("#" + id)
                  .evaluate(
                    (el) => el.closest("[data-step-panel]").dataset.stepPanel,
                  ),
                "2",
              );
            }
            assert.equal(
              await page.locator("[data-setup-local]").isVisible(),
              target === "local",
            );
            assert.equal(
              await page.locator("[data-setup-cloud]").isVisible(),
              target === "cloud",
            );
            assert.ok(
              (await page.locator("#setupSiteSecrets").textContent()).includes(
                origin + prefix + "/",
              ),
            );
            assert.ok(
              (await page.locator("#setupAuthURLs").textContent()).includes(
                origin + prefix + "/admin/?admin-invitation=1",
              ),
            );
            assert.ok(
              await page
                .locator("#setupServerPrerequisites")
                .evaluate(
                  (el) =>
                    !!(
                      el.compareDocumentPosition(
                        document.getElementById("connectForm"),
                      ) & Node.DOCUMENT_POSITION_FOLLOWING
                    ),
                ),
            );
            assert.ok(
              (await page.locator("#setupHostingHelp").textContent()).includes(
                "GitHub Pages",
              ),
            );
            await page.locator("#setupUrl").fill("https://synthetic.invalid");
            await page.locator("#setupKey").fill("sb_publishable_synthetic");
            await page.locator("#connectForm button[type=submit]").click();
            await page.locator('[data-step-panel="3"]:not(.hidden)').waitFor();
            assert.equal(await page.locator("#adminSetupHelp a").isVisible(), true, "the companion option remains available");
            if (!await page.locator("#manualAdministratorSetup").evaluate(node => node.open))
              await page.locator("#manualAdministratorSetup > summary").click();
            await page.locator("#bootstrapEmail").fill("invalid");
            await page.locator("#makeBootstrap").click();
            assert.equal(await page.locator("#bootstrapSql").inputValue(), "");
            const manualEmail = "owner.o'reilly+$rsvp_first_admin$@example.invalid";
            await page.locator("#bootstrapEmail").fill(manualEmail);
            await page.locator("#makeBootstrap").click();
            await page.waitForFunction(() => document.getElementById("bootstrapSql").value.endsWith("COMMIT;"));
            const manualSql = await page.locator("#bootstrapSql").inputValue();
            await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
            await page.locator("#copyBootstrap").click();
            assert.equal(await page.locator("#bootstrapSql").inputValue(), manualSql, "unavailable clipboard retains selectable SQL");
            assert.ok(manualSql.includes("owner.o''reilly+$rsvp_first_admin$@example.invalid"), "apostrophes are escaped without interpolating email into a dollar-quoted block");
            if (target === "local" && prefix === "" && width === 390 && language === "en")
              await checkManualAdministratorSql(manualSql, manualEmail);
            await page.locator("#bootstrapEmail").fill("changed@example.invalid");
            assert.equal(await page.locator("#bootstrapSql").inputValue(), "", "editing the email discards stale SQL");
            await page
              .locator("#setupAdminEmail")
              .fill("synthetic@example.invalid");
            await page
              .locator("#setupAdminPassword")
              .fill("synthetic-test-password");
            await page.locator("#setupLoginForm button[type=submit]").click();
            await page.locator('[data-step-panel="4"]:not(.hidden)').waitFor();
            assert.equal(
              await page
                .locator('[data-step-panel="4"] #setupServerPrerequisites')
                .count(),
              0,
            );
            assert.equal(
              await page.locator("#setupPagesInstructions li").count(),
              4,
            );
            const publishHelp = await page
              .locator('[data-step-panel="4"]')
              .textContent();
            for (const variable of [
              "RSVP_SUPABASE_URL",
              "RSVP_PUBLISHABLE_KEY",
              "js/config.js",
            ])
              assert.ok(publishHelp.includes(variable));
            assert.equal(
              await page.locator("#setupSiteSecrets").isVisible(),
              false,
            );
            if (
              target === "cloud" &&
              prefix === "" &&
              width === 390 &&
              language === "en"
            ) {
              const pending = page.waitForEvent("download");
              await page.locator("#downloadConfig").click();
              const download = await pending;
              assert.equal(download.suggestedFilename(), "config.js");
              const config = fs.readFileSync(await download.path(), "utf8");
              assert.ok(config.includes("https://synthetic.invalid"));
              assert.ok(config.includes("sb_publishable_synthetic"));
              assert.ok(
                !config.includes("RSVP_SITE_ORIGIN"),
                "Server settings stay separate from browser configuration",
              );
            }
          }
          await page.locator('[data-step="1"]').click();
          await page.locator("[name=dbMode][value=existing]").check();
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            false,
          );
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator("#newDatabaseInstructions").isVisible(),
            false,
          );
          await page.evaluate(() => (window.__schemaFailure = true));
          await page.locator("#connectForm button[type=submit]").click();
          await page.waitForFunction(() =>
            document
              .getElementById("setupStatus")
              .textContent.includes("Synthetic schema unavailable"),
          );
          await page.locator('[data-step="3"]').click();
          assert.equal(
            await page.locator('[data-step-panel="2"]').isVisible(),
            true,
          );
          assert.ok(
            (await page.evaluate(() => window.__setupCalls)).every((name) =>
              ["get_public_event", "is_admin", "get_setup_status"].includes(name),
            ),
            "Only public setup probes/login checks are called",
          );
          assert.deepEqual(errors, []);
          await page.close();
        }
    for (const failure of [false,true]) for (const suffix of ["","?manual=1"]) {
      const page=await browser.newPage({viewport:{width:390,height:900}});
      await page.addInitScript(sdk + ';window.__setupLocked=true;window.__setupProbeFailure='+JSON.stringify(failure)+';window.RSVP_CONFIG={supabaseUrl:"https://setup.example.invalid",supabaseKey:"sb_publishable_synthetic"};');
      await page.route("**/supabase.min.js",route=>route.fulfill({contentType:"application/javascript",body:sdk}));
      await page.goto(origin+"/setup.html"+suffix);
      await page.locator(failure?"#setupProbeFailure:not(.hidden)":"#setupClosed:not(.hidden)").waitFor();
      assert.equal(await page.locator(".steps:visible,.wizard-step:visible").count(),0,"closed/error checkpoint hides every setup mutation path");
      assert.equal(await page.locator("#manualAdministratorSetup").isVisible(),false,"closed/error checkpoint hides manual SQL setup");
      assert.equal(await page.locator("#bootstrapSql").inputValue(),"","closed/error checkpoint cannot generate administrator SQL");
      assert.equal(await page.locator("#setupCompanionEntry").isVisible(),false);
      assert.deepEqual(await page.evaluate(()=>window.__setupCalls.filter(name=>name!=="get_language_configuration")),["get_setup_status"]);
      if(failure)assert(await page.locator("#setupRetry").isVisible());
      await page.close();
    }
    const installedConfig={supabaseUrl:"https://installed.example.invalid",supabaseKey:"sb_publishable_installed"},
      otherConfig={supabaseUrl:"https://other.example.invalid",supabaseKey:"sb_publishable_other"};
    for(const suffix of ["","?manual=1"]) {
      const page=await browser.newPage({viewport:{width:390,height:900}});
      const captureSdk=sdk+';window.__setupClientURLs=[];const originalCreate=window.supabase.createClient;window.supabase.createClient=(url,...args)=>{window.__setupClientURLs.push(url);return originalCreate(url,...args);};';
      await page.addInitScript(captureSdk+';window.__setupLocked=true;window.RSVP_CONFIG='+JSON.stringify(installedConfig)+';');
      await page.route("**/supabase.min.js",route=>route.fulfill({contentType:"application/javascript",body:captureSdk}));
      await page.goto(origin+"/setup.html"+suffix+"#connection="+encodeURIComponent(JSON.stringify(otherConfig)));
      await page.locator("#setupProbeFailure:not(.hidden)").waitFor();
      assert.equal(new URL(page.url()).hash,"","handoff payload is cleared immediately");
      assert.deepEqual(await page.evaluate(()=>window.RSVP.config()),installedConfig,"configured installation cannot be overridden by another companion handoff");
      assert((await page.evaluate(()=>window.__setupClientURLs)).every(url=>url===installedConfig.supabaseUrl),"no client or backend request targets the handoff project");
      assert(!(await page.evaluate(()=>JSON.stringify({...localStorage}))).includes(otherConfig.supabaseKey));
      assert.equal(await page.locator(".steps:visible,.wizard-step:visible").count(),0);
      await page.close();
    }
    for(const failure of [false,true]) {
      const page=await browser.newPage();
      await page.addInitScript(sdk+';window.__setupLocked=true;window.__setupProbeFailure='+JSON.stringify(failure)+';window.RSVP_CONFIG='+JSON.stringify(installedConfig)+';');
      await page.route("**/supabase.min.js",route=>route.fulfill({contentType:"application/javascript",body:sdk}));
      await page.goto(origin+"/setup.html#connection="+encodeURIComponent(JSON.stringify(installedConfig)));
      await page.locator(failure?"#setupProbeFailure:not(.hidden)":"#setupClosed:not(.hidden)").waitFor();
      assert.deepEqual(await page.evaluate(()=>window.RSVP.config()),installedConfig,"same-config handoff retains checkpoint and never rewrites connection");
      assert.equal(new URL(page.url()).hash,"");
      await page.close();
    }
    {
      const page=await browser.newPage();
      await page.addInitScript(sdk);
      await page.route("**/supabase.min.js",route=>route.fulfill({contentType:"application/javascript",body:sdk}));
      await page.route(origin+"/admin/",route=>route.fulfill({contentType:"text/html",body:'<p id="handoffSignIn">Sign in</p>'}));
      await page.goto(origin+"/setup.html#connection="+encodeURIComponent(JSON.stringify(otherConfig)));
      await page.locator("#handoffSignIn").waitFor();
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rsvp-manager-setup:'+new URL('../',location.href).href)));
      assert.deepEqual(saved,otherConfig,"unconfigured website accepts public companion configuration for sign-in");
      assert.equal(new URL(page.url()).hash,"");
      await page.close();
    }
    console.log(
      "PASS setup: explicit Local/Cloud choice, guarded steps, server prerequisites before connection, Pages publishing after verification, correct guides/Studio URL, actual SQL/config download, optional manual first-admin SQL with verified-account, empty-installation and replay guards, connection/verification invalidation and errors; root/subdirectory EN/DE/FO at 390/1160px.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

// Execute generated Studio code with synthetic server adapters; no live backend or email.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { webcrypto } = require("node:crypto");
const { generatedFiles } = require("../tools/build-studio-functions.cjs");
function boot(name, extra = {}) {
  let handler;
  const code = stripTypeScriptTypes(
    fs.readFileSync("supabase/studio/" + name + ".ts", "utf8"),
    { mode: "strip" },
  )
    .replace(/^import \{ createClient \} from [^;]+;\s*/m, "")
    .replace(/^export /gm, "");
  vm.runInNewContext(code, {
    URL,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    AbortSignal,
    crypto: webcrypto,
    Deno: {
      env: {
        get: (key) =>
          ({
            RSVP_SITE_ORIGIN: "https://site.example.invalid",
            RSVP_SITE_URL: "https://site.example.invalid/event/",
            SUPABASE_URL: "https://api.example.invalid",
            SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
          })[key],
      },
      serve: (value) => {
        handler = value;
      },
    },
    ...extra,
  });
  return handler;
}
(async () => {
  for (const [name, value] of generatedFiles())
    assert.equal(fs.readFileSync("supabase/studio/" + name, "utf8"), value);
  let fetches = 0;
  const guest = boot("guest-gateway", {
    fetch: async () => {
      fetches++;
      return new Response(fetches === 1 ? "true" : "null", { status: 200 });
    },
  });
  const request = (origin, body) =>
    new Request("https://api.example.invalid/functions/v1/guest-gateway", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await guest(request("https://attacker.invalid", {}))).status,
    403,
  );
  assert.equal(
    (
      await guest(
        request("https://site.example.invalid", {
          action: "get_invitation_v2",
          args: {},
        }),
      )
    ).status,
    400,
  );
  assert.equal(fetches, 0);
  const response = await guest(
    request("https://site.example.invalid", {
      action: "get_invitation_v2",
      args: { p_code: "ABCDEFGH" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
  assert.equal(fetches, 2);
  let sent = 0,
    redirect,
    member = true,
    existing = false;
  const service = {
    auth: {
      getUser: async () => ({ data: { user: { id: "synthetic" } } }),
      admin: {
        inviteUserByEmail: async (email, options) => {
          sent++;
          redirect = options.redirectTo;
          return {};
        },
      },
      signInWithOtp: async (args) => {
        sent++;
        redirect = args.options.emailRedirectTo;
        return {};
      },
    },
    rpc: async () => ({ data: true }),
  };
  const caller = {
    rpc: async () =>
      member
        ? {
            data: {
              id: "synthetic",
              attempt_id: "synthetic",
              email: "synthetic@example.invalid",
              existing_confirmed: existing,
            },
          }
        : {
            error: { code: "42501", message: "Administrator access required" },
          },
  };
  const admin = boot("admin-invitations", {
    createClient: (url, key, options) => (options.global ? caller : service),
  });
  const invite = (
    token = "Bearer aaa.bbb.ccc",
    body = { email: "synthetic@example.invalid", name: "Example" },
  ) =>
    new Request("https://api.example.invalid/functions/v1/admin-invitations", {
      method: "POST",
      headers: {
        origin: "https://site.example.invalid",
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  assert.equal((await admin(invite(""))).status, 401);
  assert.equal(sent, 0);
  member = false;
  assert.equal((await admin(invite())).status, 403);
  assert.equal(sent, 0);
  member = true;
  assert.equal(
    (
      await admin(
        invite(undefined, {
          email: "synthetic@example.invalid",
          name: "Example",
          redirectTo: "https://attacker.invalid",
        }),
      )
    ).status,
    400,
  );
  for (existing of [false, true]) {
    assert.equal((await admin(invite())).status, 200);
    assert.equal(
      redirect,
      "https://site.example.invalid/event/admin/?admin-invitation=1",
    );
  }
  assert.equal(sent, 2);
  console.log(
    "PASS Studio bundles: fresh generation, executable TypeScript, origin/payload checks, missing invitation rejection, administrator login/membership and trusted email redirects.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { createSetupServer } from "../setup-service/server.ts";
const require = createRequire(import.meta.url),
  { fixture } = require("./helpers/setup-management-fixture.cjs");
const f = await fixture(),
  server = createSetupServer(process.cwd(), { fetcher: f.fetcher });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
try {
  const start = await fetch(origin + "/setup-api/session"),
    cookie = start.headers.get("set-cookie").split(";")[0],
    session = await start.json();
  assert.match(start.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal(start.headers.get("access-control-allow-origin"), null);
  const post = (action, body, overrides = {}) =>
    fetch(origin + "/setup-api/" + action, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Setup-CSRF": session.csrf,
        ...overrides,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("connect", f.config, { Origin: "https://attacker.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (await post("connect", f.config, { "X-Setup-CSRF": "incorrect" })).status,
    401,
  );
  assert.equal(
    (await post("connect", f.config, { "X-Setup-CSRF": "ø".repeat(64) }))
      .status,
    401,
  );
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(
      origin + "/setup-api/session",
      { headers: { Host: "rebinding.invalid" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    request.on("error", reject);
  });
  assert.equal(wrongHost, 403);
  for (const name of [
    "AGENTS.md",
    "internal/docs/codex-handover.md",
    "setup-service/installation.ts",
    "js/config.js",
    ".env",
    "supabase/install.sql",
  ])
    assert.equal((await fetch(origin + "/" + name)).status, 404, name);
  const html = await fetch(origin + "/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /automaticWizard/);
  assert.match(
    html.headers.get("content-security-policy"),
    /connect-src 'self'/,
  );
  let response = await post("connect", f.config);
  assert.equal(response.status, 200);
  let exposed = await response.text();
  for (const value of [f.config.serviceKey, f.config.accessToken])
    assert(!exposed.includes(value));
  const refreshed = await fetch(origin + "/setup-api/session", {
    headers: { Cookie: cookie },
  });
  assert.equal((await refreshed.json()).state.connected, true);
  response = await post("connect", {
    ...f.config,
    accessToken: "sbp_bad_synthetic_access_token",
  });
  assert.equal(response.status, 401);
  response = await post("database", {});
  assert.equal(
    response.status,
    409,
    "failed reconnect cannot operate on old credentials",
  );
  assert.equal(
    (await post("connect", { ...f.config, accessToken: "x".repeat(70000) }))
      .status,
    413,
  );
  response = await post("connect", f.config);
  assert.equal(response.status, 200);
  const password = "Synthetic HTTP setup password 123!";
  for (const step of ["database", "administrator", "secrets", "functions", "configuration", "verification"]) {
    response = await post(step, step === "administrator" ? { email: "http-owner@example.invalid", password } : {});
    assert.equal(response.status, 200, step);
    exposed = await response.text();
    for (const value of [f.config.serviceKey, f.config.accessToken, password])
      assert(!exposed.includes(value), step + " response excludes private values");
  }
  const callCount = f.calls.length;
  for (const step of ["database", "administrator", "secrets", "functions", "configuration", "verification"]) {
    response = await post(step, { email: "different@example.invalid", password });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).initialized, true);
  }
  assert.equal(f.calls.length, callCount, "completed HTTP session works only from safe cached state after credentials are forgotten");
  assert.equal(f.state.created, 1, "no second first-admin creation after completion");
  response = await post("connect", f.config);
  assert.equal(response.status, 200);
  const reopened = await response.json();
  assert.equal(reopened.initialized, true);
  assert.equal(reopened.existingInstallation, true);
  const finalSession = await fetch(origin + "/setup-api/session", { headers: { Cookie: cookie } });
  const state = await finalSession.text();
  for (const value of [f.config.serviceKey, f.config.accessToken, password])
    assert(!state.includes(value));
  response = await post("disconnect", {});
  assert.equal(response.status, 200);
  response = await post("connect", f.config);
  assert.equal(
    response.status,
    401,
    "disconnected cookie cannot reuse credentials",
  );

  console.log(
    "PASS trusted setup HTTP boundary: loopback host, same-origin/CSRF, private-file denial, credential-free replies, reconnect invalidation, complete install/credential forgetting, all-step closed reentry, initialized reconnect, session recovery/disconnect and request limits.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await f.db.close();
}

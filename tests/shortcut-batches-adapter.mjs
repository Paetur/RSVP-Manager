// Exercise the deployed TypeScript adapter with synthetic transport only.
import assert from "node:assert/strict";
const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
const api = "https://synthetic.invalid/functions/v1/invitation-shortcuts";
const batch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cap = "synthetic_capability_".padEnd(64, "x");
try {
  for (const kind of ["modern", "legacy"]) {
    let handler;
    const calls = [];
    const key = kind === "modern" ? "sb_secret_" + "synthetic" : "synthetic.service.jwt";
    globalThis.Deno = {
      env: { get: name => ({ RSVP_SITE_ORIGIN: "https://example.invalid", SUPABASE_URL: "https://synthetic.invalid",
        DENO_DEPLOYMENT_ID: "synthetic_hosted_deployment",
        SUPABASE_SERVICE_ROLE_KEY: kind === "legacy" ? key : undefined,
        SUPABASE_SECRET_KEYS: kind === "modern" ? JSON.stringify({ default: key }) : undefined })[name] },
      serve: value => { handler = value; },
    };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, headers: options.headers });
      return new Response(JSON.stringify(url.endsWith("shortcut_gateway_allow_request") ? true : url.endsWith("admin_create_shortcut_batch")
        ? { batch_id: batch, capability: cap, expires_at: "2027-01-01T12:00:00Z", mode: "live", count: 1 }
        : { mode: "live", invitations: [], statuses: [], expires_at: "2027-01-01T12:00:00Z" }), { status: 200 });
    };
    await import("../supabase/functions/invitation-shortcuts/index.ts?synthetic=" + kind);
    assert.equal((await handler(new Request(api + "/batches/" + batch, { headers: { authorization: "Bearer " + cap } }))).status, 200);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.headers.apikey, key);
      assert.equal(call.headers.Authorization, kind === "legacy" ? "Bearer " + key : undefined);
      assert(!JSON.stringify(call.headers).includes(cap));
    }
    const created = await handler(new Request(api + "/batches", { method: "POST", headers: { authorization: "Bearer synthetic.user.jwt" },
      body: JSON.stringify({ items: [{ queue_id: batch, expected_revision: 1 }] }) }));
    assert.equal(created.status, 201);
    assert.equal(calls.at(-1).headers.Authorization, "Bearer synthetic.user.jwt");
    const internal = "http://edge-internal/invitation-shortcuts/batches/" + batch;
    assert.equal((await handler(new Request(internal, { headers: { authorization: "Bearer " + cap,
      "x-forwarded-proto": "https" } }))).status, 200, "Hosted HTTPS gateway uses an internal HTTP isolate URL");
    assert.equal((await handler(new Request("http://edge-internal/invitation-shortcuts/batches", { method: "POST",
      headers: { authorization: "Bearer synthetic.user.jwt", "x-forwarded-proto": "https" },
      body: JSON.stringify({ items: [{ queue_id: batch, expected_revision: 1 }] }) }))).status, 201,
      "Hosted prefix mapping preserves a POST body and organizer authentication");
    assert.equal((await handler(new Request(internal, { headers: { authorization: "Bearer " + cap } }))).status, 400);
    assert.equal((await handler(new Request(internal + "?authorization=forbidden", { headers: { authorization: "Bearer " + cap,
      "x-forwarded-proto": "https" } }))).status, 400);
  }
  const proxyToken = "0123456789abcdef".repeat(4);
  const internal = "http://edge-internal/invitation-shortcuts/batches/" + batch;
  const localHeaders = { authorization: "Bearer " + cap, "x-forwarded-proto": "https",
    "x-rsvp-shortcuts-proxy": proxyToken };
  let localVersion = 0;
  async function localAdapter(configuredToken) {
    let handler;
    const calls = [];
    globalThis.Deno = { env: { get: name => ({ RSVP_SITE_ORIGIN: "https://example.invalid",
      RSVP_SHORTCUTS_API_URL: api, RSVP_SHORTCUTS_PROXY_TOKEN: configuredToken,
      SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic.service.jwt" })[name] },
      serve: value => { handler = value; } };
    globalThis.fetch = async (url, options) => {
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(url.endsWith("shortcut_gateway_allow_request") ? true : url.endsWith("admin_create_shortcut_batch")
        ? { batch_id: batch, capability: cap, expires_at: "2027-01-01T12:00:00Z", mode: "live", count: 1 }
        : { mode: "live", invitations: [], statuses: [], expires_at: "2027-01-01T12:00:00Z" }), { status: 200 });
    };
    await import("../supabase/functions/invitation-shortcuts/index.ts?synthetic=local-" + localVersion++);
    return { handler, calls };
  }
  for (const configuredToken of [undefined, "", "a".repeat(63), "z".repeat(64)]) {
    const { handler, calls } = await localAdapter(configuredToken);
    assert.equal((await handler(new Request(internal, { headers: localHeaders }))).status, 400,
      "An absent or malformed server proxy token keeps standalone HTTP closed");
    assert.equal(calls.length, 0);
  }
  const { handler: localHandler, calls: localCalls } = await localAdapter(proxyToken);
  const denied = [
    [internal, { authorization: "Bearer " + cap, "x-forwarded-proto": "https" }],
    [internal, { ...localHeaders, "x-rsvp-shortcuts-proxy": "f".repeat(64) }],
    [internal, { ...localHeaders, "x-rsvp-shortcuts-proxy": proxyToken + "," + proxyToken }],
    [internal, { authorization: "Bearer " + cap, "x-rsvp-shortcuts-proxy": proxyToken }],
    [internal, { ...localHeaders, "x-forwarded-proto": "http" }],
    [internal, { ...localHeaders, "x-forwarded-proto": "https,http" }],
    ["http://edge-internal/other/invitation-shortcuts/batches/" + batch, localHeaders],
    ["http://edge-internal/invitation-shortcuts-elsewhere/batches/" + batch, localHeaders],
    [internal + "?x-rsvp-shortcuts-proxy=" + proxyToken, { authorization: "Bearer " + cap, "x-forwarded-proto": "https" }],
    [internal + "?authorization=forbidden", localHeaders],
  ];
  for (const [url, headers] of denied) {
    assert.equal((await localHandler(new Request(url, { headers }))).status, 400,
      "Only authenticated proxy transport on the exact function prefix can normalize HTTP; queries remain rejected");
    assert.equal(localCalls.length, 0);
  }
  assert.equal((await localHandler(new Request(internal, { headers: { ...localHeaders, origin: "https://untrusted.invalid" } }))).status, 403);
  assert.equal((await localHandler(new Request(internal, { headers: {
    "x-forwarded-proto": "https", "x-rsvp-shortcuts-proxy": proxyToken } }))).status, 401);
  assert.equal(localCalls.length, 0, "Proxy transport does not bypass origin or batch authorization");
  for (const url of [internal, "http://edge-internal/functions/v1/invitation-shortcuts/batches/" + batch,
    api + "/batches/" + batch]) {
    const before = localCalls.length;
    assert.equal((await localHandler(new Request(url, { headers: localHeaders }))).status, 200);
    assert.equal(localCalls.length, before + 2);
  }
  const items = [{ queue_id: batch, expected_revision: 1 }];
  assert.equal((await localHandler(new Request("http://edge-internal/invitation-shortcuts/batches", { method: "POST",
    headers: { ...localHeaders, authorization: "Bearer synthetic.user.jwt" }, body: JSON.stringify({ items }) }))).status, 201);
  assert.equal(localCalls.at(-1).headers.Authorization, "Bearer synthetic.user.jwt");
  assert.deepEqual(localCalls.at(-1).body, { p_items: items, p_mode: "live", p_retry: false },
    "The trusted local proxy preserves the organizer POST body");
  assert.equal((await localHandler(new Request(internal, { method: "OPTIONS", headers: localHeaders }))).status, 204);
  for (const call of localCalls) {
    assert(!JSON.stringify(call).includes(proxyToken), "The private proxy token never reaches PostgREST");
    assert(!JSON.stringify(call).includes(cap), "The device capability never reaches PostgREST");
  }
  console.log("PASS Shortcuts deployed adapter: hosted and authenticated local TLS transport, denied untrusted HTTP, strict origin/path/query guards, preserved organizer POST, no proxy token/device capability forwarded to PostgREST.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Deno = originalDeno;
}

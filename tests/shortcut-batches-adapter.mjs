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
  let localHandler;
  globalThis.Deno = { env: { get: name => ({ RSVP_SITE_ORIGIN: "https://example.invalid",
    SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic.service.jwt" })[name] },
    serve: value => { localHandler = value; } };
  await import("../supabase/functions/invitation-shortcuts/index.ts?synthetic=standalone");
  assert.equal((await localHandler(new Request("http://untrusted/invitation-shortcuts/batches/" + batch, {
    headers: { authorization: "Bearer " + cap, "x-forwarded-proto": "https" },
  }))).status, 400, "Standalone HTTP cannot assert that it is the hosted TLS gateway");
  console.log("PASS Shortcuts deployed adapter: modern apikey-only secret, legacy service JWT, organizer JWT forwarding, no device capability forwarded to PostgREST.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Deno = originalDeno;
}

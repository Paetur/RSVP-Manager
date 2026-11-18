// HTTP boundary only: synthetic adapters, no network, provider send, or credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import { shortcutHandler } from "../supabase/functions/invitation-shortcuts/handler.mjs";

const base = "https://synthetic.invalid/functions/v1/invitation-shortcuts";
const origin = "https://example.invalid";
const id = n => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
const batch = id(1), attempt = id(2), queue = id(3), claim = id(4), event = id(5);
const cap = "synthetic_batch_capability_" + "x".repeat(40);
const user = "synthetic.user.jwt";
const jpeg = fs.readFileSync("tests/fixtures/customization.jpg");
let allowed = true, failure = null;
const calls = [];
const handler = shortcutHandler({
  origin, siteUrl: origin + "/celebration/", apiUrl: base,
  rpc: async (name, args, authorization) => {
    calls.push({ name, args, authorization });
    if (name === "shortcut_gateway_allow_request") {
      assert.match(args.p_source_hash, /^[a-f0-9]{64}$/);
      assert.match(args.p_token_hash, /^[a-f0-9]{64}$/);
      return { data: allowed };
    }
    if (failure) return { error: failure };
    if (name === "admin_create_shortcut_batch") return { data: {
      batch_id: batch, capability: cap, expires_at: "2027-01-01T12:00:00Z", mode: args.p_mode, count: args.p_items.length,
      internal_only: "must not reach the client",
    }};
    if (name === "admin_manage_shortcut_batch") return { data: args.p_action === "renew"
      ? { capability: cap, expires_at: "2027-01-01T12:00:00Z" }
      : { revoked: true } };
    assert.equal(name, "dispatch_shortcut_batch");
    assert.equal(authorization, null);
    assert.equal(args.p_batch_id, batch);
    if (args.p_action === "manifest") return { data: {
      mode: "dry_run", expires_at: "2027-01-01T12:00:00Z", progress: { pending: 1, processed: 0 },
      statuses: [{ attempt_id: attempt, delivery_id: queue, state: "pending" }],
      invitations: [{ attempt_id: attempt, queue_id: queue, household_name: "Synthetic A", phone: "+298200001",
        message: "Hello Synthetic A! " + origin + "/celebration/?=ABCDEFGH", invitation_code: "ABCDEFGH",
        has_image: true, internal_only: "hidden", required_actions: { text: true, photo: true } }],
    }};
    if (args.p_action === "image") return { data: { image: "data:image/jpeg;base64," + jpeg.toString("base64") }};
    if (args.p_action === "claim") return { data: { claimed: true, attempt_id: args.p_payload.attempt_id, state: "claimed" }};
    return { data: { accepted: true, duplicate: false, attempt_id: args.p_payload.attempt_id, event_id: args.p_payload.event_id } };
  },
});
const send = (path, { method = "GET", body, token = cap, requestOrigin = origin, headers = {} } = {}) => handler(new Request(base + path, {
  method, headers: { authorization: "Bearer " + token, origin: requestOrigin, ...headers },
  ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
}));
const create = (body, options = {}) => send("/batches", { method: "POST", body, token: user, ...options });
const item = { queue_id: queue, expected_revision: 1 };
const result = { attempt_id: attempt, claim_id: claim, event_id: event, result: "processed", channel: "whatsapp",
  details: { text_action_completed: true, photo_action_completed: true } };

assert.equal((await send("/batches/" + batch, { token: "ABCDEFGH" })).status, 401, "Invitation codes never authorize callbacks");
assert.equal((await create({ items: [item] }, { token: cap })).status, 401, "A batch capability cannot create a batch");
assert.equal((await send("/batches/" + batch, { requestOrigin: "https://attacker.invalid" })).status, 403);
assert.equal((await send("/batches/" + batch + "?token=redacted")).status, 400);
assert.equal((await send("/batches/" + batch, { method: "POST", body: {} })).status, 405);
assert.equal((await create("not json")).status, 400);
assert.equal((await create({ items: [] })).status, 400);
assert.equal((await create({ items: [item, item] })).status, 400);
assert.equal((await create({ items: Array.from({ length: 11 }, (_, n) => ({ queue_id: id(n + 10), expected_revision: 1 })) })).status, 400);
assert.equal((await create({ items: [item], recipient: "+298200001" })).status, 400, "Caller cannot replace the snapshot recipient");
assert.equal((await create({ items: [{ ...item, expected_revision: 1.5 }] })).status, 400);
assert.equal((await create({ items: [item], mode: "business_api" })).status, 400);
assert.equal((await create("x".repeat(13000))).status, 413);
const created = await create({ items: [item], mode: "dry_run" });
assert.equal(created.status, 201);
const prepared = await created.json();
assert.equal(prepared.schema_version, 1);
assert.equal(prepared.capability, cap);
assert.equal(prepared.internal_only, undefined);
assert.equal(calls.at(-1).authorization, "Bearer " + user);
assert.deepEqual(calls.at(-1).args, { p_items: [item], p_mode: "dry_run", p_retry: false });
const fetched = await send("/batches/" + batch);
assert.equal(fetched.status, 200);
assert.equal(fetched.headers.get("cache-control"), "no-store");
assert.equal(fetched.headers.get("referrer-policy"), "no-referrer");
const manifest = await fetched.json();
assert.equal(manifest.invitations[0].image_url, base + "/batches/" + batch + "/attempts/" + attempt + "/image");
assert(!manifest.invitations[0].image_url.includes(cap));
assert.equal(manifest.invitations[0].invitation_link, origin + "/celebration/?=ABCDEFGH");
assert.equal(manifest.invitations[0].internal_only, undefined);
assert.equal(manifest.progress.pending, 1);
assert.equal(manifest.progress.total, 1);
assert.equal((await send("/batches/" + batch + "/authorization", { method: "POST", token: user, body: { action: "renew" } })).status, 200);
assert.equal(calls.at(-1).name, "admin_manage_shortcut_batch");
assert.equal(calls.at(-1).authorization, "Bearer " + user);
assert.equal((await send("/batches/" + batch + "/authorization", { method: "POST", token: cap, body: { action: "revoke" } })).status, 401);
const image = await send("/batches/" + batch + "/attempts/" + attempt + "/image");
assert.equal(image.status, 200);
assert.equal(image.headers.get("content-type"), "image/jpeg");
assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
assert.equal((await send("/batches/" + batch + "/claims", { method: "POST", body: { attempt_id: attempt, claim_id: claim } })).status, 200);
assert.equal((await send("/batches/" + batch + "/results", { method: "POST", body: result })).status, 200);
assert.equal(calls.at(-1).args.p_action, "results");
assert.deepEqual(calls.at(-1).args.p_payload, result);
for (const patch of [
  { verified_sent_at: "2027-01-01T00:00:00Z" },
  { channel: "email" },
  { household_id: queue },
  { details: { ...result.details, error_message: "https://private.invalid/?secret=redacted" } },
  { details: { ...result.details, error_code: "arbitrary provider payload" } },
  { details: { ...result.details, error_code: "image_fetch_failed" } },
  { details: { text_action_completed: "true", photo_action_completed: true } },
]) assert.equal((await send("/batches/" + batch + "/results", { method: "POST", body: { ...result, ...patch } })).status, 400);
allowed = false;
assert.equal((await send("/batches/" + batch)).status, 429);
allowed = true;
for (const [error, status] of [
  [{ code: "42501", message: "private permission detail" }, 403],
  [{ code: "P0001", message: "Batch credential expired" }, 401],
  [{ code: "P0001", message: "Delivery revision changed" }, 409],
  [{ code: "P0001", message: "Shortcuts request limit exceeded" }, 429],
  [{ code: "P0001", message: "https://private.invalid/?secret=redacted" }, 400],
]) {
  failure = error;
  const response = await send("/batches/" + batch);
  assert.equal(response.status, status);
  assert(!JSON.stringify(await response.json()).includes("private.invalid"));
}
assert.throws(() => shortcutHandler({ origin, apiUrl: "http://example.invalid/function", rpc: async () => ({}) }), /HTTPS/);
assert.throws(() => shortcutHandler({ origin: "http://example.invalid", apiUrl: base, rpc: async () => ({}) }), /HTTPS/);
console.log("PASS Shortcuts HTTP boundary: scoped auth, HTTPS, schema, max10, private JPEG, no-store, claim/results validation, rate limits and redacted failures.");

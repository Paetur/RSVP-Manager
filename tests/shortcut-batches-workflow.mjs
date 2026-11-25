// A simulated device exercises the real HTTP handler + disposable PostgreSQL.
// No real recipients, HTTP transport, WhatsApp action, or populated installation.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { shortcutHandler } from "../supabase/functions/invitation-shortcuts/handler.mjs";
const require = createRequire(import.meta.url);
const { createShortcutFixture } = require("./helpers/shortcut-fixture.cjs");
const f = await createShortcutFixture({ count: 6 });
const api = "https://synthetic.invalid/functions/v1/invitation-shortcuts";
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests++; throw Error("Synthetic workflow must not contact a network"); };
try {
  await f.configureTests();
  const handler = shortcutHandler({
    origin: "https://example.invalid", apiUrl: api,
    rpc: async (name, args, authorization) => {
      await f.owner();
      await (authorization ? f.asAdmin() : f.asService());
      try {
        let data;
        if (name === "shortcut_gateway_allow_request") data = await f.value("SELECT public.shortcut_gateway_allow_request($1,$2) v", [args.p_source_hash, args.p_token_hash]);
        else if (name === "admin_create_shortcut_batch") data = await f.value("SELECT public.admin_create_shortcut_batch($1,$2,$3) v", [args.p_items, args.p_mode, args.p_retry]);
        else if (name === "admin_manage_shortcut_batch") data = await f.value("SELECT public.admin_manage_shortcut_batch($1,$2) v", [args.p_batch_id, args.p_action]);
        else if (name === "dispatch_shortcut_batch") data = await f.value("SELECT public.dispatch_shortcut_batch($1,$2,$3,$4) v", [args.p_batch_id, args.p_token_hash, args.p_action, args.p_payload]);
        else throw Error("Unexpected RPC");
        return { data };
      } catch (error) { return { error: { code: error.code, message: error.message } }; }
    },
  });
  let credential = "synthetic.user.jwt";
  async function request(path, method = "GET", body) {
    return handler(new Request(api + path, {
      method, headers: { authorization: "Bearer " + credential },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  }
  const created = await request("/batches", "POST", { items: f.deliveries, mode: "dry_run" });
  assert.equal(created.status, 201, await created.clone().text());
  const batch = await created.json();
  credential = batch.capability;
  const path = "/batches/" + batch.batch_id;
  const first = await (await request(path)).json();
  assert.equal(first.schema_version, 1);
  assert.equal(first.mode, "dry_run");
  assert.equal(first.invitations.length, 6);
  assert.equal(new Set(first.invitations.map(item => item.attempt_id)).size, 6);
  assert.equal(new Set(first.invitations.map(item => item.invitation_link)).size, 6);
  assert.equal(new Set(first.invitations.map(item => item.message)).size, 6);
  for (const phone of f.phones) assert.equal(first.invitations.filter(item => item.phone === phone).length, 3);
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const expectedJpeg = Buffer.from(f.image.image.split(",")[1], "base64");
  const knownClaims = new Map();
  for (let n = 0; n < first.invitations.length; n++) {
    const item = first.invitations[n];
    assert(item.message.includes(item.invitation_link));
    assert(item.message.includes(item.invitation_code));
    assert(!item.image_url.includes(credential));
    const image = await handler(new Request(item.image_url, { headers: { authorization: "Bearer " + credential } }));
    assert.equal(image.status, 200);
    assert.equal(digest(Buffer.from(await image.arrayBuffer())), digest(expectedJpeg));
    const claimId = randomUUID();
    knownClaims.set(item.attempt_id, claimId);
    const claim = await (await request(path + "/claims", "POST", { attempt_id: item.attempt_id, claim_id: claimId })).json();
    assert.equal(claim.claimed, true);
    assert.equal(claim.required_actions.photo, true);
    const repeatedClaim = await (await request(path + "/claims", "POST", { attempt_id: item.attempt_id, claim_id: claimId })).json();
    assert.equal(repeatedClaim.claimed, false, "A lost claim response never authorizes an automatic second action");
    // Dry-run completes configured processing actions locally without opening an app.
    const result = { event_id: randomUUID(), attempt_id: item.attempt_id, claim_id: claimId,
      channel: "whatsapp", result: "processed", details: { text_action_completed: true, photo_action_completed: true } };
    const accepted = await request(path + "/results", "POST", result);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const duplicate = await (await request(path + "/results", "POST", result)).json();
    assert.equal(duplicate.accepted, true);
    assert.equal(duplicate.idempotent, true, "Retry the result upload only");
    if (n === 1) {
      const resumed = await (await request(path)).json();
      assert.equal(resumed.invitations.length, 4);
      assert.equal(resumed.progress.processed, 2);
      assert(resumed.invitations.every(pending => !first.invitations.slice(0, 2).some(done => done.attempt_id === pending.attempt_id)));
    }
  }
  const finished = await (await request(path)).json();
  assert.deepEqual(finished.invitations, []);
  assert.equal(finished.progress.processed, 6);
  assert.equal(finished.progress.pending, 0);
  await f.owner();
  const queue = (await f.q("SELECT status,handed_to_shortcuts_at,shortcuts_processed_at,verified_sent_at FROM public.invitation_send_queue")).rows;
  assert.equal(queue.length, 6);
  assert(queue.every(row => row.status === "ready" && row.handed_to_shortcuts_at && row.shortcuts_processed_at && row.verified_sent_at === null));
  assert.equal(await f.value("SELECT count(*)::int v FROM public.invitation_deliveries"), 0);
  assert.equal(await f.value("SELECT sum(visit_count)::int v FROM public.households"), 0, "Device callbacks do not count invitation visits");
  assert.equal(await f.value("SELECT count(*)::int v FROM public.rsvp_submissions"), 0, "Device callbacks do not submit RSVP");
  credential = "synthetic.user.jwt";
  const repeat = await request("/batches", "POST", { items: f.deliveries, mode: "dry_run" });
  assert.equal(repeat.status, 409);
  assert.equal(networkRequests, 0);
  console.log("PASS six-invitation dry-run workflow: HTTP+DB, two synthetic numbers ×3, frozen messages/links/JPEGs, claims, duplicate callbacks, interruption/resume; no network, Sent, verified delivery, visits or RSVP changes.");
} finally {
  globalThis.fetch = originalFetch;
  await f.db.close();
}

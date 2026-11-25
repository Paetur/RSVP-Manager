// Disposable synthetic data only; never opens installation configuration or a network.
const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { createShortcutFixture, hash } = require("./helpers/shortcut-fixture.cjs");
(async () => {
  const f = await createShortcutFixture({ count: 3 });
  const { db, q, value } = f;
  const load = () => value("SELECT public.admin_load_data() v");
  const rows = async () => {
    await f.owner();
    return value("SELECT jsonb_build_object('batches',(SELECT jsonb_agg(to_jsonb(x)) FROM public.invitation_shortcut_batches x),'items',(SELECT jsonb_agg(to_jsonb(x)) FROM public.invitation_shortcut_items x),'attempts',(SELECT jsonb_agg(to_jsonb(x)) FROM public.invitation_shortcut_attempts x),'queue',(SELECT jsonb_agg(to_jsonb(x)) FROM public.invitation_send_queue x),'households',(SELECT jsonb_agg(to_jsonb(x)) FROM public.households x)) v");
  };
  try {
    const initial = await load();
    for (const name of ["shortcutBatches", "shortcutItems", "shortcutAttempts"])
      assert.deepEqual(initial[name], [], "empty history has an explicit array");

    const batch = await f.createBatch(f.deliveries);
    const manifest = await f.dispatch(batch, "manifest");
    const first = manifest.invitations[0], second = manifest.invitations[1];
    const claim = randomUUID(), event = randomUUID(), activeClaim = randomUUID();
    await f.dispatch(batch, "claim", { attempt_id: first.attempt_id, claim_id: claim });
    await f.dispatch(batch, "results", {
      event_id: event, attempt_id: first.attempt_id, claim_id: claim,
      result: "processed", channel: "whatsapp",
      details: { text_action_completed: true, photo_action_completed: true },
    });
    await f.dispatch(batch, "claim", { attempt_id: second.attempt_id, claim_id: activeClaim });
    await f.owner();
    await q("UPDATE public.households SET first_visited_at='2026-11-17T10:00:00Z',last_visited_at='2026-11-17T10:15:00Z',visit_count=2 WHERE id=$1", [f.households[0]]);
    const beforeRead = await rows();
    await f.asAdmin();
    const data = await load();
    assert.equal(data.shortcutBatches.length, 1);
    assert.equal(data.shortcutBatches[0].id, batch.batch_id);
    assert.equal(data.shortcutBatches[0].created_by, f.admin);
    assert.equal(data.shortcutItems.length, 3);
    assert.deepEqual(data.shortcutItems.map(item => item.ordinal), [1, 2, 3]);
    assert.deepEqual(new Set(data.shortcutItems.map(item => item.queue_id)), new Set(f.deliveries.map(item => item.queue_id)));
    assert.equal(data.shortcutAttempts.length, 3);
    const finished = data.shortcutAttempts.find(item => item.id === first.attempt_id);
    assert.equal(finished.state, "processed");
    assert.equal(finished.text_processed, true);
    assert.equal(finished.photo_processed, true);
    assert.equal(finished.claim_active, false);
    assert.ok(finished.started_at && finished.completed_at);
    const active = data.shortcutAttempts.find(item => item.id === second.attempt_id);
    assert.equal(active.state, "claimed");
    assert.equal(active.claim_active, true);
    const serialized = JSON.stringify({ batches: data.shortcutBatches, items: data.shortcutItems, attempts: data.shortcutAttempts });
    for (const secret of [batch.capability, hash(batch.capability), claim, event, activeClaim])
      assert.equal(serialized.includes(secret), false, "operational credentials/correlation payloads are excluded");
    for (const item of data.shortcutAttempts) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "batch_id", "queue_id", "attempt_number", "state", "started_at", "completed_at", "text_processed", "photo_processed", "error_stage", "error_message", "claim_active"].sort());
    }
    assert.equal(data.deliveries.length, 0, "processing never implies organizer-confirmed Sent");
    assert.equal(data.submissions.length, 0, "processing/visits never imply an RSVP submission");
    const delivery = data.queue.find(item => item.id === first.delivery_id);
    assert.equal(delivery.status, "ready");
    assert.ok(delivery.shortcuts_processed_at);
    assert.equal(delivery.verified_sent_at, null);
    const household = data.households.find(item => item.id === f.households[0]);
    assert.equal(Number(household.visit_count), 2);
    assert.ok(household.first_visited_at && household.last_visited_at);
    assert.deepEqual(await rows(), beforeRead, "history reads do not change delivery, household or attempt records");

    await q("UPDATE app_private.invitation_shortcut_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE attempt_id=$1", [second.attempt_id]);
    await f.asAdmin();
    const expired = (await load()).shortcutAttempts.find(item => item.id === second.attempt_id);
    assert.equal(expired.state, "claimed", "reads preserve the recorded milestone rather than resetting it");
    assert.equal(expired.claim_active, false, "a safe boolean distinguishes an expired claim without exposing its lease");

    await f.owner();
    await db.exec("UPDATE public.admins SET access_permissions=app_private.permission_preset('view')");
    await f.asAdmin();
    assert.equal((await load()).shortcutAttempts.length, 3, "Invites view permission can read history without sending permission");
    await assert.rejects(f.createBatch([f.deliveries[0]]), /permission/i);
    await f.owner();
    await db.exec("UPDATE public.admins SET access_permissions=jsonb_set(jsonb_set(app_private.permission_preset('view'),'{preset}','\"custom\"'),'{sections,invites}','\"none\"')");
    await f.asAdmin();
    const denied = await load();
    for (const name of ["shortcutBatches", "shortcutItems", "shortcutAttempts"])
      assert.deepEqual(denied[name], [], "history is not exposed without Invites read permission");
    await db.exec("SET ROLE anon");
    await assert.rejects(load(), /permission denied/i);
    await f.owner();
    await q("DELETE FROM auth.sessions WHERE id=$1", [f.session]);
    await f.asAdmin();
    await assert.rejects(load(), /sign.in|session|expired/i);
    console.log("PASS Shortcuts organizer data: Invites-only live-session history, sanitized attempt projection/active-claim flags, read-only expired-state handling, independent Sent/verified/RSVP/visits and permission denial.");
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

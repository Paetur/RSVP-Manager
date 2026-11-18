// Disposable PostgreSQL checks: no credentials, network or populated event data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createShortcutFixture, hash } = require('./helpers/shortcut-fixture.cjs');
(async () => {
  const f = await createShortcutFixture();
  const { db, q, value, deliveries } = f;
  let checks = 0;
  async function isolated(test) {
    await f.owner(); await db.exec('BEGIN');
    try { await f.asAdmin(); await test(); }
    finally { await f.owner(); await db.exec('ROLLBACK'); await f.asAdmin(); }
  }
  async function rejects(action, pattern) {
    await q('SAVEPOINT expected_rejection');
    try { await assert.rejects(action, pattern); checks++; }
    finally { await q('ROLLBACK TO SAVEPOINT expected_rejection'); await q('RELEASE SAVEPOINT expected_rejection'); }
  }
  const result = (item, claimId, outcome = 'processed', text = true, photo = true, extra = {}) => ({
    attempt_id: item.attempt_id, event_id: randomUUID(), claim_id: claimId,
    channel: 'whatsapp', result: outcome,
    details: { text_action_completed: text, photo_action_completed: photo, ...extra },
  });
  try {
    for (let count = 1; count <= 10; count++) await isolated(async () => {
      const batch = await f.createBatch(deliveries.slice(0, count));
      assert.match(batch.capability, /^[0-9a-f]{64}$/);
      const manifest = await f.dispatch(batch, 'manifest');
      assert.equal(manifest.schema_version, 1);
      assert.equal(manifest.invitations.length, count);
      assert.equal(manifest.invitations[0].delivery_id, deliveries[0].queue_id);
      assert.equal(manifest.invitations[0].phone, f.phones[0]);
      assert.equal(manifest.invitations[0].image, true);
      assert.ok(!JSON.stringify(manifest).includes('data:image'));
      await f.owner();
      const stored = await value('SELECT to_jsonb(c) v FROM app_private.invitation_shortcut_capabilities c WHERE batch_id=$1', [batch.batch_id]);
      assert.equal(stored.token_hash, hash(batch.capability));
      assert.ok(!JSON.stringify(stored).includes(batch.capability));
      checks++;
    });
    await isolated(async () => {
      for (const items of [[], deliveries, [deliveries[0], deliveries[0]], [{ ...deliveries[0], expected_revision: 2 }], [{ ...deliveries[0], unexpected: true }]]) {
        await rejects(() => f.createBatch(items), /1 and 10|distinct|Refresh/);
      }
      for (const [sql, args] of [
        ["UPDATE public.invitation_send_queue SET status='draft' WHERE id=$1", [deliveries[0].queue_id]],
        ["UPDATE public.invitation_send_queue SET channel='sms' WHERE id=$1", [deliveries[0].queue_id]],
        ["UPDATE public.invitation_send_queue SET recipient_snapshot=jsonb_build_object('contact_value','bad') WHERE id=$1", [deliveries[0].queue_id]],
        ["UPDATE public.invitation_send_queue SET message_body='unresolved {invitation_link}' WHERE id=$1", [deliveries[0].queue_id]],
        ["UPDATE public.invitation_send_queue SET message_body='https://example.invalid/?=STALECODE' WHERE id=$1", [deliveries[0].queue_id]],
        ["UPDATE public.invitation_send_queue SET invitation_code_snapshot='STALECODE' WHERE id=$1", [deliveries[0].queue_id]],
      ]) {
        await f.owner(); await q('SAVEPOINT invalid_delivery'); await q(sql, args); await f.asAdmin();
        await rejects(() => f.createBatch(), /Refresh/);
        await f.owner(); await q('ROLLBACK TO SAVEPOINT invalid_delivery'); await q('RELEASE SAVEPOINT invalid_delivery');
      }
      await f.owner(); await q('UPDATE public.event_settings SET is_published=false');
      await rejects(() => f.createBatch(), /published/);
    });
    await isolated(async () => {
      await rejects(() => f.createBatch(deliveries.slice(0, 6), 'dry_run'), /not configured/);
      await f.configureTests();
      await rejects(() => f.createBatch([deliveries[6]], 'dry_run'), /allowlist/);
      await f.owner(); await q("UPDATE app_private.shortcut_runtime SET test_phones=ARRAY['+19995550101','+19995550101']");
      await rejects(() => f.createBatch(deliveries.slice(0, 6), 'live_test'), /not configured/);
    });
    await isolated(async () => {
      const first = await f.createBatch([deliveries[0]]);
      const second = await f.createBatch([deliveries[1]]);
      const manifest = await f.dispatch(first, 'manifest');
      const attempt = manifest.invitations[0];
      assert.deepEqual(await f.dispatch(first, 'image', { attempt_id: attempt.attempt_id }), { image: f.image.image, name: f.image.name });
      await rejects(() => f.dispatch(second, 'image', { attempt_id: attempt.attempt_id }), /does not belong/);
      await rejects(() => f.dispatch({ ...first, capability: second.capability }, 'manifest'), /expired or revoked/);
      await f.owner();
      await rejects(() => q('UPDATE public.invitation_send_queue SET message_body=$1 WHERE id=$2', ['Changed private text', deliveries[0].queue_id]), /snapshot/);
      await f.asAdmin();
      for (const table of ['invitation_shortcut_batches', 'invitation_shortcut_items', 'invitation_shortcut_attempts']) {
        await rejects(() => q(`DELETE FROM public.${table}`), /permission denied/);
        await rejects(() => q(`UPDATE public.${table} SET ${table === 'invitation_shortcut_batches' ? "mode='live'" : table === 'invitation_shortcut_items' ? 'ordinal=1' : "state='processed'"}`), /permission denied/);
        await rejects(() => q(`INSERT INTO public.${table} DEFAULT VALUES`), /permission denied/);
      }
      await rejects(() => q('SELECT public.dispatch_shortcut_batch($1,$2,$3,$4)', [first.batch_id, hash(first.capability), 'manifest', {}]), /permission denied/);
      await rejects(() => q('SELECT * FROM app_private.invitation_shortcut_capabilities'), /permission denied/);
      await db.exec('SET ROLE anon');
      await rejects(() => q('SELECT public.admin_create_shortcut_batch($1)', [[deliveries[0]]]), /permission denied/);
      await rejects(() => q('SELECT * FROM public.invitation_shortcut_attempts'), /permission denied/);
      await rejects(() => q('SELECT message_image FROM public.invitation_send_queue'), /permission denied/);
      await f.owner(); await q('UPDATE public.invitation_send_queue SET revision=revision+1 WHERE id=$1', [deliveries[0].queue_id]);
      assert.equal((await f.dispatch(first, 'manifest')).invitations.length, 0);
      await rejects(() => f.dispatch(first, 'claim', { attempt_id: attempt.attempt_id, claim_id: randomUUID() }), /no longer ready/);
    });
    await isolated(async () => {
      await f.owner();
      await q("UPDATE public.invitation_send_queue SET recipient_snapshot=jsonb_build_object('contact_value','00 1 (999)555-0101') WHERE id=$1", [deliveries[0].queue_id]);
      const batch = await f.createBatch();
      assert.equal((await f.dispatch(batch, 'manifest')).invitations[0].phone, f.phones[0]);
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch(), item = (await f.dispatch(batch, 'manifest')).invitations[0];
      const uppercaseClaim = randomUUID().toUpperCase();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id.toUpperCase(), claim_id: uppercaseClaim });
      const payload = result(item, uppercaseClaim);
      payload.attempt_id = payload.attempt_id.toUpperCase();
      payload.event_id = payload.event_id.toUpperCase();
      assert.equal((await f.dispatch(batch, 'results', payload)).state, 'processed', 'a device may preserve uppercase UUID strings');
      assert.equal((await f.dispatch(batch, 'results', { ...payload, claim_id: uppercaseClaim.toLowerCase() })).idempotent, true, 'UUID letter case does not change the recorded callback');
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch(deliveries.slice(0, 2));
      const item = (await f.dispatch(batch, 'manifest')).invitations[0], claimId = randomUUID();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
      await f.owner();
      await q("UPDATE public.invitation_shortcut_batches SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [batch.batch_id]);
      await q("UPDATE app_private.invitation_shortcut_capabilities SET expires_at=clock_timestamp()-interval '1 minute' WHERE batch_id=$1", [batch.batch_id]);
      await f.asAdmin();
      const renewed = await value("SELECT public.admin_manage_shortcut_batch($1,'renew') v", [batch.batch_id]);
      assert.notEqual(renewed.capability, batch.capability);
      assert.equal(await value('SELECT expires_at>clock_timestamp() v FROM public.invitation_shortcut_batches WHERE id=$1', [batch.batch_id]), true, 'renewal also extends the durable batch expiry');
      await rejects(() => f.createBatch([deliveries[1]], 'live', true), /active batch/);
      await rejects(() => f.dispatch(batch, 'manifest'), /expired or revoked/);
      assert.equal((await f.dispatch(renewed, 'manifest')).invitations.length, 1, 'renewal never restarts the claimed attempt');
      assert.equal((await f.dispatch(renewed, 'claim', { attempt_id: item.attempt_id, claim_id: claimId })).claimed, false);
      await f.asAdmin();
      assert.equal((await value("SELECT public.admin_manage_shortcut_batch($1,'revoke') v", [batch.batch_id])).revoked, true);
      await rejects(() => f.dispatch(renewed, 'manifest'), /expired or revoked/);
      await f.asAdmin();
      await rejects(() => value("SELECT public.admin_manage_shortcut_batch($1,'renew') v", [batch.batch_id]), /cannot be renewed/);
      const states = await value('SELECT jsonb_agg(state ORDER BY attempt_number) v FROM public.invitation_shortcut_attempts WHERE batch_id=$1', [batch.batch_id]);
      assert.ok(states.includes('unknown') && states.includes('skipped'));
      assert.ok((await f.createBatch([deliveries[0]], 'live', true)).batch_id);
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch();
      const other = '22222222-2222-4222-8222-222222222222', otherSession = randomUUID();
      await f.owner();
      await q("UPDATE public.admins SET access_permissions=app_private.permission_preset('full')||'{\"preset\":\"custom\"}'::jsonb WHERE user_id=$1", [f.admin]);
      await f.asAdmin();
      assert.ok((await value("SELECT public.admin_manage_shortcut_batch($1,'renew') v", [batch.batch_id])).capability, 'owner with sendInvites can renew');
      await f.owner();
      await q("INSERT INTO auth.users(id,email) VALUES($1,'other-synthetic@example.invalid')", [other]);
      await q("INSERT INTO public.admins(user_id,name,access_permissions) VALUES($1,'Other synthetic',app_private.permission_preset('full')||'{\"preset\":\"custom\"}'::jsonb)", [other]);
      await q('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [otherSession, other]);
      await q("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [other, JSON.stringify({ sub: other, session_id: otherSession })]);
      await f.asAdmin();
      await rejects(() => value("SELECT public.admin_manage_shortcut_batch($1,'renew') v", [batch.batch_id]), /owner or full/);
      await f.owner(); await q("UPDATE public.admins SET access_permissions=app_private.permission_preset('full') WHERE user_id=$1", [other]); await f.asAdmin();
      assert.ok((await value("SELECT public.admin_manage_shortcut_batch($1,'renew') v", [batch.batch_id])).capability, 'full administrator can recover the batch');
      await f.owner(); await q("UPDATE public.admins SET access_permissions=app_private.permission_preset('view') WHERE user_id=$1", [other]); await f.asAdmin();
      await rejects(() => value("SELECT public.admin_manage_shortcut_batch($1,'revoke') v", [batch.batch_id]), /permission/);
      checks++;
    });
    await isolated(async () => {
      await f.configureTests();
      const batch = await f.createBatch(deliveries.slice(0, 6), 'dry_run');
      const manifest = await f.dispatch(batch, 'manifest');
      assert.equal(manifest.mode, 'dry_run');
      assert.equal(new Set(manifest.invitations.map(i => i.phone)).size, 2);
      for (let index = 0; index < manifest.invitations.length; index++) {
        const item = manifest.invitations[index], claimId = randomUUID();
        const claim = await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
        assert.equal(claim.claimed, true);
        assert.equal(claim.required_actions.text, true);
        assert.equal(claim.required_actions.photo, item.image);
        assert.equal((await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId })).claimed, false);
        assert.equal((await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: randomUUID() })).claimed, false);
        if (item.image) await rejects(() => f.dispatch(batch, 'results', result(item, claimId, 'processed', true, false)), /all text and photo/);
        if (index === 0) await rejects(() => f.dispatch(batch, 'results', result(item, claimId, 'failed', false, false, { error_code: batch.capability })), /error code/);
        if (index === 0) await rejects(() => f.dispatch(batch, 'results', result(item, claimId, 'processed', true, true, { error_stage: 'photo', error_code: 'image_fetch_failed' })), /cannot contain an error/);
        if (index === 5) {
          await f.asAdmin();
          await q('SELECT public.admin_record_delivery_sent($1,1,null)', [item.delivery_id]);
        }
        const payload = result(item, claimId);
        assert.equal((await f.dispatch(batch, 'results', payload)).state, 'processed');
        assert.equal((await f.dispatch(batch, 'results', payload)).idempotent, true);
        await rejects(() => f.dispatch(batch, 'results', { ...payload, result: 'partial' }), /conflicts/);
        await f.owner();
        const queue = await value('SELECT to_jsonb(z) v FROM public.invitation_send_queue z WHERE id=$1', [item.delivery_id]);
        assert.ok(queue.handed_to_shortcuts_at && queue.shortcuts_processed_at);
        assert.equal(queue.shortcuts_attempt_id, item.attempt_id);
        assert.equal(queue.shortcuts_batch_id, batch.batch_id);
        assert.equal(queue.verified_sent_at, null);
        assert.equal(queue.status, index === 5 ? 'sent' : 'ready');
      }
      assert.equal((await f.dispatch(batch, 'manifest')).invitations.length, 0);
      await rejects(() => f.createBatch([deliveries[0]], 'dry_run', true), /cannot be repeated/);
      await f.owner();
      assert.equal(await value('SELECT count(*)::int v FROM public.invitation_deliveries'), 1, 'only the explicit manual Sent action creates delivery confirmation');
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch([deliveries[0]]), item = (await f.dispatch(batch, 'manifest')).invitations[0], claimId = randomUUID();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
      await f.dispatch(batch, 'results', result(item, claimId, 'partial', true, false, { error_stage: 'photo', error_code: 'action_failed' }));
      await rejects(() => f.createBatch([deliveries[0]]), /Explicit retry/);
      const retry = await f.createBatch([deliveries[0]], 'live', true), retryItem = (await f.dispatch(retry, 'manifest')).invitations[0];
      assert.notEqual(retryItem.attempt_id, item.attempt_id);
      const nextClaim = randomUUID(), claimed = await f.dispatch(retry, 'claim', { attempt_id: retryItem.attempt_id, claim_id: nextClaim });
      assert.deepEqual(claimed.required_actions, { text: false, photo: true });
      assert.deepEqual(claimed.completed_actions, { text: true, photo: false });
      await rejects(() => f.dispatch(retry, 'results', result(retryItem, nextClaim, 'processed', false, true)), /discard completed/);
      await f.dispatch(retry, 'results', result(retryItem, nextClaim));
      await f.owner();
      assert.equal(await value('SELECT count(*)::int v FROM public.invitation_shortcut_attempts WHERE queue_id=$1', [deliveries[0].queue_id]), 2);
      assert.equal(await value('SELECT status v FROM public.invitation_send_queue WHERE id=$1', [deliveries[0].queue_id]), 'ready');
      checks++;
    });
    for (const outcome of ['failed', 'skipped']) await isolated(async () => {
      const batch = await f.createBatch([deliveries[1]]), item = (await f.dispatch(batch, 'manifest')).invitations[0], claimId = randomUUID();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
      await f.dispatch(batch, 'results', result(item, claimId, outcome, false, false, { error_stage: 'text', error_code: 'cancelled' }));
      assert.equal((await f.dispatch(batch, 'manifest')).statuses[0].state, outcome);
      assert.ok((await f.createBatch([deliveries[1]], 'live', true)).batch_id);
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch(), item = (await f.dispatch(batch, 'manifest')).invitations[0], claimId = randomUUID();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
      await f.owner(); await q("UPDATE app_private.invitation_shortcut_leases SET expires_at=clock_timestamp()-interval '1 second'");
      const resumed = await f.dispatch(batch, 'manifest');
      assert.equal(resumed.invitations.length, 0);
      assert.equal(resumed.statuses[0].state, 'unknown');
      assert.equal((await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId })).claimed, false);
      await rejects(() => f.createBatch(), /Explicit retry/);
      const retry = await f.createBatch([deliveries[0]], 'live', true), next = (await f.dispatch(retry, 'manifest')).invitations[0];
      await f.dispatch(retry, 'claim', { attempt_id: next.attempt_id, claim_id: randomUUID() });
      // A delayed result still belongs to its original attempt, without replacing the new queue pointer.
      await f.dispatch(batch, 'results', result(item, claimId));
      await f.owner();
      assert.equal(await value('SELECT shortcuts_attempt_id v FROM public.invitation_send_queue WHERE id=$1', [item.delivery_id]), next.attempt_id);
      checks++;
    });
    await isolated(async () => {
      const batch = await f.createBatch(), item = (await f.dispatch(batch, 'manifest')).invitations[0], claimId = randomUUID();
      await f.dispatch(batch, 'claim', { attempt_id: item.attempt_id, claim_id: claimId });
      await f.owner(); await q("UPDATE app_private.invitation_shortcut_leases SET expires_at=clock_timestamp()-interval '1 second'");
      await f.dispatch(batch, 'manifest');
      const retry = await f.createBatch([deliveries[0]], 'live', true), next = (await f.dispatch(retry, 'manifest')).invitations[0];
      await f.dispatch(batch, 'results', result(item, claimId));
      assert.equal((await f.dispatch(retry, 'manifest')).invitations.length, 0);
      await rejects(() => f.dispatch(retry, 'claim', { attempt_id: next.attempt_id, claim_id: randomUUID() }), /processed attempt/);
      await rejects(() => f.createBatch([deliveries[0]], 'live', true), /cannot be repeated/);
      checks++;
    });
    await isolated(async () => {
      await f.configureTests();
      const batch = await f.createBatch(deliveries.slice(0, 6), 'dry_run');
      await f.owner(); await q('UPDATE app_private.shortcut_runtime SET test_enabled=false');
      await rejects(() => f.dispatch(batch, 'manifest'), /expired or revoked/);
    });
    for (const revoke of [
      f => f.q('DELETE FROM auth.sessions WHERE id=$1', [f.session]),
      f => f.q("UPDATE public.admins SET access_permissions=app_private.permission_preset('view')"),
      f => f.q("UPDATE app_private.invitation_shortcut_capabilities SET expires_at=clock_timestamp()-interval '1 second'"),
      f => f.q('UPDATE app_private.shortcut_runtime SET generation=gen_random_uuid()'),
      f => f.q('UPDATE public.event_settings SET is_published=false'),
      f => f.q('SELECT app_private.revoke_shortcut_capabilities()'),
    ]) await isolated(async () => {
      const batch = await f.createBatch(); await f.owner(); await revoke(f);
      await rejects(() => f.dispatch(batch, 'manifest'), /expired or revoked/);
    });
    await isolated(async () => {
      await f.asService();
      for (let i = 0; i < 120; i++) assert.equal(await value('SELECT public.shortcut_gateway_allow_request($1,$2) v', [hash('synthetic-source'), hash('invalid-capability')]), true);
      assert.equal(await value('SELECT public.shortcut_gateway_allow_request($1,$2) v', [hash('synthetic-source'), hash('invalid-capability')]), false);
      assert.equal(await value('SELECT public.shortcut_gateway_allow_request($1,$2) v', [hash('different-source'), hash('different-capability')]), true);
      assert.equal(await value("SELECT public.shortcut_gateway_allow_request('raw source','raw token') v"), false);
      await f.owner();
      await q("UPDATE app_private.shortcut_gateway_rate_limits SET request_count=1000 WHERE bucket='global'");
      const storedRows = await value('SELECT count(*)::int v FROM app_private.shortcut_gateway_rate_limits');
      await f.asService();
      for (let i = 0; i < 100; i++) assert.equal(await value('SELECT public.shortcut_gateway_allow_request($1,$2) v', [hash(randomUUID()), hash(randomUUID())]), false);
      await f.owner();
      assert.equal(await value('SELECT count(*)::int v FROM app_private.shortcut_gateway_rate_limits'), storedRows, 'global rejection allocates no random source or token records');
      checks++;
    });
    console.log(`PASS ${checks} Shortcuts database checks: 1–10 fixed snapshots; 11/duplicate/stale/security denial; private images and capability binding; six synthetic dry-run outcomes; claim/retry/late result idempotency; manual Sent separation; revocation and rate buckets.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

// Editor integration with synthetic API failures; no live records or messages.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-delivery-editor");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
        viewport: { width: 820, height: 1180 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    const seed = `fixtures.event_settings[0].is_published=false;const h=fixtures.households.find(h=>h.invite_code&&!h.archived_at);fixtures.invitation_send_queue=[{id:'editor-existing',household_id:h.id,channel:'manual',status:'ready',revision:7,created_at:'2026-11-13T12:00:00Z',updated_at:'2026-11-13T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example'},message_subject:'Existing title',message_body:'Existing {invitation_link}'}];window.__editorCalls=[];const priorEditorRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_save_delivery'){window.__editorCalls.push(args);if(window.__editorFail){window.__editorFail=false;return {error:{message:'Synthetic editor failure'}};}const row=fixtures.invitation_send_queue.find(q=>q.id===args.p_id);Object.assign(row,args.p_values,{revision:row.revision+1});return {data:row.id};}return priorEditorRpc(name,args);};`;
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + seed,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
    );
    await page.locator("[data-tab=invites]").click();

    await page
      .locator("#inviteRows details.invite-household")
      .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
    await page.waitForFunction(() =>
      document.querySelector("#inviteRows [data-delivery-id=editor-existing]"),
    );
    await page
      .locator("#inviteRows details")
      .evaluateAll((ns) => ns.forEach((n) => (n.open = true)));
    const record = page.locator(
        "#inviteRows [data-delivery-id=editor-existing]",
      ),
      form = record.locator("details form").first();
    const subject = form.getByLabel("Message subject", { exact: true }),
      body = form.getByLabel("Message text", { exact: true }),
      status = form.getByLabel("Delivery status", { exact: true });
    assert.equal(
      await status.inputValue(),
      "draft",
      "unpublished editor cannot keep a ready state",
    );
    assert.equal(await status.locator("option[value=ready]").count(), 0);
    assert.equal(await body.inputValue(), "Existing {invitation_link}");
    await subject.fill("Discard this change");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await subject.inputValue(), "Existing title");
    await subject.fill("Retained draft");
    await page.evaluate(() => (window.__editorFail = true));
    await form
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await form.locator(".form-feedback[data-state=error]").waitFor();
    assert.equal(await subject.inputValue(), "Retained draft");
    assert.equal(await body.inputValue(), "Existing {invitation_link}");
    assert.equal(
      await page.evaluate(() => window.__editorCalls[0].p_expected_revision),
      7,
    );
    await form
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await page.waitForFunction(
      () => fixtures.invitation_send_queue[0].revision === 8,
    );
    assert.equal(
      await page.evaluate(
        () => window.__editorCalls[1].p_values.message_subject,
      ),
      "Retained draft",
    );
    assert.equal(
      await page.evaluate(() => window.__editorCalls[1].p_values.status),
      "draft",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__calls.filter((c) => c.name === "admin_record_delivery_sent")
            .length,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS delivery editor: unpublished readiness/link rules, Cancel baseline, failed-save draft retention, explicit revision forwarding and successful retry without sending.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

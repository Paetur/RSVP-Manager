const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { selectWorkTab } = require("./helpers/language-ui.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra } = createFoodHarness("household-sessions");
const seed = `
window.__sessionHousehold=fixtures.households.find(h=>!h.archived_at&&fixtures.guests.some(g=>g.household_id===h.id&&!g.archived_at)).id;
const sessionHousehold=fixtures.households.find(h=>h.id===window.__sessionHousehold);
sessionHousehold.rsvp_state='open';
sessionHousehold.food_interest=false;
sessionHousehold.food=true;
fixtures.event_settings[0].food_enabled=true;
fixtures.rsvp_submissions=fixtures.rsvp_submissions.filter(s=>s.household_id!==window.__sessionHousehold);
const sessionHouseholdRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_guest_details'&&window.__failGuestEdit){window.__failGuestEdit=false;return {error:{message:'Synthetic guest save failure'}};}
 if((name==='admin_save_household'||name==='admin_save_household_with_food')&&args.p_values.session_assignments){
  if(window.__failSessionHousehold){window.__failSessionHousehold=false;return {error:{message:'Synthetic combined save failure'}};}
  window.__sessionHouseholdSave=args;
  for(const a of args.p_values.session_assignments){if(a.guest_id){fixtures.guest_session_overrides=fixtures.guest_session_overrides.filter(x=>x.guest_id!==a.guest_id||x.session_id!==a.session_id);if(a.is_invited!==null)fixtures.guest_session_overrides.push(a);}else{fixtures.household_session_defaults=fixtures.household_session_defaults.filter(x=>x.household_id!==args.p_id||x.session_id!==a.session_id);fixtures.household_session_defaults.push({household_id:args.p_id,session_id:a.session_id,is_invited:a.is_invited});}}
 }
 return sessionHouseholdRpc(name,args);
};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(9000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + seed,
        }),
      );
      const base = process.env.RSVP_INSTALLED_SITE || "http://127.0.0.1:" + server.address().port;
      let productionRequests=0;
      if (process.env.RSVP_INSTALLED_SITE) {
        await page.route("**/js/config.js?*", r=>r.fulfill({contentType:"text/javascript",body:'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};'}));
        await page.route(/\/(rest|auth|functions)\/v1\//, r=>{productionRequests++;return r.abort()});
        await page.route(base+"/**",async r=>{if(r.request().resourceType()!=="document")return r.fallback();const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace(/ integrity="[^"]+"/g,"")})});
      }
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      const id = await page.evaluate(() => window.__sessionHousehold);
      await selectWorkTab(page, "households");
      await page
        .locator("#householdRows details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      const household = page.locator('[data-tree-key="household:' + id + '"]');
      const addGuest = household.locator(":scope > .household-expanded > details > summary")
        .filter({ hasText: /^Add guest$/ });
      const edit = household.locator(":scope > summary")
        .getByRole("button", { name: /^Edit household:/ });
      await addGuest.waitFor();
      await edit.click();
      const form = page.locator("#household-form-" + id),
        checks = form.locator(".household-session-choices input");
      assert.ok((await checks.count()) > 0);
      const initial = await checks.first().isChecked();
      await checks.first().setChecked(!initial);
      const exceptions = form.locator(".household-session-exceptions");
      if (!(await exceptions.evaluate((n) => n.open)))
        await exceptions.locator("summary").click();
      const override = exceptions.locator("select").first();
      await override.selectOption("true");
      await page.evaluate(() => {
        window.__failSessionHousehold = true;
      });
      await page
        .locator('button[type=submit][form="household-form-' + id + '"]')
        .click();
      await page
        .locator(
          '[data-household-detail-key="household-details:' +
            id +
            '"] [data-state=error]',
        )
        .waitFor();
      assert.equal(await checks.first().isChecked(), !initial);
      assert.equal(await override.inputValue(), "true");
      await page
        .locator('button[type=submit][form="household-form-' + id + '"]')
        .click();
      await page.waitForFunction(() => !!window.__sessionHouseholdSave);
      const sent = await page.evaluate(
        () => window.__sessionHouseholdSave.p_values,
      );
      assert(
        sent.session_assignments.some(
          (a) => a.guest_id && a.is_invited === true,
        ),
      );
      assert(
        sent.session_assignments.some(
          (a) => a.guest_id === null && a.is_invited === !initial,
        ),
      );
      assert(sent.session_assignments_expected);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await selectWorkTab(page, "invites");
      const invite = page.locator('[data-invite-household="' + id + '"]');
      await invite.evaluate((row) => { row.open = true; });
      const rsvp = invite.locator("details[id^='invite-rsvp-']");
      await rsvp.evaluate((panel) => { panel.open = true; });
      const actions = name => rsvp.getByRole("button", { name, exact: true });
      const calls = name => page.evaluate(name => window.__calls.filter(call => call.name === name).map(call => call.args), name);
      const late = actions("Allow a late response");
      await late.click();
      const lateDialog = page.getByRole("dialog", { name: /^Allow a late response/ });
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
      await lateDialog.getByLabel(/^Allow responses until/).fill(future);
      await lateDialog.getByRole("button", { name: "Review changes", exact: true }).click();
      assert.equal((await calls("admin_authorize_late_rsvp")).length, 0);
      await lateDialog.getByRole("button", { name: "Confirm", exact: true }).click();
      await lateDialog.waitFor({ state: "hidden" });
      const [granted] = await calls("admin_authorize_late_rsvp");
      assert.equal(granted.p_household_id, id);
      assert.equal(granted.p_reason, null);
      assert.ok(Date.parse(granted.p_until) > Date.now());
      const rawState = width === 390 ? "open" : "locked";
      const { submissionId, sessionName } = await page.evaluate(({ id, rawState }) => {
        const household = fixtures.households.find((h) => h.id === id);
        const submission = { id: crypto.randomUUID(), household_id: id, submitted_at: new Date().toISOString() };
        const mainSession = fixtures.event_sessions.find(s => s.is_active && s.requires_rsvp);
        const guests = fixtures.guests.filter(g => g.household_id === id && !g.archived_at);
        fixtures.household_session_defaults = [{ household_id: id, session_id: mainSession.id, is_invited: true }];
        fixtures.guest_session_responses = guests.map(guest => ({ guest_id: guest.id, session_id: mainSession.id, rsvp_status: "attending" }));
        household.rsvp_state = rawState;
        household.latest_rsvp_submission_id = submission.id;
        household.rsvp_submitted_at = submission.submitted_at;
        fixtures.rsvp_submissions.push(submission);
        return { submissionId: submission.id, sessionName: mainSession.name };
      }, { id, rawState });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      await selectWorkTab(page, "households");
      await page
        .locator("#householdRows details")
        .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      await edit.click();
      assert.equal(
        await form
          .locator(".household-session-choices input:not(:disabled)")
          .count(),
        0,
      );
      assert.equal(await addGuest.count(), 0, "Locked households hide Add guest");
      await selectWorkTab(page, "invites");
      await invite.evaluate((row) => { row.open = true; });
      assert.equal(await invite.locator('[id^="invite-sessions-"]').count(), 0);
      await rsvp.evaluate((panel) => { panel.open = true; });
      const editRpc = "admin_edit_household_rsvp";
      for (const label of ["Reopen RSVP", "Lock RSVP", "Allow a late response"]) {
        assert.equal(await actions(label).count(), 0, label + " is unavailable after submission");
      }
      const openEdit = actions("Edit RSVP");
      const editRsvp = page.getByRole("dialog", { name: /^Edit RSVP/ });
      const currentState = rsvp.locator(".invite-rsvp-state");
      assert.equal(await currentState.textContent(), "Locked");
      const previewDir = process.env.RSVP_RSVP_PREVIEW;
      if (previewDir) await rsvp.screenshot({ path: `${previewDir}/rsvp-panel-${width}.png` });
      const review = editRsvp.getByRole("button", { name: "Review changes", exact: true });
      const confirmEdit = editRsvp.getByRole("button", { name: "Confirm", exact: true });
      await openEdit.click();
      const attendance = editRsvp.getByRole("combobox", { name: /^(Example|Updated) Guest · / });
      assert.equal(await attendance.inputValue(), "attending");
      await attendance.selectOption("declined");
      const foodChoice = editRsvp.getByRole("combobox", { name: "Food interest", exact: true });
      assert.equal(await foodChoice.inputValue(), "false");
      await foodChoice.selectOption("true");
      await editRsvp.getByRole("button", { name: "Add guest", exact: true }).click();
      await editRsvp.getByLabel("First name", { exact: true }).fill("Forgotten");
      await editRsvp.getByLabel("Last name", { exact: true }).fill("Example");
      await editRsvp.getByLabel("Child guest", { exact: true }).check();
      const addedReply = editRsvp.getByRole("combobox", { name: sessionName, exact: true });
      const guestPencils = editRsvp.locator(".household-rsvp-guest-edit");
      assert.equal(await guestPencils.count(), await editRsvp.getByRole("combobox", { name: / · / }).count());
      const guestPencil = editRsvp.getByRole("button", { name: /^Edit guest.*Example Guest$/ });
      const pencilPosition = await guestPencil.boundingBox();
      const attendancePosition = await attendance.boundingBox();
      assert.ok(pencilPosition.x >= attendancePosition.x + attendancePosition.width,
        "The guest pencil appears to the right of the attendance field");
      const guestEdit = page.getByRole("dialog", { name: /^Edit guest/ });
      const guestFirstName = guestEdit.getByLabel("First name", { exact: true });
      const saveGuest = guestEdit.getByRole("button", { name: "Save", exact: true });
      const assertRsvpDraft = async (pencil) => {
        assert.equal(await attendance.inputValue(), "declined");
        assert.equal(await foodChoice.inputValue(), "true");
        assert.equal(await editRsvp.getByLabel("First name", { exact: true }).inputValue(), "Forgotten");
        assert.equal(await editRsvp.getByLabel("Child guest", { exact: true }).isChecked(), true);
        assert.equal(await pencil.evaluate(button => button === document.activeElement), true);
      };
      await guestPencil.click();
      assert.equal(await guestFirstName.inputValue(), "Example");
      await guestFirstName.fill("Discarded");
      await guestEdit.getByRole("button", { name: "Cancel", exact: true }).click();
      await guestEdit.waitFor({ state: "hidden" });
      await assertRsvpDraft(guestPencil);
      await guestPencil.click();
      assert.equal(await guestFirstName.inputValue(), "Example");
      await guestFirstName.fill("Updated");
      await page.evaluate(() => { window.__failGuestEdit = true; });
      await saveGuest.click();
      await guestEdit.getByText("Synthetic guest save failure", { exact: false }).waitFor();
      assert.equal(await guestFirstName.inputValue(), "Updated");
      assert.equal(await page.evaluate(() => window.__guestContactSaves || 0), 0);
      await saveGuest.click();
      await guestEdit.waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => window.__guestContactSaves), 1);
      await assertRsvpDraft(editRsvp.getByRole("button", { name: /^Edit guest.*Updated Guest$/ }));
      await review.click();
      await editRsvp.getByText("Answer all required RSVP questions for the new guest before saving.", { exact: true }).waitFor();
      assert.equal((await calls(editRpc)).length, 0);
      await addedReply.selectOption("attending");
      if (previewDir) await editRsvp.screenshot({ path: `${previewDir}/rsvp-dialog-${width}.png` });
      await review.click();
      await editRsvp.getByText(`Updated Guest · ${sessionName} · Not attending`, { exact: true }).waitFor();
      assert.equal((await calls(editRpc)).length, 0, "Reviewing changes sends no request");
      const note = editRsvp.getByLabel("Admin note", { exact: true });
      assert.equal(await note.isVisible(), false);
      await editRsvp.getByLabel("Add a note", { exact: true }).check();
      await note.fill("The guest confirmed by phone.");
      await page.evaluate(() => { window.__failRsvpEdit = true; });
      await confirmEdit.click();
      await editRsvp.getByText("Synthetic RSVP save failure", { exact: false }).waitFor();
      assert.equal(await note.inputValue(), "The guest confirmed by phone.");
      await confirmEdit.click();
      await editRsvp.waitFor({ state: "hidden" });
      await rsvp.getByText("Not attending", { exact: true }).waitFor();
      const [failed, saved] = await calls(editRpc);
      assert.deepEqual(saved, failed, "A failed save keeps the complete draft for retry");
      assert.equal(saved.p_household_id, id);
      assert.equal(saved.p_expected_submission_id, submissionId);
      assert.equal(saved.p_expected_state, rawState);
      assert.equal(saved.p_note, "The guest confirmed by phone.");
      assert.deepEqual(saved.p_changes.food, { interest: true, expected_interest: false });
      assert.deepEqual(saved.p_changes.responses.map(({ status, expected_status }) => [status, expected_status]), [["declined", "attending"], ["attending", null]]);
      const [added] = saved.p_changes.guests;
      assert.equal(added.id, saved.p_changes.responses[1].guest_id);
      assert.deepEqual({ ...added, id: "synthetic" }, { id: "synthetic", first_name: "Forgotten", last_name: "Example", is_child: true });
      await rsvp.getByText("Forgotten Example", { exact: true }).waitFor();
      assert.equal(await currentState.textContent(), "Locked", "A direct correction preserves the locked state");
      const beforeAccessRefresh = await invite.elementHandle();
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.households = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(row => !row.isConnected, beforeAccessRefresh);
      await invite.evaluate(row => { row.open = true; });
      await rsvp.evaluate(panel => { panel.open = true; });
      await openEdit.click();
      await attendance.waitFor();
      assert.equal(await guestPencils.count(), 0, "Guest editing requires Households edit access");
      await editRsvp.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(productionRequests,0,"installed-site fixtures make no production API requests");
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.close();
    }
    console.log(
      "PASS Household session editing, first-response late allowance and locked RSVP corrections with optional notes and retry at 390/1160px.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

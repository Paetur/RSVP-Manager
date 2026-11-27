// Synthetic delivery/navigation acceptance; never contact installation APIs.
const { chromium } = require("playwright");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-design-flow");
const seed = `
// This administrator has enabled the optional Phone action buttons.
window.__personalProfile={rsvp_interface_language:'en',rsvp_invites_profiles:{phone:{rows:1,showActions:true}}};
fixtures.event_settings[0].is_published=false;
fixtures.event_settings[0].guest_interface_modes={wide:{guest_title_visibility:{en:true,de:false},show_repeated_surname:false},phone:{guest_title_visibility:{en:false},show_repeated_surname:true}};
window.__designTemplates=[{id:'99999999-1111-4111-8111-111111111111',name:'Shared invitation',channels:['manual','whatsapp'],language_tags:['en'],revision:'design-template-v1',versions:{en:{subject:'Invitation',body:'Hello {household_name} {invitation_link}'}}}];
const designContact=fixtures.guests.find(guest=>guest.household_id===h2&&!guest.is_child);
Object.assign(designContact,{courtesy_title:'Ms.',language:'en'});
Object.assign(fixtures.households.find(h=>h.id===h2),{language:'en',primary_guest_id:designContact.id,record_revision:'household-design-1'});
fixtures.invitation_send_queue.push({id:'design-draft',household_id:h2,revision:1,status:'draft',channel:'manual',message_body:'Hello Example child {invitation_link}',template_id:window.__designTemplates[0].id,created_at:'2026-11-15T12:00:00Z',updated_at:'2026-11-15T12:00:00Z',invitation_code_snapshot:'EFGHJKLM',recipient_snapshot:{contact_name:'Sample'}});
window.__designWrites=[];
window.__designHouseholdWrites=[];
window.__designGuestWrites=[];
const designRpc=client.rpc;
client.rpc=async(name,args)=>{
  if(name==='admin_load_data'){const result=await designRpc(name,args);result.data.invitationTemplates=window.__designTemplates;return result;}
  if(name==='admin_save_household'){
    window.__designHouseholdWrites.push(args);
    if(window.__designHouseholdFail){window.__designHouseholdFail=false;return {error:{message:'Synthetic household save failure'}};}
    const household=fixtures.households.find(row=>row.id===args.p_id);
    const {expected_revision,...values}=args.p_values;
    if(!household||household.record_revision!==expected_revision)return {error:{message:'Synthetic stale household revision'}};
    Object.assign(household,values,{record_revision:'household-design-2'});
    return {data:household.id};
  }
  if(name==='admin_save_guest_details'){
    window.__designGuestWrites.push(args);
    if(window.__designGuestFail){window.__designGuestFail=false;return {error:{message:'Synthetic guest save failure'}};}
    const result=await designRpc(name,args);
    if(!result.error&&Object.hasOwn(args.p_values,'invitation_salutation'))
      fixtures.guests.find(guest=>guest.id===(args.p_guest_id||result.data)).invitation_salutation=args.p_values.invitation_salutation;
    return result;
  }
  if(name==='admin_save_delivery'){
    window.__designWrites.push(args);
    if(window.__designFail){window.__designFail=false;return {error:{message:'Synthetic save failure'}};}
    const h=fixtures.households.find(h=>h.id===args.p_household_id);
    const previous=fixtures.invitation_send_queue.find(q=>q.id===args.p_id);
    const q={...previous,...args.p_values,id:args.p_id||'design-draft',household_id:h.id,revision:(previous?.revision||0)+1,created_at:'2026-11-15T12:00:00Z',updated_at:'2026-11-15T12:01:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Sample'}};
    fixtures.invitation_send_queue=fixtures.invitation_send_queue.filter(x=>x.id!==q.id).concat(q);
    return {data:q.id};
  }
  return designRpc(name,args);
};`;

async function checkGuestSalutation(page, household, householdId) {
  const guestId = "55555555-5555-4555-8555-555555555555";
  const guest = household.locator(`[data-guest-id="${guestId}"]`);
  const pencil = guest.getByRole("button", { name: "Edit guest: Ms. Example Guest", exact: true });
  const form = guest.locator(`[data-form-key="guest:${guestId}"]`);
  const salutation = form.locator("fieldset.guest-salutation");
  const nickname = form.getByLabel("Salutation or nickname", { exact: true });
  const display = form.locator("details.guest-name-display");
  const titles = display.getByLabel("Titles", { exact: true });
  const surname = display.getByLabel("Show repeated surname", { exact: true });
  const format = salutation.locator(".token-text-editor");
  const formatValue = salutation.locator(".token-text-value");
  const chips = format.locator('.token-text-chip[draggable="true"]');
  const language = form.locator('label:has(> span:text-is("Language")) > select');
  const preview = salutation.locator("output");
  const save = form.getByRole("button", { name: "Save", exact: true });
  const defaultFormat = "{titles} {firstname} {lastname}";
  async function openDisplay() {
    if (!await display.evaluate(node => node.open)) await display.locator("summary").click();
  }

  await pencil.click();
  assert.equal(await form.getByRole("group", { name: "Invitation salutation", exact: true }).count(), 1);
  assert.equal(await salutation.getByLabel("Salutation or nickname", { exact: true }).count(), 0);
  assert.equal(await nickname.isVisible(), true);
  assert.equal(await titles.isVisible(), false);
  assert.equal(await save.isDisabled(), true);
  assert.equal(await formatValue.inputValue(), defaultFormat);
  assert.equal(await chips.count(), 3);
  assert.doesNotMatch(await format.innerText(), /[{}]/);
  assert.equal(await preview.textContent(), "Ms. Example Guest");
  await openDisplay();
  assert.equal(await titles.inputValue(), "");
  assert.equal(await surname.inputValue(), "");
  await language.selectOption("de");
  assert.equal(await preview.textContent(), "Example Guest");
  await titles.selectOption("false");
  await language.selectOption("en");
  assert.equal(await preview.textContent(), "Example Guest", "an explicit override persists across language changes");
  await titles.selectOption("");
  assert.equal(await preview.textContent(), "Ms. Example Guest");
  await chips.nth(2).dragTo(chips.nth(1), { targetPosition: { x: 2, y: 8 } });
  assert.match(await formatValue.inputValue(), /\{titles\}\s*\{lastname\}\s*\{firstname\}/);
  assert.equal(await preview.textContent(), "Ms. Guest Example");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__designGuestWrites.length), 0);

  await pencil.click();
  assert.equal(await formatValue.inputValue(), defaultFormat);
  await format.fill("");
  await salutation.getByRole("button", { name: "Available placeholders · Salutation format", exact: true }).click();
  assert.deepEqual(await salutation.locator(".placeholder-help code").allTextContents(), ["{titles}", "{firstname}", "{lastname}", "{relation}", "{nickname}"]);
  await salutation.getByRole("button", { name: "Insert {relation}", exact: true }).click();
  assert.equal(await preview.textContent(), "Cousin");
  await format.locator(".token-text-remove").click();
  assert.equal(await chips.count(), 0);
  await salutation.getByRole("button", { name: "Insert {nickname}", exact: true }).click();
  assert.equal(await formatValue.inputValue(), "{nickname}");
  await nickname.fill("{Mom}");
  assert.equal(await nickname.evaluate(input => input.validity.customError), true);
  await nickname.fill("Mom");
  assert.equal(await preview.textContent(), "Mom");
  await openDisplay();
  // Preserve an explicit Hide even while the guest inherits Hide in German.
  await language.selectOption("de");
  await titles.selectOption("false");
  await surname.selectOption("true");
  await page.evaluate(() => { window.__designGuestFail = true; });
  await save.click();
  await form.locator('.form-feedback[data-state="error"]').waitFor();
  assert.equal(await preview.textContent(), "Mom");
  await save.click();
  await form.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.__designGuestWrites.at(-1).p_values.invitation_salutation),
    { pattern: "{nickname}", nickname: "Mom", show_titles: false, show_repeated_surname: true });
  await pencil.click();
  assert.equal(await preview.textContent(), "Mom");
  await salutation.getByRole("button", { name: "Use default format", exact: true }).click();
  assert.equal(await preview.textContent(), "Example Guest");
  await openDisplay();
  assert.equal(await titles.inputValue(), "false");
  assert.equal(await surname.inputValue(), "true");
  await titles.selectOption("");
  assert.equal(await preview.textContent(), "Example Guest");
  await language.selectOption("en");
  assert.equal(await preview.textContent(), "Ms. Example Guest");
  assert.equal(await nickname.inputValue(), "Mom");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();

  const add = household.locator(`[data-form-key="guest:${householdId}:new"]`);
  const addSalutation = add.locator("fieldset.guest-salutation");
  await add.locator("xpath=..").locator(":scope > summary").click();
  await add.getByLabel("First name", { exact: true }).fill("Sample guest");
  assert.equal(await addSalutation.locator(".token-text-value").inputValue(), defaultFormat);
  assert.equal(await addSalutation.locator("output").textContent(), "Sample guest");
  await add.getByLabel("Salutation or nickname", { exact: true }).fill("Sam");
  assert.equal(await addSalutation.locator("output").textContent(), "Sample guest");
  await addSalutation.locator(".token-text-editor").fill("");
  await addSalutation.getByRole("button", { name: "Available placeholders · Salutation format", exact: true }).click();
  await addSalutation.getByRole("button", { name: "Insert {nickname}", exact: true }).click();
  assert.equal(await addSalutation.locator("output").textContent(), "Sam");
  await add.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`[data-tree-key="household:${id}"] .household-guest-list`)?.textContent.includes("Sample guest"), householdId);
  assert.deepEqual(await page.evaluate(() => {
    const { p_guest_id, p_household_id, p_values } = window.__designGuestWrites.at(-1);
    return [p_guest_id, p_household_id, p_values.invitation_salutation];
  }), [null, householdId, { pattern: "{nickname}", nickname: "Sam" }]);
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = process.env.RSVP_TEST_BASE_URL || "http://127.0.0.1:" + server.address().port;
  const output = process.env.RSVP_DESIGN_ARTIFACTS || path.join(process.cwd(), "artifacts", "admin-design-flow");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
      const errors = [], requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (dialog) => dialog.accept());
await require("./helpers/admin-toolbar.cjs").autoConfirmInline(page);

      await page.addInitScript(() => localStorage.setItem("rsvp-interface-language", "en"));
      await page.route("**/supabase.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: mock + "\n" + extra + "\n" + seed }));
      await page.route("**/js/config.js?*", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};' }));
      await page.route(/\/(rest|auth|functions)\/v1\//, (r) => { requests.push(r.request().url()); return r.abort(); });
      await page.route("**/admin/", async (r) => {
        const response = await r.fetch();
        await r.fulfill({ response, body: (await response.text()).replace(/ integrity="[^"]+"/g, "") });
      });
      await page.goto(base + "/admin/");
      await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
      assert.equal(await page.locator('[data-panel="overview"],[data-tab="overview"]').count(), 0);
      assert.equal(await page.locator('[data-panel="invites"] #statsGrid').count(), 1);
      await page.locator('[data-tab="invites"]').click();
      assert.equal(await page.locator("#statsGrid").isVisible(), true);
      await page.locator('[data-tab="invites"]').press("ArrowRight");
      assert.equal(await page.locator('[data-tab="events"]').getAttribute("aria-selected"), "true");
      await page.locator('[data-tab="events"]').press("ArrowLeft");
      assert.equal(await page.locator('[data-tab="invites"]').getAttribute("aria-selected"), "true");
      const household = page.locator('#inviteRows [data-invite-household="22222222-2222-4222-8222-222222222222"]');
      assert.equal(await household.locator(".invite-create,.invite-share,.invite-row-actions").count(), 0);
      const summary = household.locator(":scope > summary");
      const name = summary.locator(".invite-compact-name");
      const phone = width < 512;
      const actionsSelector = phone ? ":scope > .invite-household-content .invite-expanded-actions" : ":scope > summary .invite-overview-select";
      const actions = household.locator(actionsSelector);
      if (phone) {
        assert.equal(await summary.locator(".invite-preview,.invite-edit-household").count(), 0);
        if (!(await household.evaluate(node => node.open))) await summary.click();
      }
      const preview = actions.locator(":scope > a.invite-preview");
      await preview.waitFor();
      assert.equal(await preview.innerText(), "");
      assert.equal(await preview.locator("svg").count(), 1);
      assert.equal(await preview.getAttribute("aria-label"), "Preview · " + await name.textContent());
      const householdId = await household.getAttribute("data-invite-household");
      assert.equal(new URL(await preview.getAttribute("href")).hash, "#guest-preview=" + householdId);
      assert.equal(await preview.getAttribute("target"), "_blank");
      const pencil = actions.locator(":scope > .invite-preview + .invite-edit-household");
      const dialog = page.locator("dialog.household-details-dialog");
      const householdName = dialog.getByLabel("Name", { exact: true });
      const householdSave = dialog.getByRole("button", { name: "Save", exact: true });
      const originalName = await name.textContent();
      const initiallyOpen = await household.evaluate(node => node.open);
      const waitForPencilFocus = () => pencil.and(page.locator(":enabled:focus")).waitFor();
      await pencil.press("Enter");
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("heading", { name: "Household details · " + originalName, exact: true }).count(), 1);
      assert.equal(await dialog.getByRole("group", { name: "Invitation salutation", exact: true }).count(), 0);
      assert.equal(await page.locator('[data-tab="invites"]').getAttribute("aria-selected"), "true");
      assert.equal(await household.evaluate(node => node.open), initiallyOpen);
      assert.equal(await householdName.evaluate(input => input === document.activeElement), true);
      assert.equal(await householdSave.isDisabled(), true);
      await householdName.fill("Discard this household change");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitForPencilFocus();
      assert.equal(await name.textContent(), originalName);
      assert.equal(await page.evaluate(() => window.__designHouseholdWrites.length), 0);

      await pencil.click();
      assert.equal(await householdName.inputValue(), originalName);
      assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      const updatedName = "Renamed example child";
      await householdName.fill(updatedName);
      await page.evaluate(() => { window.__designHouseholdFail = true; });
      await householdSave.click();
      await dialog.locator('.form-feedback[data-state="error"]').waitFor();
      assert.equal(await householdName.inputValue(), updatedName);
      assert.equal(await name.textContent(), originalName);
      await householdSave.click();
      await dialog.waitFor({ state: "hidden" });
      await waitForPencilFocus();
      assert.equal(await name.textContent(), updatedName);
      assert.deepEqual(await page.evaluate(() => window.__designHouseholdWrites.map(write => [write.p_id, write.p_values.expected_revision])),
        [[householdId, "household-design-1"], [householdId, "household-design-1"]]);
      assert.equal(await page.evaluate(() => window.__designHouseholdWrites.some(write => Object.hasOwn(write.p_values, "invitation_salutation"))), false);

      await page.locator('[data-tab="households"]').click();
      const householdDetails = page.locator('[data-tree-key="household:' + householdId + '"]');
      await householdDetails.evaluate(node => {
        for (let parent = node; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
        node.querySelectorAll("details:not(.guest-name-display)").forEach(detail => { detail.open = true; });
      });
      assert.equal(await householdDetails.locator(".delivery-create").count(), 0);
      await checkGuestSalutation(page, householdDetails, householdId);
      const viewInInvites = householdDetails.getByRole("link", { name: "View in Invites", exact: true, includeHidden: true });
      await viewInInvites.evaluate(link => {
        for (let detail = link.closest("details"); detail; detail = detail.parentElement.closest("details")) detail.open = true;
      });
      await viewInInvites.click();
      assert.equal(await page.locator('[data-tab="invites"]').getAttribute("aria-selected"), "true");
      const draftRecord = household.locator('[data-invite-delivery-submenu="drafts"] [data-delivery-id="design-draft"]');
      const editSummary = draftRecord.getByText("Edit delivery", { exact: true });
      await editSummary.click();
      const form = draftRecord.locator('[data-form-key="delivery:design-draft"]');
      assert.equal(await form.locator(".delivery-customize").getAttribute("open"), null);
      assert.match(await form.locator(".delivery-draft-preview").innerText(), /Hello.*\{invitation_link\}/);
      assert.equal(await form.getByLabel("Delivery status", { exact: true }).locator('[value=ready]').count(), 0);
      await form.locator(".delivery-customize > summary").click();
      const body = form.getByLabel("Message text", { exact: true });
      await body.fill("Discard this override {invitation_link}");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.match(await body.inputValue(), /^Hello/);
      await form.getByLabel("Delivery channel", { exact: true }).selectOption("whatsapp");
      await body.fill("A household-specific message {invitation_link}");
      await page.evaluate(() => { window.__designFail = true; });
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await form.locator('.form-feedback[data-state="error"]').waitFor();
      assert.match(await body.inputValue(), /household-specific/);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => fixtures.invitation_send_queue.some(q => q.id === "design-draft" && q.revision === 2));
      assert.equal(await page.evaluate(() => window.__designWrites.at(-1).p_values.status), "draft");
      assert.equal(await page.evaluate(() => window.__designTemplates[0].versions.en.body), "Hello {household_name} {invitation_link}");
      assert.equal(await page.evaluate(() => window.__calls.some(c => c.name === "admin_record_delivery_sent")), false);
      await page.locator("#settingsToggle").click();
      await page.locator('[data-settings-tab="templates"]').click();
      const album = page.locator(".invitation-album");
      await album.locator(":scope > summary").click();
      assert.equal(await album.locator('.settings-card-heading [data-local-edit="invitation-album-add"]').innerText(), "Add picture");
      await album.getByRole("button", { name: "Add picture", exact: true }).click();
      assert.equal(await album.locator('form input[type="text"]').isVisible(), true);
      await album.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.locator('[data-settings-tab="interface"]').click();
      const appearancePreview = page.locator('#guestAppearanceHost details.guest-appearance-preview');
      if (!(await appearancePreview.evaluate(node => node.open))) await appearancePreview.locator(':scope > summary').click();
      const sample = appearancePreview.locator('.customization-sample');
      assert.equal(await sample.locator('.rsvp-inline input[type="radio"]').count(), 2);
      await sample.locator('.radio-pill').last().click();
      assert.equal(await sample.locator('.radio-pill input').last().isChecked(), true);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-interface.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      }
      await sample.screenshot({ path: path.join(output, `${width}-attendance.png`) });
      if (width < 700) {
        const sizes = await page.locator('.settings-card-pencil:visible').evaluateAll((ns) => ns.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
        assert.ok(sizes.length && sizes.every(x => x.w >= 44 && x.h >= 44), JSON.stringify(sizes));
      }
      await page.locator('#mainSectionToggle').click();
      for (const name of ['invites', 'households', 'food']) {
        await page.locator(`[data-tab="${name}"]`).click();
        if (name === 'households') await page.locator('#householdRows details').evaluateAll(ns => ns.forEach(n => { n.open = true; }));
        if (name === 'food') await page.locator('.food-compact-item').first().getByRole('button', { name: 'Edit food item', exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + ' fits ' + width);
        if (width < 700) {
          const fonts = await page.locator('#adminApp input:not([type=checkbox]):not([type=radio]):not([type=hidden]):visible,#adminApp select:visible,#adminApp textarea:visible').evaluateAll(ns => ns.map(n => Number.parseFloat(getComputedStyle(n).fontSize)));
          assert.ok(fonts.every(n => n >= 16), name + ' editable text: ' + JSON.stringify(fonts));
        }
        await page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: true });
      }
      // Publication is simulated only in the fixture. Ready saves never send.
      await page.evaluate(() => { fixtures.event_settings[0].is_published = true; });
      await refreshFixture(page);
      await page.waitForFunction(() => !document.querySelector('#refreshButton').disabled);
      await page.locator('#mainSectionToggle').click();
      await page.locator('[data-tab="invites"]').click();
      const h = page.locator('#inviteRows [data-invite-household="22222222-2222-4222-8222-222222222222"]');
      assert.equal(await page.locator('.invite-edit-household').count(), 0, 'unpublished edit shortcut is hidden after publication');
      assert.equal(new URL(await preview.getAttribute("href")).hash, "#guest-preview=" + householdId);
      assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Actions', { exact: true }).count(), 0);
      await h.locator(':scope > summary .invite-review-action').click();
      const fresh = draftRecord.locator('[data-form-key="delivery:design-draft"]');
      if (!(await fresh.isVisible())) await editSummary.click();
      await fresh.getByLabel('Delivery status', { exact: true }).selectOption('ready');
      await fresh.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => window.__designWrites.some(x => x.p_values.status === 'ready'));
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      await page.close();
    }
    console.log("PASS household details, guest Add/Edit salutations, save retry and focus, published preview, delivery draft edits, navigation, album header and 44px phone pencils at 320/390/1160px.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });

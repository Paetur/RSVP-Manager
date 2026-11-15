// Synthetic delivery/navigation acceptance; never contact installation APIs.
const { chromium } = require("playwright");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-design-flow");
const seed = `
fixtures.event_settings[0].is_published=false;
window.__designTemplates=[{language_code:'en',channel:'whatsapp',subject:'Invitation',body:'Hello {household_name} {invitation_link}'}];
window.__designWrites=[];
const designRpc=client.rpc;
client.rpc=async(name,args)=>{
  if(name==='admin_load_data'){const result=await designRpc(name,args);result.data.invitationTemplates=window.__designTemplates;return result;}
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
      await page.waitForFunction(() => document.querySelectorAll("#statsGrid .stat-card").length === 4);
      assert.equal(await page.locator('[data-panel="overview"] #statsGrid').count(), 1);
      assert.equal(await page.locator('[data-panel="invites"] #statsGrid').count(), 0);
      await page.locator('[data-tab="overview"]').click();
      assert.equal(await page.locator("#statsGrid").isVisible(), true);
      await page.locator('[data-tab="overview"]').press("ArrowRight");
      assert.equal(await page.locator('[data-tab="invites"]').getAttribute("aria-selected"), "true");
      const household = page.locator("#inviteRows [data-invite-household]").first();
      const rowActions = household.locator(":scope > summary .invite-row-actions");
      assert.equal(await rowActions.locator(":scope > :nth-child(2)").innerText(), "Create");
      const preview = rowActions.getByRole("link", { name: /^Preview/ });
      assert.equal(await preview.innerText(), "");
      assert.equal(await preview.locator("svg").count(), 1);
      assert.equal(await rowActions.locator(":scope > :nth-child(3)").getAttribute("title"), "Preview");
      const householdId = await household.getAttribute("data-invite-household");
      await rowActions.locator(".invite-edit-household").click();
      assert.equal(await page.locator('[data-tab="households"]').getAttribute("aria-selected"), "true");
      const householdForm = page.locator('#household-form-' + householdId);
      assert.equal(await householdForm.isVisible(), true);
      assert.equal(await householdForm.getByLabel('Name', { exact: true }).evaluate(input => input === document.activeElement), true);
      const householdDetails = page.locator('[data-tree-key="household:' + householdId + '"]');
      await householdDetails.evaluate(node => {
        for (let parent = node; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
        node.querySelectorAll("details").forEach(detail => { detail.open = true; });
      });
      assert.equal(await householdDetails.locator(".delivery-create").count(), 0);
      assert.match(await householdDetails.innerText(), /No delivery recorded yet/);
      await householdDetails.getByRole("link", { name: "View in Invites", exact: true }).click();
      assert.equal(await page.locator('[data-tab="invites"]').getAttribute("aria-selected"), "true");
      assert.equal(await household.getAttribute("open"), "");
      assert.equal(await household.locator('#invite-delivery-' + householdId).getAttribute("open"), "");
      await household.getByRole("button", { name: "Create", exact: true }).click();
      const create = household.locator(".delivery-create"), form = create.locator("form");
      await form.getByLabel("Delivery channel", { exact: true }).selectOption("whatsapp");
      assert.equal(await form.locator(".delivery-customize").getAttribute("open"), null);
      assert.match(await form.locator(".delivery-draft-preview").innerText(), /Hello.*\{invitation_link\}/);
      assert.equal(await form.getByRole("button", { name: "Mark ready", exact: true }).count(), 0);
      await form.locator(".delivery-customize > summary").click();
      const body = form.getByLabel("Message text", { exact: true });
      await body.fill("Discard this override {invitation_link}");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await body.inputValue(), "{invitation_link}");
      await form.getByLabel("Delivery channel", { exact: true }).selectOption("whatsapp");
      await body.fill("A household-specific message {invitation_link}");
      await page.evaluate(() => { window.__designFail = true; });
      await form.getByRole("button", { name: "Save draft", exact: true }).click();
      await form.locator('.form-feedback[data-state="error"]').waitFor();
      assert.match(await body.inputValue(), /household-specific/);
      await form.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.waitForFunction(() => fixtures.invitation_send_queue.some(q => q.id === "design-draft"));
      assert.equal(await page.evaluate(() => window.__designWrites[1].p_values.status), "draft");
      assert.equal(await page.evaluate(() => window.__designTemplates[0].body), "Hello {household_name} {invitation_link}");
      assert.equal(await page.evaluate(() => window.__calls.some(c => c.name === "admin_record_delivery_sent")), false);
      await page.locator("#settingsToggle").click();
      await page.locator('[data-settings-tab="templates"]').click();
      const album = page.locator(".invitation-album");
      assert.equal(await album.locator('.settings-card-heading [data-local-edit="invitation-album-add"]').innerText(), "Add picture");
      await album.getByRole("button", { name: "Add picture", exact: true }).click();
      assert.equal(await album.locator('form input[type="text"]').isVisible(), true);
      await album.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.locator('[data-settings-tab="interface"]').click();
      assert.equal(await page.locator('.customization-sample .rsvp-inline input[type="radio"]').count(), 2);
      await page.locator('.customization-sample .radio-pill').last().click();
      assert.equal(await page.locator('.customization-sample .radio-pill input').last().isChecked(), true);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-interface.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      }
      await page.locator('.customization-sample').screenshot({ path: path.join(output, `${width}-attendance.png`) });
      if (width < 700) {
        const sizes = await page.locator('.settings-card-pencil:visible').evaluateAll((ns) => ns.map(n => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height })));
        assert.ok(sizes.length && sizes.every(x => x.w >= 44 && x.h >= 44), JSON.stringify(sizes));
      }
      await page.locator('#mainSectionToggle').click();
      for (const name of ['overview', 'households', 'food']) {
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
      const h = page.locator('#inviteRows [data-invite-household]').first();
      assert.equal(await page.locator('.invite-edit-household').count(), 0, 'unpublished edit shortcut is hidden after publication');
      await h.evaluate(n => { n.open = true; });
      await h.locator('details').evaluateAll(ns => ns.forEach(n => { n.open = true; }));
      await h.locator('.delivery-create').evaluate(n => { n.hidden = false; });
      const fresh = h.locator('.delivery-create form');
      await fresh.getByLabel('Delivery channel', { exact: true }).selectOption('whatsapp');
      await fresh.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await page.waitForFunction(() => window.__designWrites.some(x => x.p_values.status === 'ready'));
      assert.equal(await page.evaluate(() => window.__calls.some(c => c.name === 'admin_record_delivery_sent')), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      await page.close();
    }
    console.log("PASS template review/customize/Cancel/failure retry, unchanged templates, draft/ready without sending, Overview, navigation, album header, shared attendance and 44px phone pencils at 320/390/1160px.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });

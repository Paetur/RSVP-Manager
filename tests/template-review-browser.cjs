// Actual template controls with synthetic records; no live event or delivery.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("template-review");
const jpeg = "data:image/jpeg;base64," + fs.readFileSync("tests/fixtures/customization.jpg").toString("base64");
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => { if (window === window.top) localStorage.setItem("rsvp-interface-language", "en"); });
      const seed = `
fixtures.event_settings[0].invitation_picture_album=[{id:'album-example',name:'Example picture',picture:${JSON.stringify({ image: jpeg })}}];
window.__named=[{id:'99999999-1111-4111-8111-111111111111',name:'Existing invitation',channels:['email','manual'],versions:{en:{subject:'Invite {event_name}',body:'Reply by {invite-deadline:+4}: {invitation_link}',short_body:'Short {invite-deadline}',options:['subject','message','picture'],message_image:null,context_venue_id:null,context_session_id:null}}}];
window.__templateSaves=[];
const earlierTemplateRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_load_data'){const result=await earlierTemplateRpc(name,args);result.data.invitationTemplates=structuredClone(window.__named);return result;}
 if(name==='admin_save_invitation_template'){
  window.__templateSaves.push(structuredClone(args));
  if(window.__failTemplateSave){window.__failTemplateSave=false;return {error:{message:'Synthetic template failure'}};}
  const id=args.p_id||crypto.randomUUID();window.__named=window.__named.filter(template=>template.id!==id);window.__named.push({id,...args.p_values});return {data:id};
 }
 return earlierTemplateRpc(name,args);
};`;
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + seed);
      const base = "http://127.0.0.1:" + server.address().port;
      assert.equal((await page.request.get(base + "/internal/docs/codex-handover.md")).status(), 404);
      await page.goto(base + "/admin/");
      await page.waitForFunction(() => document.querySelectorAll("#statsGrid .stat-card").length === 4);
      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=templates]").click();
      const album = page.locator(".invitation-album");
      await album.locator('[data-local-edit="invitation-album-add"]').click();
      const albumForm = album.locator('[data-form-key="invitation-album-add"]');
      assert.equal(await albumForm.isVisible(), true);
      assert.equal(await albumForm.evaluate(node => node.parentElement.compareDocumentPosition(node.closest(".invitation-album").querySelector(".invitation-album-grid")) & Node.DOCUMENT_POSITION_FOLLOWING), 4, "Add picture editor opens before the existing album tiles");
      await albumForm.locator("[data-discard]").click();
      const existing = page.locator('[data-settings-card="invitation-template:99999999-1111-4111-8111-111111111111"]');
      await existing.locator(".local-editor-pencil").click();
      const form = existing.locator("form"), short = form.locator('input[aria-label="Short Message"]'), body = form.getByLabel("Message text", { exact: true });
      assert.equal(await short.isVisible(), false, "unchecked Short Message is not displayed");
      assert.equal(await short.inputValue(), "Short {invite-deadline}", "hidden legacy content is retained");
      assert.equal(await form.locator(".template-placeholder-issue").count(), 2, "hidden content also receives an actionable warning");
      assert.match(await page.evaluate(() => window.__named[0].versions.en.body), /invite-deadline/, "render does not rewrite stored templates");
      await form.locator('[data-replace-placeholder="{invite-deadline:+4}"]').click();
      assert.equal(await body.inputValue(), "Reply by {rsvp_deadline:+4}: {invitation_link}");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      const feedback = form.locator('.form-feedback[data-state=error]');
      await feedback.waitFor();
      assert.match(await feedback.textContent(), /Short Message.*\{invite-deadline\}/s, "error identifies field and actual token");
      assert.equal(await page.evaluate(() => window.__templateSaves.length), 0, "unknown token remains rejected before any save RPC");
      await form.locator('[data-replace-placeholder="{invite-deadline}"]').click();
      assert.equal(await short.isVisible(), false);
      assert.equal(await short.inputValue(), "Short {rsvp_deadline}");
      assert.match(await page.evaluate(() => window.__named[0].versions.en.short_body), /invite-deadline/);
      await form.locator("[data-discard]").click();
      await existing.locator(".local-editor-pencil").click();
      assert.equal(await body.inputValue(), "Reply by {invite-deadline:+4}: {invitation_link}", "Cancel restores original wording");
      for (const token of ["{invite-deadline:+4}", "{invite-deadline}"]) await form.locator('[data-replace-placeholder="' + token + '"]').click();
      await page.evaluate(() => window.__failTemplateSave = true);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await form.locator('.form-feedback[data-state=error]').waitFor();
      assert.equal(await body.inputValue(), "Reply by {rsvp_deadline:+4}: {invitation_link}", "failed save retains explicit correction");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__templateSaves.length === 2 && window.__named[0].versions.en.body.includes("rsvp_deadline"));
      await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
      assert.match(await page.evaluate(() => window.__templateSaves[1].p_expected.versions.en.body), /invite-deadline/, "original full expected snapshot is retained");

      const add = page.locator("details.template-create");
      assert.equal(await add.evaluate(node => node.open), false);
      assert.equal(await add.evaluate(node => node.classList.contains("admin-management")), true, "Add template uses Add venue's common disclosure");
      await add.locator(":scope > summary").click();
      const fresh = add.locator('[data-form-key="invitation-template:new"]');
      await fresh.getByLabel("Name", { exact: true }).fill("New invitation");
      await add.locator(":scope > summary").click();
      assert.equal(await fresh.evaluate(node => node.isConnected), true, "closing disclosure keeps its new draft");
      await add.locator(":scope > summary").click();
      assert.equal(await fresh.getByLabel("Name", { exact: true }).inputValue(), "New invitation");
      await refreshFixture(page);
      await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
      assert.equal(await fresh.getByLabel("Name", { exact: true }).inputValue(), "New invitation", "refresh retains the unsaved new template");
      await fresh.locator("[data-discard]").click();
      assert.equal(await add.evaluate(node => node.open), false, "Cancel closes the current disclosure after refresh");
      await add.locator(":scope > summary").click();
      await fresh.getByLabel("Name", { exact: true }).fill("New invitation");
      const option = key => fresh.locator('.template-options input[value="' + key + '"]');
      const freshShort = fresh.locator('input[aria-label="Short Message"]');
      assert.equal(await freshShort.isVisible(), false);
      await option("shortMessage").check();
      await freshShort.fill("Short retained {invitation_link}");
      await freshShort.locator("..").locator(".placeholder-help-toggle").click();
      assert.equal(await fresh.locator(".placeholder-help:not(.hidden)").count(), 1);
      await option("shortMessage").uncheck();
      assert.equal(await freshShort.isVisible(), false);
      assert.equal(await fresh.locator(".placeholder-help:not(.hidden)").count(), 0, "deselecting content closes its token help");
      assert.equal(await freshShort.inputValue(), "Short retained {invitation_link}");
      const choose = fresh.getByRole("button", { name: "Choose from album", exact: true });
      await choose.click();
      const picker = fresh.locator(".invitation-picture-editor > .invitation-album-dialog");
      await picker.waitFor();
      const geometry = await picker.evaluate(node => ({ top: node.getBoundingClientRect().top, buttonBottom: node.previousElementSibling.getBoundingClientRect().bottom, withinForm: !!node.closest("form") }));
      assert.equal(geometry.withinForm, true);
      assert.ok(geometry.top >= geometry.buttonBottom - 1, "picture picker opens directly under its button");
      await picker.getByRole("button", { name: "Example picture", exact: true }).click();
      await picker.waitFor({ state: "detached" });
      assert.equal(await fresh.locator('[data-invitation-picture]').inputValue(), JSON.stringify({ image: jpeg }));
      await choose.click(); await page.keyboard.press("Escape");
      await picker.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.activeElement?.textContent === "Choose from album");
      await option("picture").uncheck();
      assert.equal(await choose.isVisible(), false);
      await option("picture").check();
      assert.equal(await fresh.locator(".invitation-picture").isVisible(), true, "hidden picture is retained");
      const freshBody = fresh.getByLabel("Message text", { exact: true });
      await freshBody.fill("Unknown {not_supported}: {invitation_link}");
      await fresh.getByRole("button", { name: "Save", exact: true }).click();
      await fresh.locator('.form-feedback[data-state=error]').waitFor();
      assert.equal(await page.evaluate(() => window.__templateSaves.length), 2);
      await freshBody.fill("Current {event_name}, {household_name}, {rsvp_deadline:+4}: {invitation_link}");
      await fresh.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__named.length === 2);
      assert.equal(await page.evaluate(() => window.__templateSaves[2].p_values.versions.en.short_body), "Short retained {invitation_link}");
      assert.equal(await page.evaluate(() => window.__templateSaves[2].p_values.versions.en.options.includes("shortMessage")), false);
      assert.equal(await page.evaluate(() => window.__templateSaves[2].p_values.versions.en.message_image.image), jpeg);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS template review: common Add disclosure, option visibility/content preservation, anchored album picker, explicit per-field legacy correction, strict current-token validation, Cancel/failure/retry and expected snapshots at phone/wide widths.");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

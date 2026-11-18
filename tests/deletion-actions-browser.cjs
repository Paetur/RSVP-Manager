// Real administrator controls with synthetic APIs and a public-only asset snapshot.
const assert = require("node:assert/strict"), fs = require("node:fs"),
  os = require("node:os"), path = require("node:path"), { chromium } = require("playwright");
const sourceRoot = process.cwd(), publicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-delete-browser-"));
for (const name of ["admin", "css", "js", "locales"]) fs.cpSync(path.join(sourceRoot, name), path.join(publicRoot, name), { recursive: true });
process.chdir(publicRoot);
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("deletion-actions");
process.chdir(sourceRoot);
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1160, height: 900 } }), errors = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("rsvp-interface-language", "en"));
    const seed = `
fixtures.event_settings[0].is_published=false;
const exampleHousehold=fixtures.households.find(h=>h.invite_code&&!h.archived_at);
fixtures.invitation_send_queue=['draft-delete','draft-retained','draft-protected','ready-protected','sent-protected'].map((id,index)=>({id,household_id:exampleHousehold.id,channel:'manual',status:index===3?'ready':index===4?'sent':'draft',revision:7,created_at:'2026-11-16T12:00:00Z',updated_at:'2026-11-16T12:00:00Z',invitation_code_snapshot:exampleHousehold.invite_code,recipient_snapshot:{contact_name:'Synthetic recipient'},message_subject:'Saved invitation',message_body:'Hello synthetic guest: {invitation_link}'}));
fixtures.invitation_deliveries=[{id:'retained-history',queue_id:'draft-protected',confirmed_at:'2026-11-16T12:00:00Z',confirmed_by:h1}];
window.__named=[{id:'99999999-1111-4111-8111-111111111111',name:'Example template',channels:['email','manual'],versions:{en:{subject:'Example subject',body:'Hello {household_name}: {invitation_link}',options:['subject','message'],short_body:'',message_image:null,context_venue_id:null,context_session_id:null}}}];
window.__deleteCalls=[];
const earlierDeleteRpc=client.rpc;client.rpc=async(name,args)=>{
  if(name==='admin_load_data'){const result=await earlierDeleteRpc(name,args);result.data.invitationTemplates=structuredClone(window.__named);return result;}
  if(name==='admin_save_invitation_template'){
    if(window.__holdTemplateSave)await new Promise(resolve=>window.__finishTemplateSave=resolve);
    window.__named=window.__named.map(t=>t.id===args.p_id?{id:args.p_id,...args.p_values}:t);return {data:args.p_id};
  }
  if(name==='admin_delete_delivery_draft'||name==='admin_delete_invitation_template'){
    window.__deleteCalls.push({name,args});
    const flag=name==='admin_delete_delivery_draft'?'__failDraftDelete':'__failTemplateDelete';
    if(window[flag]){window[flag]=false;await new Promise(resolve=>setTimeout(resolve,40));return {error:{message:'Synthetic deletion failure'}};}
    if(name==='admin_delete_delivery_draft')fixtures.invitation_send_queue=fixtures.invitation_send_queue.filter(q=>q.id!==args.p_id);
    else window.__named=window.__named.filter(t=>t.id!==args.p_id);
    return {data:null};
  }
  return earlierDeleteRpc(name,args);
};`;
    await page.route("**/supabase.min.js", route => route.fulfill({ contentType: "text/javascript", body: mock + "\n" + extra + "\n" + seed }));
    const base = "http://127.0.0.1:" + server.address().port;
    assert.equal((await page.request.get(base + "/AGENTS.md")).status(), 404);
    assert.equal((await page.request.get(base + "/internal/docs/codex-handover.md")).status(), 404);
    await page.goto(base + "/admin/");
    await page.waitForFunction(() => document.querySelectorAll("#statsGrid .stat-card").length === 4);
    await page.locator("[data-tab=invites]").click();
    await page.locator("#inviteRows details.invite-household").evaluateAll(nodes => nodes.forEach(node => node.open = true));
    const record = page.locator("#inviteRows [data-delivery-id=draft-delete]");
    await record.waitFor({ state: "attached" });
    await record.evaluate(node => { for (let current = node; current; current = current.parentElement) if (current.tagName === "DETAILS") current.open = true; });
    const directDelete = record.locator(":scope > .delivery-read-actions [data-delete-draft]"), edit = record.locator("details").first(), form = edit.locator("form");
    assert.equal(await directDelete.isVisible(), true, "reading view exposes Delete without Edit delivery");
    assert.equal(await record.locator(":scope > .delivery-read-actions > .invite-text-action").innerText(), "Copy message");
    assert.equal(await edit.evaluate(node => node.open), false);
    for (const id of ["draft-protected", "ready-protected", "sent-protected"])
      assert.equal(await page.locator("#inviteRows [data-delivery-id=" + id + "] [data-delete-draft]").count(), 0, "protected record: " + id);
    if (process.env.RSVP_DELETE_PREVIEW) {
      fs.mkdirSync(process.env.RSVP_DELETE_PREVIEW, { recursive: true });
      await record.screenshot({ path: path.join(process.env.RSVP_DELETE_PREVIEW, "draft-delete-reading.png") });
    }
    await edit.locator(":scope > summary").click();
    await form.locator("details.delivery-customize > summary").click();
    const subject = form.getByLabel("Message subject", { exact: true });
    await subject.fill("Retained independent draft");
    await edit.locator(":scope > summary").click();
    await directDelete.click();
    const confirmation = record.locator(".inline-confirmation");
    assert.equal(await confirmation.count(), 1);
    await directDelete.evaluate(node => node.click());
    assert.equal(await confirmation.count(), 1, "repeated Delete keeps one pending decision");
    assert.equal(await form.getAttribute("aria-busy"), "true");
    assert.equal(await form.locator("button[type=submit]").isDisabled(), true);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await directDelete.isEnabled(), true);
    assert.equal(await subject.inputValue(), "Retained independent draft");
    assert.equal(await page.evaluate(() => window.__deleteCalls.length), 0);
    await page.evaluate(async () => {
      window.__accessPermissions.sections.invites = 'view';
      await window.RSVP_ADMIN_ACCESS.refresh(); window.RSVP_ADMIN_ACCESS.apply();
    });
    assert.equal(await directDelete.count(), 1, "permission refresh keeps the existing record");
    assert.equal(await directDelete.isVisible(), false, "permission downgrade hides Delete before rerender");
    await page.evaluate(async () => {
      window.__accessPermissions.sections.invites = 'edit';
      await window.RSVP_ADMIN_ACCESS.refresh(); window.RSVP_ADMIN_ACCESS.apply();
    });
    assert.equal(await directDelete.isVisible(), true);
    await page.evaluate(() => window.__failDraftDelete = true);
    await directDelete.click(); await confirmation.locator("[data-inline-confirm]").click();
    await page.waitForFunction(() => window.__deleteCalls.length === 1);
    await page.waitForFunction(() => !document.querySelector('#inviteRows [data-delivery-id=draft-delete] .delivery-read-actions [data-delete-draft]').disabled);
    assert.equal(await subject.inputValue(), "Retained independent draft", "failed deletion keeps editor draft");
    assert.equal(await directDelete.evaluate(node => document.activeElement === node), true, "failed draft deletion restores focus after its response");
    await directDelete.click(); await confirmation.locator("[data-inline-confirm]").click();
    await record.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.__deleteCalls[1].args.p_expected_revision), 7);
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);

    await page.locator("#settingsToggle").click();
    await page.locator("[data-settings-tab=templates]").click();
    const template = page.locator(".invitation-template[data-settings-card]").first();
    await template.locator(".local-editor-pencil").click();
    const templateForm = template.locator("form"), body = templateForm.getByLabel("Message text", { exact: true });
    await body.fill("Retained template draft: {invitation_link}");
    const remove = templateForm.locator(".editor-lifecycle-actions button");
    await page.setViewportSize({ width: 390, height: 700 });
    await remove.click();
    const templateConfirmation = template.locator(".inline-confirmation");
    assert.equal(await templateConfirmation.count(), 1);
    await remove.evaluate(node => node.click());
    assert.equal(await templateConfirmation.count(), 1);
    const rect = await templateConfirmation.boundingBox();
    assert.ok(rect.y >= -1 && rect.y + rect.height <= 701, "template confirmation is visible at footer");
    assert.equal(await templateConfirmation.locator('[data-inline-confirm] svg').isVisible(), false, "phone Delete is text only");
    if (process.env.RSVP_DELETE_PREVIEW) await template.screenshot({ path: path.join(process.env.RSVP_DELETE_PREVIEW, "template-delete-confirmation-phone.png") });
    await templateConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await body.inputValue(), "Retained template draft: {invitation_link}");
    assert.equal(await remove.isEnabled(), true);
    await page.evaluate(() => window.__failTemplateDelete = true);
    await remove.click(); await templateConfirmation.locator("[data-inline-confirm]").click();
    await page.waitForFunction(() => window.__deleteCalls.length === 3);
    await page.waitForFunction(() => !document.querySelector('.invitation-template .editor-lifecycle-actions button').disabled);
    assert.equal(await body.inputValue(), "Retained template draft: {invitation_link}");
    assert.equal(await page.evaluate(() => window.__deleteCalls[2].args.p_expected.name), "Example template", "delete uses saved expected snapshot");
    assert.equal(await remove.evaluate(node => document.activeElement === node), true, "failed template deletion restores focus after its response");

    // A real in-flight save must block deletion rather than race that save.
    await page.evaluate(() => window.__holdTemplateSave = true);
    await templateForm.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() => !!window.__finishTemplateSave);
    await remove.evaluate(node => node.click());
    assert.equal(await templateConfirmation.count(), 0, "Delete is ignored during an in-flight save");
    await page.evaluate(() => { window.__holdTemplateSave = false; window.__finishTemplateSave(); });
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await page.locator('.invitation-template .local-editor-pencil').click();
    await page.locator('.invitation-template .editor-lifecycle-actions button').click();
    await page.locator('.invitation-template [data-inline-confirm]').click();
    await page.waitForFunction(() => window.__named.length === 0);
    await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
    await page.waitForFunction(() => !document.querySelector(".invitation-template[data-settings-card]"));
    assert.equal(await page.locator(".invitation-template[data-settings-card]").count(), 0);
    assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.some(q => q.id === 'draft-retained')), true, "template deletion retains saved deliveries");
    await page.evaluate(() => { window.__accessPermissions.sections.invites = 'view'; });
    await refreshFixture(page);
    await page.locator("#mainSectionToggle").click(); await page.locator("[data-tab=invites]").click();
    await page.locator("#inviteRows details.invite-household").evaluateAll(nodes => nodes.forEach(node => node.open = true));
    assert.equal(await page.locator("#inviteRows [data-delete-draft]").count(), 0, "view permission exposes no destructive action");
    assert.deepEqual(errors, []);
    console.log("PASS draft/template Delete reading access, protected records, visible single confirmations, Cancel/failure draft preservation, retry, save concurrency and permissions; private files excluded.");
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(publicRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

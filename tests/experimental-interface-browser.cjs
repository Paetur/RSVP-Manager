// Published files and real controllers; account, RPC and backup encoding are synthetic.
// All account, batch and wipe operations use the synthetic SDK.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { refreshFixture, reopenDatabaseAfterRecovery, selectDatabaseTab, selectOverviewTab } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("experimental-interface");

const integration = `
fixtures.event_settings[0].apple_shortcuts_enabled=false;
fixtures.invitation_send_queue.push({id:'99999999-1111-4111-8111-111111111111',household_id:h2,
 revision:1,status:'ready',channel:'whatsapp',invitation_code_snapshot:fixtures.households.find(row=>row.id===h2).invite_code,
 message_body:'Synthetic invitation https://example.invalid/?invite=EFGHJKLM',
 recipient_snapshot:{contact_name:'Synthetic recipient',contact_value:'+12025550101'}});
window.__experimentalWrites=[];window.__authWrites=[];window.__wipeCalls=[];window.__wipePreparationCalls=[];
client.auth.getUser=async()=>({data:{user:sessionStorage.getItem('syntheticWipeSignedOut')?null:{id:h1,email:'test-admin@example.invalid',user_metadata:{
 rsvp_interface_language:'en',rsvp_interface_appearance:'dark',rsvp_interface_time_format:'24',unrelated:'preserved'}}}});
client.auth.signOut=async()=>{sessionStorage.setItem('syntheticWipeSignedOut','true');return {error:null};};
client.auth.updateUser=async values=>{window.__authWrites.push(values);return client.auth.getUser();};
const experimentalRpc=client.rpc;
client.rpc=async(name,args)=>{
 if(name==='admin_load_data'&&window.__failExperimentalReload){window.__failExperimentalReload=false;return {error:{message:'Synthetic reload failure'}};}
 if(name==='admin_set_shortcuts_enabled'){
  window.__experimentalWrites.push(structuredClone(args));
  if(window.__holdExperimental)await new Promise(resolve=>window.__releaseExperimental=resolve);
  if(window.__failExperimental){window.__failExperimental=false;return {error:{message:'Synthetic offline'}};}
  if(window.__malformedExperimental){window.__malformedExperimental=false;return {data:{enabled:'true'}};}
  if(window.__accessPermissions.sections.settings!=='edit')return {error:{message:'Synthetic permission changed'}};
  if(args.p_expected!==fixtures.event_settings[0].apple_shortcuts_enabled)return {error:{message:'Synthetic stale value'}};
  fixtures.event_settings[0].apple_shortcuts_enabled=args.p_enabled;
  if(window.__failReloadAfterExperimental){window.__failReloadAfterExperimental=false;window.__failExperimentalReload=true;}
  return {data:{enabled:args.p_enabled}};
 }
 if(name==='admin_preview_wipe_all'){
  window.__wipePreparationCalls.push({name,args:structuredClone(args)});
  return {data:{can_wipe:true,keep_current_admin:args.p_keep_current_admin,
  destination_state:'synthetic-destination-state',event_name:'Synthetic celebration',current_counts:{'public.households':3,'public.guests':2,'public.admins':1}}};}
 if(name==='admin_prepare_wipe_all'){
  window.__wipePreparationCalls.push({name,args:structuredClone(args)});
  return {data:{token:'99999999-2222-4222-8222-222222222222',
  keep_current_admin:args.p_keep_current_admin,destination_state:'synthetic-destination-state',
  current_counts:{'public.households':3},expires_at:new Date(Date.now()+300000).toISOString(),
  safety_backup:{format:'synthetic-backup',synthetic:true}}};}
 if(name==='get_setup_status')return {data:{initialized:false,setup_locked:false}};
 if(name==='admin_wipe_all'){
  window.__wipeCalls.push(name);
  if(!window.__testWipeCompletion)throw Error('Unexpected wipe in synthetic integration test');
  const calls=JSON.parse(sessionStorage.getItem('syntheticWipeCompletions')||'[]');
  calls.push(structuredClone(args));
  sessionStorage.setItem('syntheticWipeCompletions',JSON.stringify(calls));
  if(window.__failWipeCompletion)return {error:{message:'Synthetic wipe failed'}};
  const retained=args.p_keep_current_admin;
  return {data:{application_data_cleared:true,current_admin_retained:retained,sign_out_required:!retained,setup_required:!retained}};
 }
 if(name==='admin_create_shortcut_batch'){
  window.__wipeCalls.push(name);throw Error('Unexpected send operation in synthetic integration test');
 }
 return experimentalRpc(name,args);
};
`;

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1160, height: 900 } });
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => requests.push(request.url()));
    await page.addInitScript(() => localStorage.setItem("rsvp-interface-language", "en"));
    await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + integration);
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));
    const card = page.locator('#settingsInterfaceGeneral > [data-settings-card="experimental-shortcuts"]');
    const box = card.locator('[data-editor-key="experimental-shortcuts"]');
    const helper = card.getByText("Shortcuts synthetic test helper", { exact: true });
    const checkbox = page.locator("#shortcutExperimentalEnabled");
    const save = page.locator("#saveShortcutExperimental");
    const cancel = page.locator("#cancelShortcutExperimental");
    const writes = () => page.evaluate(() => window.__experimentalWrites);
    const interfaceTab = async () => {
      if (!await page.locator("#adminApp").evaluate(node => node.classList.contains("showing-settings")))
        await page.locator("#settingsToggle").click();
      await page.locator('[data-settings-tab="checklist"]').click();
    };
    const invitesTab = async () => {
      await page.locator("#mainSectionToggle").click();
      await page.locator('[data-tab="invites"]').click();
    };
    const workspace = page.locator('[data-panel="invites"] > #shortcutWorkspace');
    const refreshed = async () => {
      const prior = await page.evaluate(() => window.__fetchCount);
      await refreshFixture(page);
      await page.waitForFunction(prior => window.__fetchCount > prior && !document.getElementById("refreshButton").disabled, prior);
    };
    await invitesTab();
    assert.equal(await workspace.evaluate(node => node.hidden), true);
    assert.equal(await page.locator("#shortcutBatchHost").isHidden(), true);
    await interfaceTab();
    assert.equal(await card.getByRole("heading", { name: "Apple Shortcuts", exact: true }).isVisible(), true);
    assert.equal(await helper.isHidden(), true, "standard builds have no synthetic helper link");
    const helperUrl = "https://127.0.0.1:8443/shortcuts-test.html";
    await page.evaluate(url => { window.RSVP_CONFIG.shortcutsTestHelperUrl = url; }, helperUrl);
    await refreshed();
    assert.equal(await helper.isVisible(), true, "synthetic testing is available while real Shortcuts is disabled");
    assert.equal(await helper.getAttribute("href"), helperUrl);
    assert.equal(await helper.getAttribute("rel"), "noopener noreferrer");
    for (const invalid of [
      "https://elsewhere.invalid/shortcuts-test.html",
      "http://127.0.0.1:8443/shortcuts-test.html",
      helperUrl + "?unexpected=1",
    ]) {
      await page.evaluate(url => { window.RSVP_CONFIG.shortcutsTestHelperUrl = url; }, invalid);
      await refreshed();
      assert.equal(await helper.isHidden(), true);
      assert.equal(await helper.getAttribute("href"), null);
    }
    assert.match(await box.locator(".local-editor-summary").innerText(), /Disabled/);
    assert.equal(await checkbox.isVisible(), false, "initial setting is a read summary with a pencil");
    await openBox(page, "experimental-shortcuts");
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await save.isDisabled(), true);
    await checkbox.check();
    assert.equal(await save.isEnabled(), true);
    assert.equal((await writes()).length, 0, "checkbox stages the application setting");
    await cancel.click();
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await checkbox.isVisible(), false);
    assert.equal((await writes()).length, 0, "Cancel has no RPC or Auth side effect");
    checks.push("default disabled, pencil, local draft and Cancel");

    await openBox(page, "experimental-shortcuts");
    await checkbox.check();
    await page.evaluate(() => { window.__failExperimental = true; });
    await save.click();
    await page.locator('#shortcutExperimentalStatus[data-state="error"]').waitFor();
    assert.equal(await checkbox.isChecked(), true, "failed save preserves the proposed checkbox");
    assert.equal(await save.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__fixtures.event_settings[0].apple_shortcuts_enabled), false);
    assert.equal(await workspace.evaluate(node => node.hidden), true);
    assert.match(await page.locator("#shortcutExperimentalStatus").innerText(), /could not be saved/);
    checks.push("failed application save preserves draft and disabled feature");
    await page.evaluate(() => { window.__malformedExperimental = true; });
    await save.click();
    await page.waitForFunction(() => document.getElementById("shortcutExperimentalStatus").dataset.state === "error" &&
      document.getElementById("shortcutExperimentalForm").getAttribute("aria-busy") === "false");
    assert.equal(await checkbox.isChecked(), true);
    assert.equal(await save.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__fixtures.event_settings[0].apple_shortcuts_enabled), false);
    assert.equal(await workspace.evaluate(node => node.hidden), true, "malformed acknowledgment cannot enable the feature");
    checks.push("malformed save acknowledgment is rejected");

    // The personal preferences draft stays editable while the separate application setting saves.
    assert.equal(await page.locator("#personalPreferencesForm").isVisible(), true);
    await page.locator("#interfaceDateTimeTab").click();
    await page.locator('[data-preference-choices="time"] [data-preference-choice="12"]').click();
    assert.equal(await page.locator("#timeFormat").inputValue(), "12");
    assert.equal(await page.locator("#savePersonalPreferences").isEnabled(), true);
    await page.evaluate(() => { window.__holdExperimental = true; });
    await save.click();
    await page.locator('#shortcutExperimentalStatus[data-state="saving"]').waitFor();
    assert.equal(await checkbox.isDisabled(), true);
    assert.equal(await save.isDisabled(), true);
    assert.equal(await cancel.isDisabled(), true);
    await page.evaluate(() => { window.__holdExperimental = false; window.__releaseExperimental(); });
    await page.locator('#shortcutExperimentalStatus[data-state="saved"]').waitFor({ state: "attached" });
    assert.equal(await checkbox.isVisible(), false, "saved application card returns to its summary");
    assert.match(await box.locator(".local-editor-summary").innerText(), /Enabled/);
    assert.equal(await page.locator("#timeFormat").inputValue(), "12", "global reload preserves another Interface draft");
    assert.equal(await page.locator("#savePersonalPreferences").isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.deepEqual(await page.evaluate(() => window.RSVP.timeOptions()), { hourCycle: "h23" });
    assert.deepEqual(await page.evaluate(() => window.__authWrites), [], "experimental save never writes personal Auth metadata");
    assert.deepEqual(await writes(), Array.from({ length: 3 }, () => ({ p_enabled: true, p_expected: false })));
    await page.locator("#cancelPersonalPreferences").click();
    checks.push("independent application save, busy controls, Auth isolation and personal draft preservation");

    await invitesTab();
    assert.equal(await page.locator("#shortcutWorkspace").count(), 1);
    assert.equal(await workspace.isVisible(), true);
    const invitations = page.locator('[data-panel="invites"] > .panel:has(#bulkInvitesHost)');
    const desktop = page.viewportSize();
    for (const viewport of [desktop, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const [shortcutsBox, invitesBox] = await Promise.all([workspace.boundingBox(), invitations.boundingBox()]);
      assert.ok(shortcutsBox.y + shortcutsBox.height <= invitesBox.y, "Shortcuts has its own box above the Invites list");
      assert.ok(Math.abs(shortcutsBox.x - invitesBox.x) <= 1 && Math.abs(shortcutsBox.width - invitesBox.width) <= 1,
        "Shortcuts and the Invites list have aligned sides");
    }
    await page.setViewportSize(desktop);
    await page.locator('[data-tab="events"]').click();
    assert.equal(await workspace.isVisible(), false);
    await invitesTab();
    await workspace.locator("summary").first().click();
    const selection = page.locator('[data-shortcut-select="99999999-1111-4111-8111-111111111111"]');
    assert.equal(await selection.isDisabled(), true, "opt-in does not bypass publication");
    assert.match(await page.locator("#shortcutBatchHost").innerText(), /publish/i);
    await selectOverviewTab(page, "invitation");
    const serviceFilter = page.locator("#inviteChannelFilter");
    await serviceFilter.locator('[data-value="email"]').click();
    assert.equal(await selection.isVisible(), true, "filter changes leave the opened Shortcuts workspace intact");
    await serviceFilter.locator('[data-value="email"]').click();
    await page.evaluate(() => {
      window.__fixtures.event_settings[0].is_published = true;
      window.RSVP_CONFIG.supabaseUrl = "http://127.0.0.1:54321";
    });
    await refreshed();
    assert.equal(await selection.isDisabled(), true, "published opt-in still requires HTTPS callback configuration");
    assert.match(await page.locator("#shortcutBatchHost").innerText(), /HTTPS/);
    await page.evaluate(() => { window.RSVP_CONFIG.supabaseUrl = "https://synthetic.invalid"; });
    await refreshed();
    assert.equal(await selection.isEnabled(), true, "all existing send gates are still evaluated");
    await page.locator('[data-tab="invites"]').click();
    const household = page.locator('[data-panel="invites"] [data-invite-household="22222222-2222-4222-8222-222222222222"]');
    if (!await household.evaluate(node => node.open)) await household.locator(":scope > summary .invite-compact-name").click();
    const current = household.locator('[data-invite-delivery-submenu="current"]');
    await current.locator(":scope > summary").click();
    const delivery = current.locator('[data-delivery-id="99999999-1111-4111-8111-111111111111"]');
    assert.equal(await delivery.getByRole("button", { name: "Share invitation", exact: true }).count(), 0);
    assert.equal(await delivery.getByRole("link", { name: "Open WhatsApp", exact: true }).count(), 0);
    await delivery.getByRole("button", { name: "Change to Draft", exact: true }).waitFor({ state: "visible" });
    await page.locator('[data-tab="events"]').click();
    await invitesTab();
    assert.equal(await selection.isVisible(), true, "switching tabs preserves the opened workspace");
    assert.equal(await selection.isEnabled(), true);
    await page.evaluate(async () => {
      window.__accessPermissions.sendInvites = false;
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    await refreshed();
    assert.equal(await selection.isDisabled(), true, "experimental opt-in does not grant sending permission");
    await page.evaluate(async () => {
      window.__accessPermissions.sendInvites = true;
      window.__accessPermissions.preset = "custom";
      window.__accessPermissions.sections.settings = "view";
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    await refreshed();
    await interfaceTab();
    assert.equal(await page.locator('[data-local-edit="experimental-shortcuts"]').isVisible(), false, "settings viewers cannot edit the global setting");
    const priorWrites = (await writes()).length;
    await checkbox.evaluate(node => { node.checked = false; node.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.locator("#shortcutExperimentalForm").evaluate(node => node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal((await writes()).length, priorWrites, "direct DOM dispatch cannot bypass permission");
    assert.equal(await checkbox.isChecked(), true);
    await page.evaluate(async () => {
      window.__accessPermissions.preset = "full";
      window.__accessPermissions.sections.settings = "edit";
      window.__fixtures.event_settings[0].is_published = false;
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    await refreshed();
    await openBox(page, "experimental-shortcuts");
    await checkbox.uncheck();
    await page.evaluate(() => { window.__failReloadAfterExperimental = true; });
    await save.click();
    await page.locator('#shortcutExperimentalStatus[data-state="saved"]').waitFor({ state: "attached" });
    assert.equal(await workspace.evaluate(node => node.hidden), true);
    assert.equal(await page.locator("#shortcutBatchHost").innerText(), "");
    assert.deepEqual(await page.evaluate(() => window.__authWrites), []);
    checks.push("Invites workspace, separate current invitation, publication, HTTPS, send and settings permission gates");
    assert.match(await page.locator("#adminMessage").innerText(), /Synthetic reload failure/,
      "known successful write keeps its acknowledgment while a failed refresh remains visible");
    assert.equal(await page.evaluate(() => window.__fixtures.event_settings[0].apple_shortcuts_enabled), false);
    checks.push("acknowledged save survives a failed refresh without reverting the persisted value");

    await openBox(page, "experimental-shortcuts");
    await checkbox.check();
    await page.evaluate(() => { window.__holdExperimental = true; });
    await save.click();
    await page.locator('#shortcutExperimentalStatus[data-state="saving"]').waitFor();
    await page.evaluate(async () => {
      window.__accessPermissions.preset = "custom";
      window.__accessPermissions.sections.settings = "view";
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    await refreshed();
    await page.evaluate(() => { window.__holdExperimental = false; window.__releaseExperimental(); });
    await page.waitForFunction(() => document.getElementById("shortcutExperimentalForm").getAttribute("aria-busy") === "false");
    assert.equal(await checkbox.isChecked(), false, "permission loss discards the staged opt-in");
    assert.equal(await workspace.evaluate(node => node.hidden), true);
    await page.evaluate(async () => {
      window.__accessPermissions.preset = "full";
      window.__accessPermissions.sections.settings = "edit";
      await window.RSVP_ADMIN_ACCESS.refresh();
    });
    await refreshed();
    await openBox(page, "experimental-shortcuts");
    assert.equal(await checkbox.isEnabled(), true, "restored permissions do not leave the card stuck busy");
    assert.equal(await cancel.isEnabled(), true);
    assert.equal(await save.isDisabled(), true);
    await cancel.click();
    checks.push("permission loss during save clears busy state and stale draft without enabling the feature");

    await page.locator('[data-settings-tab="backups"]').click();
    assert.match(await page.locator('[data-settings-tab="backups"]').innerText(), /Database/);
    await selectDatabaseTab(page, "wipe");
    const retain = page.locator("#databaseKeepAdmin");
    assert.equal(await retain.isChecked(), true, "actual R.dom rendering visibly retains the current admin by default");
    assert.equal(await page.locator("#databaseWipeStatus").getAttribute("role"), "status");
    assert.equal(await page.locator("#databaseWipeStatus").getAttribute("aria-live"), "polite");
    await retain.uncheck();
    assert.equal(await retain.isChecked(), false, "retention choice survives its immediate remount");
    await page.locator("#databasePreviewWipe").click();
    await page.locator("#databaseWipePreview").waitFor();
    assert.equal(await retain.isChecked(), false, "retention choice survives review busy/result renders");
    assert.deepEqual(await page.evaluate(() => window.__wipePreparationCalls), [
      { name: "admin_preview_wipe_all", args: { p_keep_current_admin: false } },
    ]);
    await selectDatabaseTab(page, "backup");
    await page.evaluate(() => {
      window.__backupBridge = { calls: [], downloads: [], current: true, hold: false, fail: false };
      const h = window.__backupBridge;
      window.RSVP_BACKUP_CRYPTO = { ...window.RSVP_BACKUP_CRYPTO, canEncrypt: () => true };
      window.RSVP_BACKUP_FILES = { ...window.RSVP_BACKUP_FILES, encode: async (backup, compressed, options) => {
        h.calls.push({ backup, compressed, options });
        if (h.hold) await new Promise(resolve => { h.release = resolve; });
        if (h.fail) throw Error("Synthetic encryption failure");
        return { extension: options ? ".json.enc" : compressed ? ".json.gz" : ".json", blob: new Blob(["SYNTHETIC_ENCODED_BACKUP"], { type: "application/octet-stream" }) };
      } };
      window.RSVP.dl = (filename, blob, type) => h.downloads.push({ filename, size: blob.size, type });
      h.run = () => window.RSVP_ADMIN_TOOLS.downloadSafetyBackup({ synthetic: true }, () => h.current);
    });
    const options = async (compressed, encrypted) => {
      await page.locator("#backupExportCompressed").setChecked(compressed);
      await page.locator("#backupExportEncrypted").setChecked(encrypted);
      if (encrypted) {
        await page.locator("#backupEncryptionPassword").fill("synthetic-backup-password");
        await page.locator("#backupEncryptionConfirm").fill("synthetic-backup-password");
      }
    };
    await options(true, true);
    assert.equal(await page.evaluate(() => window.__backupBridge.run()), true);
    assert.deepEqual(await page.evaluate(() => window.__backupBridge.calls[0]), {
      backup: { synthetic: true }, compressed: true, options: { password: "synthetic-backup-password" },
    });
    assert.equal(await page.locator("#backupEncryptionPassword").inputValue(), "");
    assert.equal(await page.locator("#backupEncryptionConfirm").inputValue(), "");
    await options(false, false);
    assert.equal(await page.evaluate(() => window.__backupBridge.run()), true);
    assert.deepEqual(await page.evaluate(() => window.__backupBridge.calls[1]), { backup: { synthetic: true }, compressed: false, options: null });
    checks.push("safety bridge honors compression/encryption and clears passwords after download");

    await options(true, true);
    await page.evaluate(() => {
      window.__backupBridge.hold = true;
      window.__backupBridge.promise = window.__backupBridge.run();
    });
    await page.waitForFunction(() => window.__backupBridge.calls.length === 3);
    await page.evaluate(() => { const h = window.__backupBridge; h.current = false; h.release(); });
    assert.equal(await page.evaluate(() => window.__backupBridge.promise), false);
    assert.equal(await page.evaluate(() => window.__backupBridge.downloads.length), 2, "late actor/current change prevents download");
    assert.equal(await page.locator("#backupEncryptionPassword").inputValue(), "");
    assert.equal(await page.locator("#backupEncryptionConfirm").inputValue(), "");
    await options(true, true);
    await page.evaluate(() => { Object.assign(window.__backupBridge, { hold: false, current: true, fail: true }); });
    assert.match(await page.evaluate(async () => {
      try { await window.__backupBridge.run(); return "unexpected success"; } catch (error) { return error.message; }
    }), /Synthetic encryption failure/);
    assert.equal(await page.evaluate(() => window.__backupBridge.calls.length), 4, "encoding failure is not retried in plaintext");
    assert.equal(await page.evaluate(() => window.__backupBridge.downloads.length), 2);
    assert.equal(await page.locator("#backupEncryptionPassword").inputValue(), "");
    assert.equal(await page.locator("#backupEncryptionConfirm").inputValue(), "");
    checks.push("late account change and encryption failure clear passwords without download or plaintext fallback");

    // The real R.dom helper supports only selected properties: test the visibly rendered
    // retention choice and receipt through remounts, using the actual rendered controls.
    await options(true, false);
    await selectDatabaseTab(page, "wipe");
    assert.equal(await retain.isChecked(), false, "switching tabs preserves the reviewed retention choice");
    await page.evaluate(() => { window.__backupBridge.fail = false; });
    await page.locator("#databasePrepareWipe").click();
    await page.locator("#databaseWipeAll").waitFor();
    assert.equal(await retain.isChecked(), false, "prepared no-retain choice stays visibly unchecked");
    assert.deepEqual(await page.evaluate(() => window.__wipePreparationCalls.at(-1)), {
      name: "admin_prepare_wipe_all", args: { p_keep_current_admin: false, p_expected_state: "synthetic-destination-state" },
    });
    assert.equal(await page.locator("#databaseWipeConfirmation").count(), 0, "no typed wipe confirmation");
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true);
    await refreshed();
    assert.equal(await retain.isChecked(), false, "actual application reload preserves the selected retention option");
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true, "safety receipt survives an unchanged application render");
    await retain.check();
    assert.equal(await retain.isChecked(), true);
    assert.equal(await page.locator("#databaseWipeAll").count(), 0, "changing retention invalidates the prepared receipt");
    assert.equal(await page.locator("#databaseWipePreview").count(), 0, "changing retention requires fresh review");
    await page.locator("#databasePreviewWipe").click();
    await page.locator("#databaseWipePreview").waitFor();
    await page.locator("#databasePrepareWipe").click();
    await page.locator("#databaseWipeAll").waitFor();
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true, "fresh safety preparation enables the Yes/No action");
    await retain.uncheck();
    assert.equal(await retain.isChecked(), false);
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__wipeCalls), []);
    checks.push("actual R.dom retention defaults, remounts, RPC choices, accessible status and stale-receipt invalidation");

    // Exercise a refused bridge result through the actual integrated wipe controller.
    await page.evaluate(() => { window.RSVP_ADMIN_TOOLS.downloadSafetyBackup = async () => false; });
    await page.locator("#databasePreviewWipe").click();
    await page.locator("#databaseWipePreview").waitFor();
    await page.locator("#databasePrepareWipe").click();
    await page.waitForFunction(() => document.getElementById("databaseWipeStatus").textContent.includes("could not be downloaded"));
    assert.equal(await page.locator("#databaseWipeAll").count(), 0, "refused download cannot issue a usable wipe receipt");
    assert.deepEqual(await page.evaluate(() => window.__wipeCalls), []);
    assert.deepEqual(await page.evaluate(() => window.__authWrites), []);
    checks.push("refused safety download prevents wipe preparation");

    await page.evaluate(() => { window.RSVP_ADMIN_TOOLS.downloadSafetyBackup = async () => true; });
    const prepareWipe = async () => {
      await page.locator("#databasePreviewWipe").click();
      await page.locator("#databasePrepareWipe").click();
      await page.locator("#databaseWipeAll:enabled").waitFor();
    };
    const confirm = page.locator(".inline-confirmation");
    await retain.check();
    await prepareWipe();
    await page.locator("#databaseWipeAll").click();
    await confirm.getByRole("button", { name: "No", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__wipeCalls), []);
    assert.equal(await page.locator('[data-settings-tab="backups"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true);

    await page.evaluate(() => { window.__testWipeCompletion = true; window.__failWipeCompletion = true; });
    await page.locator("#databaseWipeAll").click();
    await confirm.getByRole("button", { name: "Yes", exact: true }).click();
    await page.locator('#databaseWipeStatus[data-state="error"]').waitFor();
    assert.equal(await page.locator('[data-settings-tab="backups"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);

    await page.evaluate(() => { window.__failWipeCompletion = false; });
    await prepareWipe();
    await page.locator("#databaseWipeAll").click();
    await confirm.getByRole("button", { name: "Yes", exact: true }).click();
    await reopenDatabaseAfterRecovery(page, "wipe");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("syntheticWipeSignedOut")), null);
    assert.equal(await retain.isChecked(), true);

    await page.evaluate(() => {
      window.__testWipeCompletion = true;
      window.RSVP_ADMIN_TOOLS.downloadSafetyBackup = async () => true;
    });
    await retain.uncheck();
    await prepareWipe();
    await page.locator("#databaseWipeAll").click();
    await confirm.getByRole("button", { name: "Yes", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/setup.html" && !url.hash);
    await page.locator('[data-step-panel="1"]').waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => sessionStorage.getItem("syntheticWipeSignedOut")), "true");
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("syntheticWipeCompletions"))), [
      { p_keep_current_admin: true, p_confirmation: "WIPE", p_safety_token: "99999999-2222-4222-8222-222222222222" },
      { p_keep_current_admin: true, p_confirmation: "WIPE", p_safety_token: "99999999-2222-4222-8222-222222222222" },
      { p_keep_current_admin: false, p_confirmation: "WIPE", p_safety_token: "99999999-2222-4222-8222-222222222222" },
    ]);
    checks.push("declined and failed Wipe all stay in Database, retained admin returns to Invites, no admin opens setup");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(value => {
      const url = new URL(value);
      return url.hostname !== "127.0.0.1" && url.protocol !== "data:" && !url.pathname.endsWith("/supabase.min.js");
    }), [], "published synthetic harness uses local resources and its locally fulfilled SDK only");
    console.log("PASS experimental-interface-browser: " + checks.join("; "));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

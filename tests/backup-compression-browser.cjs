// Synthetic SDK only: never restore or export from a real event.
const { chromium, webkit } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { reopenDatabaseAfterRecovery, selectDatabaseTab } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, out } = createFoodHarness("backup-compression");
const behavior = `const envelope={format:'rsvp-application-backup',version:3,checksum:'synthetic',payload:{selection:{mode:'backup',sections:['venues','households','food','other','wording'],include_logs:true},tables:{'public.event_settings':[{event_name:'Synthetic recovery'}]}}};
window.__backupRequests=JSON.parse(sessionStorage.getItem('syntheticBackupRequests')||'[]');const backupRpc=client.rpc;client.rpc=async(name,args)=>{if(['admin_export_backup','admin_preview_backup','admin_restore_backup'].includes(name)){window.__backupRequests.push({name,args});sessionStorage.setItem('syntheticBackupRequests',JSON.stringify(window.__backupRequests));if(name==='admin_export_backup'){
  const selection={mode:args.p_mode,sections:args.p_sections,include_logs:args.p_include_logs};
  const tables={...envelope.payload.tables,'public.invitation_send_queue':args.p_sections.includes('drafts')?[{status:'draft'}]:[]};
  return {data:{...envelope,payload:{selection,tables}}};
}if(name==='admin_preview_backup')return {data:{event_name:'Synthetic recovery',can_restore:true,counts:{'public.households':1}}};return {data:{restored:true,is_published:false}};}return backupRpc(name,args);};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const type of (process.env.RSVP_TEST_BROWSER === "chromium" ? [chromium] : [chromium, webkit])) {
      const browser = await type.launch();
      try {
        for (const width of [390, 1160])
          for (const lang of ["en", "de", "fo"]) {
            const page = await browser.newPage({
                viewport: { width, height: 1000 },
              }),
              errors = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.addInitScript(
              (lang) => localStorage.setItem("rsvp-interface-language", lang),
              lang,
            );
            await page.route("**/supabase.min.js", (r) =>
              r.fulfill({
                contentType: "text/javascript",
                body: mock + "\n" + extra + "\n" + behavior,
              }),
            );
            await page.goto(
              "http://127.0.0.1:" + server.address().port + "/admin/",
            );
            await page.locator("#statsGrid .stat-card").first().waitFor({ state: "attached" });
            await page.locator("#settingsToggle").click();
            await page.locator("[data-settings-tab=backups]").click();
            assert.equal(await page.locator("#backupExportSections > label:visible").count(), 1,
              "Full export includes only the optional logs row");
            assert.equal(await page.locator("#backupTemplateSections").isVisible(), false,
              "Restore sections appear only when a backup is loaded");
            assert.equal(await page.locator("#restoreBackupAction").isDisabled(), true);
            let full;
            for (const mode of ["backup", "template"]) {
              await page.locator("#backupExportCompressed").check();
              await page
                .locator("#backupExportMode input[value=" + mode + "]")
                .check();
              assert.equal(
                await page.locator("#backupExportLogs").isVisible(),
                mode === "backup",
              );
              assert.equal(
                await page.locator("#backupExportLogs").isDisabled(),
                mode === "template",
              );
              if (mode === "template") {
                const sections = page.locator("#backupExportSections"),
                  households = sections.locator("input[value=households]"),
                  reservations = sections.locator("input[value=code_reservations]"),
                  drafts = sections.locator("input[value=drafts]");
                await sections.locator("input[value=food]").uncheck();
                assert.equal(await reservations.isChecked(), false, "Partial exports omit reservations by default");
                await reservations.check();
                assert.equal(await drafts.isChecked(), false, "drafts opt in");
                await drafts.check();
                await households.uncheck();
                assert.equal(await reservations.isEnabled(), true, "code reservations do not require households");
                assert.equal(await reservations.isChecked(), true);
                assert.equal(await drafts.isDisabled(), true);
                assert.equal(await drafts.isChecked(), false);
                assert.equal(await sections.locator(".backup-drafts-help").isVisible(), true);
                await households.check();
                assert.equal(await drafts.isEnabled(), true);
                assert.equal(await drafts.isChecked(), false, "reenabling drafts does not reselect them");
                await drafts.check();
                await sections.locator("input[value=invitation_templates]").uncheck();
                assert.equal(await sections.locator("input[value=picture_album]").isChecked(), true);
              }
              const downloaded = page.waitForEvent("download");
              await page.locator("#exportBackup").click();
              const download = await downloaded;
              assert.match(
                download.suggestedFilename(),
                new RegExp("^rsvp-" + mode + "-.*\\.json\\.gz$"),
              );
              const bytes = fs.readFileSync(await download.path()),
                data = JSON.parse(zlib.gunzipSync(bytes).toString());
              assert.equal(data.payload.selection.mode, mode);
              assert.equal(
                data.payload.selection.include_logs,
                mode === "backup",
              );
              if (mode === "backup") full = { bytes, data };
              else
                assert.deepEqual(data.payload.selection.sections,
                  ["venues", "households", "other", "language_text", "picture_album", "code_reservations", "drafts"]);
              await selectDatabaseTab(page, "restore");
              await page
                .locator("#backupFile")
                .setInputFiles({
                  name: "selected.json.gz",
                  mimeType: "application/gzip",
                  buffer: bytes,
                });
              const restoreAction = page.locator("#restoreBackupAction"),
                destinations = page.locator("#backupRestoreDestination");
              await page.locator("#restoreBackupAction:enabled").waitFor();
              assert.equal(await page.locator("#backupFileType").isVisible(), true);
              const fileTypeLabel = mode === "backup" ? "Full backup detected" : "Partial backup detected";
              assert.equal((await page.locator("#backupFileType").textContent()).trim(),
                await page.evaluate((label) => window.RSVP_I18N.t(label), fileTypeLabel));
              assert.equal(await destinations.locator("input:checked").inputValue(), "clean");
              assert.equal(await destinations.locator('input[value="restart"]').isDisabled(), mode === "backup");
              assert.equal(await destinations.locator('input[value="replace"]').isDisabled(), mode === "template");
              assert.equal(await destinations.locator('input[value="wipe"]').isDisabled(), mode === "template");
              assert.equal(
                await page.locator("#backupRestoreLogs").isVisible(),
                mode === "backup",
              );
              if (mode === "template") {
                const sections = page.locator("#backupTemplateSections"),
                  households = sections.locator("input[value=households]"),
                  drafts = sections.locator("input[value=drafts]");
                assert.equal(await drafts.isChecked(), true);
                assert.equal(await sections.locator("input[value=invitation_templates]").isVisible(), false);
                assert.equal(await sections.locator("input[value=food]").isVisible(), false);
                assert.equal(await sections.locator("input[value=picture_album]").isChecked(), true);
                await households.uncheck();
                assert.equal(await drafts.isDisabled(), true);
                assert.equal(await drafts.isChecked(), false);
                assert.equal(await sections.locator(".backup-drafts-help").isVisible(), true);
                await households.check();
                assert.equal(await drafts.isChecked(), false);
                await drafts.check();
              }
              const validateLabel = await restoreAction.textContent();
              await restoreAction.click();
              await page.locator("#backupPreview").getByText("Synthetic recovery", { exact: true }).waitFor();
              assert.equal(await restoreAction.isEnabled(), true);
              assert.notEqual(await restoreAction.textContent(), validateLabel,
                "A valid clean backup replaces Validate with the restore action");
              assert.equal(await page.locator("#restoreBackupConfirmation").count(), 0);
              const request = await page.evaluate(() =>
                window.__backupRequests
                  .filter((x) => x.name === "admin_preview_backup")
                  .at(-1),
              );
              assert.deepEqual(request.args.p_backup, data);
              assert.equal(request.args.p_mode, mode);
              assert.deepEqual(request.args.p_sections, data.payload.selection.sections);
              assert.equal(request.args.p_include_logs, mode === "backup");
              await restoreAction.click();
              await page.locator(".inline-confirmation [data-inline-confirm]").click();
              await reopenDatabaseAfterRecovery(page);
              const restoreCount = await page.evaluate(() =>
                window.__backupRequests.filter(x => x.name === "admin_restore_backup").length,
              );
              assert.equal(restoreCount, mode === "backup" ? 1 : 2);
              const restored = await page.evaluate(() =>
                window.__backupRequests.filter(x => x.name === "admin_restore_backup").at(-1).args,
              );
              assert.deepEqual(restored.p_backup, data);
              assert.deepEqual(restored.p_sections, data.payload.selection.sections);
              assert.equal(restored.p_confirmation, "RESTORE Synthetic recovery");
            }
            if (width === 390 && lang === "en") {
              await selectDatabaseTab(page, "restore");
              const before = await page.evaluate(
                () => window.__backupRequests.length,
              );
              await page
                .locator("#backupFile")
                .setInputFiles({
                  name: "broken.gz",
                  mimeType: "application/gzip",
                  buffer: full.bytes.subarray(0, full.bytes.length - 5),
                });
              await page.waitForFunction(
                () =>
                  document.querySelector("#backupPreview").textContent.length >
                  0,
              );
              assert.equal(
                await page.locator("#restoreBackupAction").isDisabled(),
                true,
              );
              assert.equal(
                await page.evaluate(() => window.__backupRequests.length),
                before,
              );
              // A slow old file must not replace a later selection.
              await page.evaluate(() => {
                const decode = window.RSVP_BACKUP_FILES.decode;
                window.RSVP_BACKUP_FILES.decode = async (file) => {
                  if (file.name === "slow.gz")
                    await new Promise((r) => (window.__releaseDecode = r));
                  return decode(file);
                };
              });
              await page
                .locator("#backupFile")
                .setInputFiles({
                  name: "slow.gz",
                  mimeType: "application/gzip",
                  buffer: full.bytes,
                });
              await page.waitForFunction(() => window.__releaseDecode);
              await page
                .locator("#backupFile")
                .setInputFiles({
                  name: "new.json",
                  mimeType: "application/json",
                  buffer: Buffer.from(
                    JSON.stringify({ ...full.data, checksum: "new-file" }),
                  ),
                });
              await page.locator("#restoreBackupAction:enabled").waitFor();
              await page.evaluate(() => window.__releaseDecode());
              await page.locator("#restoreBackupAction").click();
              await page.waitForFunction(
                () =>
                  window.__backupRequests
                    .filter((x) => x.name === "admin_preview_backup")
                    .at(-1).args.p_backup.checksum === "new-file",
              );
              await page.evaluate(() => {
                window.CompressionStream = undefined;
                window.DecompressionStream = undefined;
              });
              await selectDatabaseTab(page, "backup");
              await page.locator("#backupExportMode input[value=template]").check();
              await page.locator("#backupExportMode input[value=backup]").check();
              assert.equal(
                await page.locator("#backupExportCompressed").isDisabled(),
                true,
              );
              await selectDatabaseTab(page, "restore");
              await page
                .locator("#backupFile")
                .setInputFiles({
                  name: "unsupported.gz",
                  mimeType: "application/gzip",
                  buffer: full.bytes,
                });
              await page.waitForFunction(() =>
                document
                  .querySelector("#backupPreview")
                  .textContent.includes("Decompression is not supported"),
              );
              assert.equal(
                await page.locator("#restoreBackupAction").isDisabled(),
                true,
              );
            }
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            );
            assert.deepEqual(errors, []);
            if (type === chromium && lang === "en")
              await page
                .locator("[data-settings-panel=backups]")
                .screenshot({
                  path: path.join(out, "backup-" + width + ".png"),
                });
            await page.close();
          }
        console.log(
          "PASS " +
            type.name() +
            ": compressed Full/Partial download/restore, log sections, exact payloads, current schema safeguards, corrupt/stale files, fallback, EN/DE/FO and 390/1160px.",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

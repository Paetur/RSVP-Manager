// Real browser Worker/WASM/Web Crypto; all records and restore RPCs are synthetic.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("backup-encryption");
const behavior = `const encryptedFixture={format:'rsvp-application-backup',version:2,checksum:'synthetic',payload:{selection:{mode:'backup',sections:['venues','households','food','other','wording'],include_logs:true},tables:{'public.event_settings':[{event_name:'Synthetic recovery'}]}}};window.__backupRequests=[];const encryptionRpc=client.rpc;client.rpc=async(name,args)=>{if(['admin_export_backup','admin_preview_backup','admin_restore_backup'].includes(name)){window.__backupRequests.push({name,args});if(name==='admin_export_backup')return {data:encryptedFixture};if(name==='admin_preview_backup')return {data:{event_name:'Synthetic recovery',can_restore:true,counts:{'public.households':1}}};return {data:{restored:true,is_published:false}};}return encryptionRpc(name,args);};`;
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**/supabase.min.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: mock + extra + behavior,
        }),
      );
      await page.route("**/js/config*.js*", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: "window.RSVP_CONFIG={supabaseUrl:'https://synthetic.invalid',supabaseKey:'sb_publishable_synthetic'};",
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.locator("#statsGrid .stat-card").first().waitFor({ state: "attached" });
      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=backups]").click();
      assert.equal(
        await page.locator("#backupEncryptionFields").isVisible(),
        false,
      );
      await page.locator("#backupExportEncrypted").check();
      await page.locator("#exportBackup").click();
      await page
        .locator("#backupStatus")
        .getByText("Enter a backup password.", { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.__backupRequests.length),
        0,
        "empty password fails before export RPC",
      );
      await page.locator("#backupEncryptionPassword").fill("secret");
      await page.locator("#backupEncryptionConfirm").fill("different");
      await page.locator("#exportBackup").click();
      await page
        .locator("#backupStatus")
        .getByText("Backup passwords do not match.", { exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.__backupRequests.length),
        0,
      );
      const password = "Only for this synthetic backup 🔐";
      let encryptedBytes;
      for (const compressed of [false, true]) {
        await page.locator("#backupExportCompressed").setChecked(compressed);
        await page.locator("#backupEncryptionPassword").fill(password);
        await page.locator("#backupEncryptionConfirm").fill(password);
        const downloadEvent = page.waitForEvent("download");
        await page.locator("#exportBackup").click();
        const download = await downloadEvent;
        assert.match(download.suggestedFilename(), /\.encrypted\.json$/);
        const bytes = fs.readFileSync(await download.path()),
          envelope = JSON.parse(bytes.toString());
        encryptedBytes = bytes;
        assert.equal(envelope.compression, compressed ? "gzip" : "none");
        assert.equal(envelope.encryption.kdf, "argon2id");
        assert.equal(
          await page.locator("#backupEncryptionPassword").inputValue(),
          "",
        );
        assert.equal(
          await page.locator("#backupEncryptionConfirm").inputValue(),
          "",
        );
        const upload = async (buffer) =>
          page.locator("#backupFile").setInputFiles({
            name: "renamed-backup.bin",
            mimeType: "application/octet-stream",
            buffer,
          });
        const previewBefore = await page.evaluate(
          () =>
            window.__backupRequests.filter(
              (request) => request.name !== "admin_export_backup",
            ).length,
        );
        await upload(bytes);
        let dialog = page.getByRole("region", {
          name: "Encrypted backup",
          exact: true,
        });
        await dialog.waitFor();
        assert.equal(await page.locator("#previewBackup").isDisabled(), true);
        await dialog
          .getByLabel("Backup password", { exact: true })
          .fill("wrong");
        await dialog
          .getByRole("button", { name: "Open encrypted backup", exact: true })
          .click();
        await page
          .locator("#backupPreview")
          .getByText("Incorrect password or damaged backup.", { exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              window.__backupRequests.filter(
                (request) => request.name !== "admin_export_backup",
              ).length,
          ),
          previewBefore,
          "authentication failure never reaches preview/restore RPC",
        );
        await page.locator("#retryEncryptedBackup").click();
        dialog = page.getByRole("region", {
          name: "Encrypted backup",
          exact: true,
        });
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        assert.equal(await page.locator("#previewBackup").isDisabled(), true);
        await page.locator("#retryEncryptedBackup").click();
        dialog = page.getByRole("region", {
          name: "Encrypted backup",
          exact: true,
        });
        await dialog
          .getByLabel("Backup password", { exact: true })
          .fill(password);
        await dialog
          .getByRole("button", { name: "Open encrypted backup", exact: true })
          .click();
        await page.locator("#previewBackup:enabled").waitFor();
        await page.locator("#previewBackup").click();
        const restore = page.locator("#restoreBackupButton");
        await page.locator("#restoreBackupButton:enabled").waitFor();
        await restore.click();
        const decision = page.locator(".inline-confirmation");
        await decision.getByText("Are you really sure. This can NOT be undone", { exact: true }).waitFor();
        await decision.getByRole("button", { name: "No", exact: true }).click();
        assert.equal(
          await page.evaluate(() => window.__backupRequests.filter(
            (request) => request.name !== "admin_export_backup",
          ).length),
          previewBefore + 1,
          "decryption and validation do not bypass final confirmation",
        );
        const requests = await page.evaluate(() =>
          JSON.stringify(window.__backupRequests),
        );
        assert(!requests.includes(password));
        assert(!requests.includes("wrong"));
        assert.equal(await page.locator(".backup-password-dialog").count(), 0);
        if (!compressed) {
          const altered = { ...envelope, version: 99 };
          const before = await page.evaluate(
            () => window.__backupRequests.length,
          );
          await upload(Buffer.from(JSON.stringify(altered)));
          await page
            .locator("#backupPreview")
            .getByText("Unsupported or damaged encrypted backup.", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page.locator(".backup-password-dialog").count(),
            0,
          );
          assert.equal(
            await page.evaluate(() => window.__backupRequests.length),
            before,
          );
        }
      }
      await page.locator("#backupExportEncrypted").uncheck();
      await page.locator("#backupExportCompressed").uncheck();
      const plainEvent = page.waitForEvent("download");
      await page.locator("#exportBackup").click();
      const plain = await plainEvent;
      assert(!plain.suggestedFilename().includes("encrypted"));
      await page.locator("#backupFile").setInputFiles({
        name: "plain.json",
        mimeType: "application/json",
        buffer: fs.readFileSync(await plain.path()),
      });
      await page.locator("#previewBackup:enabled").waitFor();
      assert.equal(await page.locator(".backup-password-dialog").count(), 0);
      await page.evaluate(() => {
        const text = Blob.prototype.text;
        Blob.prototype.text = function () {
          if (this instanceof File && this.name === "old-encrypted.json")
            return new Promise((resolve) => {
              window.__releaseOldFile = () => text.call(this).then(resolve);
            });
          return text.call(this);
        };
      });
      await page
        .locator("#backupFile")
        .setInputFiles({
          name: "old-encrypted.json",
          mimeType: "application/json",
          buffer: encryptedBytes,
        });
      await page.waitForFunction(
        () => typeof window.__releaseOldFile === "function",
      );
      await page
        .locator("#backupFile")
        .setInputFiles({
          name: "latest.json",
          mimeType: "application/json",
          buffer: fs.readFileSync(await plain.path()),
        });
      await page.locator("#previewBackup:enabled").waitFor();
      await page.evaluate(() => window.__releaseOldFile());
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator(".backup-password-dialog").count(),
        0,
        "stale file never opens a password dialog for the new selection",
      );
      assert.equal(await page.locator("#previewBackup").isEnabled(), true);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].is_published,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    const unsupported = await browser.newPage();
    await unsupported.addInitScript(() => {
      localStorage.setItem("rsvp-interface-language", "en");
      window.Worker = undefined;
    });
    await unsupported.route("**/supabase.min.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: mock + extra + behavior,
      }),
    );
    await unsupported.route("**/js/config*.js*", route => route.fulfill({contentType:"text/javascript",body:"window.RSVP_CONFIG={supabaseUrl:'https://synthetic.invalid',supabaseKey:'sb_publishable_synthetic'};"}));
    unsupported.setDefaultTimeout(12000);
    await unsupported.goto(
      "http://127.0.0.1:" + server.address().port + "/admin/",
    );
    await unsupported.locator("#statsGrid .stat-card").first().waitFor({ state: "attached" });
    await unsupported.locator("#settingsToggle").click();
    await unsupported.locator("[data-settings-tab=backups]").click();
    assert.equal(
      await unsupported.locator("#backupExportEncrypted").isDisabled(),
      true,
    );
    assert.equal(
      await unsupported.locator("#backupEncryptionUnavailable").isVisible(),
      true,
    );
    const fallbackEvent = unsupported.waitForEvent("download");
    await unsupported.locator("#exportBackup").click();
    assert.match((await fallbackEvent).suggestedFilename(), /\.json$/);
    assert.equal(
      await unsupported.locator("#backupExportEncrypted").isDisabled(),
      true,
    );
    await unsupported.close();
    console.log(
      "PASS encrypted backup UI at phone/desktop: real self-hosted Argon2 worker, JSON/gzip encryption, password matching/clearing, content detection, wrong-password retry/Cancel, invalid header preflight, no password RPCs and unchanged restore gates/plain JSON.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

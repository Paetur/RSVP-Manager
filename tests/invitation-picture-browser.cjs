// Real controllers with synthetic APIs/files; native iOS targets need device acceptance.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"), fs = require("node:fs");
const { selectWorkTab } = require("./helpers/language-ui.cjs");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("invitation-picture");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1160]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const picture = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 420;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ede5d5"; context.fillRect(0, 0, 720, 420);
        context.strokeStyle = "#6d7e6c"; context.lineWidth = 3; context.strokeRect(28, 28, 664, 364);
        context.fillStyle = "#354c40"; context.textAlign = "center";
        context.font = "24px sans-serif"; context.fillText("A CELEBRATION TOGETHER", 360, 140);
        context.font = "58px serif"; context.fillText("You're invited", 360, 225);
        context.font = "20px sans-serif"; context.fillText("Example invitation picture", 360, 295);
        return { image: canvas.toDataURL("image/jpeg", 0.85), name: "synthetic.jpg", crop: { x: 0, y: 0, width: 720, height: 420, sourceWidth: 720, sourceHeight: 420 } };
      });
      const fixture = Buffer.from(picture.image.split(",")[1], "base64");
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("rsvp-interface-language", "en");
        window.__pictureShares = [];
        Object.defineProperty(navigator, "canShare", { value: (data) => !(window.__rejectCombined && data.files && data.text) });
        Object.defineProperty(navigator, "share", { value: async (data) => {
          window.__pictureShares.push({ text: data.text, url: data.url, files: data.files?.map((file) => ({ name: file.name, type: file.type, size: file.size })), activation: navigator.userActivation.isActive });
          if (window.__cancelShare) throw new DOMException("Cancelled", "AbortError");
        } });
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value) => { window.__pictureCopied = value; } } });
      });
      const seed = `
        window.__pictureHousehold=fixtures.households.find(h=>!h.archived_at).id;
        window.__pictureTemplates=[{language_code:'en',channel:'whatsapp',subject:'',body:'Hello {invitation_link}'}];
        const pictureRpc=client.rpc;
        client.rpc=async(name,args)=>{
          if(name==='admin_load_data'){const result=await pictureRpc(name,args);result.data.invitationTemplates=window.__pictureTemplates;return result;}
          if(name==='admin_save_invitation_template'){
            window.__pictureSaves=(window.__pictureSaves||[]);window.__pictureSaves.push(args);
            if(window.__pictureFail){window.__pictureFail=false;return {error:{message:'Synthetic picture save failure'}};}
            const template={language_code:args.p_language,channel:args.p_channel,subject:args.p_subject,body:args.p_body,message_image:args.p_image};
            window.__pictureTemplates=window.__pictureTemplates.filter(t=>t.language_code!==args.p_language||t.channel!==args.p_channel).concat(template);
            return {data:null};
          }
          return pictureRpc(name,args);
        };
      `;
      await page.route("**/supabase.min.js", (route) => route.fulfill({ contentType: "text/javascript", body: mock + "\n" + extra + "\n" + seed }));
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(() => document.querySelectorAll("#statsGrid .stat-card").length === 4);
      await page.evaluate((width) => { document.documentElement.dataset.theme = width === 390 ? "light" : "dark"; }, width);
      await page.locator("#settingsToggle").click();
      await page.getByRole("tab", { name: "Templates", exact: true }).click();
      const section = page.locator(".invitation-template").filter({ has: page.getByRole("heading", { name: "WhatsApp", exact: true }) }).filter({ visible: true });
      const open = () => section.locator("[data-local-edit]").click();
      const upload = () => section.locator('input[type="file"]');
      const value = () => section.locator("[data-invitation-picture]");
      await open();
      await upload().setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
      await section.getByText("Choose a JPEG under 1.4 MB.", { exact: true }).waitFor();
      assert.equal(await value().inputValue(), "null");
      await upload().setInputFiles({ name: "synthetic.jpg", mimeType: "image/jpeg", buffer: fixture });
      await page.waitForFunction(() => document.querySelector('[data-form-key="invitation-templates:en:whatsapp"] [data-invitation-picture]')?.value !== "null");
      const prepared = JSON.parse(await value().inputValue());
      assert(prepared.image.startsWith("data:image/jpeg;base64,"));
      assert.notEqual(prepared.image, picture.image, "upload is re-encoded, stripping metadata");
      await section.getByRole("button", { name: "Cancel", exact: true }).click();
      await open();
      assert.equal(await value().inputValue(), "null", "Cancel discards picture");
      await upload().setInputFiles({ name: "synthetic.jpg", mimeType: "image/jpeg", buffer: fixture });
      await section.locator(".invitation-picture-editor img").waitFor();
      await section.getByRole("button", { name: "Test sharing", exact: true }).click();
      const testDialog = page.getByRole("dialog", { name: "Test sharing", exact: true });
      await testDialog.getByRole("button", { name: "Share picture and text", exact: true }).click();
      await testDialog.getByText("Test share completed. Check the picture, text and example link in your app.", { exact: true }).waitFor();
      const testPayload = await page.evaluate(() => window.__pictureShares.at(-1));
      assert.equal(testPayload.text, "Hello https://example.invalid/");
      assert(testPayload.files.length === 1 && testPayload.activation);
      assert.equal(await page.evaluate(() => window.__calls.some((c) => ["admin_authorize_device_send", "admin_record_share_handoff", "admin_record_delivery_sent"].includes(c.name))), false);
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      await testDialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(() => { window.__pictureFail = true; });
      await section.getByRole("button", { name: "Save template", exact: true }).click();
      await section.locator('.form-feedback[data-state="error"]').waitFor();
      assert.notEqual(await value().inputValue(), "null", "failed save keeps picture draft");
      await section.getByRole("button", { name: "Save template", exact: true }).click();
      await section.locator(".local-editor-summary img").waitFor();
      assert(await page.evaluate(() => window.__pictureSaves.at(-1).p_image.image.startsWith("data:image/jpeg;base64,")));
      await open();
      await section.getByRole("button", { name: "Remove picture", exact: true }).click();
      assert.equal(await value().inputValue(), "null");
      await section.getByRole("button", { name: "Cancel", exact: true }).click();
      assert(await section.locator(".local-editor-summary img").isVisible(), "Cancel restores saved picture");
      await selectWorkTab(page, "invites");
      const household = await page.locator("#inviteRows [data-invite-household]").first().getAttribute("data-invite-household");
      const householdRow = page.locator(`[data-invite-household="${household}"]`);
      await householdRow.locator(":scope > summary").click();
      const delivery = page.locator(`#invite-delivery-${household}`);
      await delivery.evaluate((node) => { node.open = true; });
      await delivery.locator("details").evaluateAll((nodes) => nodes.forEach((node) => { node.open = true; }));
      const draft = delivery.locator("form").first();
      await draft.getByLabel("Delivery channel", { exact: true }).selectOption("whatsapp");
      assert.notEqual(await draft.locator("[data-invitation-picture]").inputValue(), "null", "new drafts inherit the selected template picture");
      await draft.getByRole("button", { name: "Create delivery draft", exact: true }).click();
      await page.waitForFunction(() => window.__calls.some((c) => c.name === "admin_save_delivery"));
      const savedDraft = await page.evaluate(() => window.__calls.find((c) => c.name === "admin_save_delivery").args.p_values);
      assert(savedDraft.message_image.image.startsWith("data:image/jpeg;base64,"));
      assert.equal(savedDraft.status, "draft");
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      // Exercise the actual share dialog without publishing any fixture event.
      await page.evaluate((picture) => {
        const host = document.createElement("div"); host.id = "pictureShareFixture"; document.body.prepend(host);
        window.RSVP_DEVICE_DELIVERY.appendShare(host, {
          R: window.RSVP, T: (text) => window.RSVP_I18N.t(text),
          q: { message_image: picture, message_body: "Hello\nhttps://example.invalid/?=ABCDEFGH", message_subject: "Invitation", invitation_code_snapshot: "ABCDEFGH" },
          authorize: async () => true, recordHandoff: async () => { window.__pictureHandoffs = (window.__pictureHandoffs || 0) + 1; }, show: () => {},
        });
      }, picture);
      const trigger = page.locator("#pictureShareFixture button");
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Share invitation", exact: true });
      if (process.env.RSVP_PICTURE_PREVIEW_DIR) {
        fs.mkdirSync(process.env.RSVP_PICTURE_PREVIEW_DIR, { recursive: true });
        await dialog.screenshot({ path: `${process.env.RSVP_PICTURE_PREVIEW_DIR}/invitation-share-${width}.png` });
      }
      await dialog.getByRole("button", { name: "Share picture and text", exact: true }).click();
      const shared = await page.evaluate(() => window.__pictureShares.at(-1));
      assert.equal(shared.files[0].type, "image/jpeg");
      assert.equal(shared.files[0].size, fixture.length);
      assert.equal(shared.text, "Hello\nhttps://example.invalid/?=ABCDEFGH");
      assert.equal(shared.activation, true);
      assert.equal(shared.url, undefined);
      await dialog.getByRole("button", { name: "Share picture", exact: true }).click();
      const imageOnly = await page.evaluate(() => window.__pictureShares.at(-1));
      assert.equal(imageOnly.text, undefined);
      assert.equal(imageOnly.files.length, 1);
      await dialog.getByRole("button", { name: "Copy message", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__pictureCopied), shared.text);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(() => { window.__rejectCombined = true; });
      await trigger.click();
      await dialog.getByRole("button", { name: "Share picture and text", exact: true }).click();
      await dialog.getByText("System sharing is unavailable here. Use Copy message or open a device app.", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Share picture", exact: true }).isEnabled(), true);
      const before = await page.evaluate(() => window.__pictureHandoffs);
      await page.evaluate(() => { window.__cancelShare = true; });
      await dialog.getByRole("button", { name: "Share picture", exact: true }).click();
      assert.equal(await page.evaluate(() => window.__pictureHandoffs), before, "cancelled share never logs a handoff");
      assert.equal(await page.evaluate(() => window.__calls.some((c) => c.name === "admin_record_delivery_sent")), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px invitation picture upload/re-encode, Cancel, save retry, read preview, removal, combined/picture-only sharing, copy/link preservation and cancellation.`);
      await page.close();
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

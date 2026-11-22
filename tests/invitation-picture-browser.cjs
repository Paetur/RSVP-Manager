// Real controllers with synthetic APIs/files; native iOS targets need device acceptance.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { selectWorkTab } = require("./helpers/language-ui.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("invitation-picture");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1160]) {
      const page = await browser.newPage({
        viewport: { width, height: 950 },
        hasTouch: width < 700,
        isMobile: width < 700,
      });
      const picture = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 720;
        canvas.height = 420;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ede5d5";
        context.fillRect(0, 0, 720, 420);
        context.strokeStyle = "#6d7e6c";
        context.lineWidth = 3;
        context.strokeRect(28, 28, 664, 364);
        context.fillStyle = "#354c40";
        context.textAlign = "center";
        context.font = "24px sans-serif";
        context.fillText("A CELEBRATION TOGETHER", 360, 140);
        context.font = "58px serif";
        context.fillText("You're invited", 360, 225);
        context.font = "20px sans-serif";
        context.fillText("Example invitation picture", 360, 295);
        return {
          image: canvas.toDataURL("image/jpeg", 0.85),
          name: "synthetic.jpg",
          crop: {
            x: 0,
            y: 0,
            width: 720,
            height: 420,
            sourceWidth: 720,
            sourceHeight: 420,
          },
        };
      });
      const fixture = Buffer.from(picture.image.split(",")[1], "base64");
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem("rsvp-interface-language", "en");
        window.__pictureShares = [];
        Object.defineProperty(navigator, "canShare", {
          value: (data) =>
            !(window.__rejectCombined && data.files && data.text),
        });
        Object.defineProperty(navigator, "share", {
          value: async (data) => {
            window.__pictureShares.push({
              text: data.text,
              url: data.url,
              files: data.files?.map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
              })),
              activation: navigator.userActivation.isActive,
            });
            if (window.__cancelShare)
              throw new DOMException("Cancelled", "AbortError");
          },
        });
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (value) => {
              window.__pictureCopied = value;
            },
          },
        });
      });
      const seed = `
        fixtures.event_settings[0].invitation_picture_album=[];
        fixtures.event_settings[0].invitation_album_revision='synthetic';
        window.__pictureHousehold=fixtures.households.find(h=>h.id===h2).id;
        fixtures.households.find(h=>h.id===h2).language='en';
        fixtures.households.find(h=>h.id===h2).primary_guest_id=fixtures.guests.find(g=>g.household_id===h2&&!g.is_child).id;
        Object.assign(fixtures.guests.find(g=>g.household_id===h2&&!g.is_child),{mobile:'+12025550111',preferred_contact_method:'whatsapp'});
        window.__pictureTemplates=[{id:'99999999-1111-4111-8111-111111111111',name:'WhatsApp',revision:'88888888-1111-4111-8111-111111111111',channels:['whatsapp'],language_tags:['en'],versions:{en:{subject:'',body:'Hello {invitation_link}'}}}];
        const pictureRpc=client.rpc;
        client.rpc=async(name,args)=>{
          if(name==='admin_load_data'){
            const result=await pictureRpc(name,args);
            window.__pictureLoadArgs=args;
            result.data.invitationTemplates=window.__pictureTemplates;
            if(args?.p_compact_queue_pictures===true){
              const queuePictures={};
              result.data.queue=await Promise.all(result.data.queue.map(async ({message_image,...delivery})=>{
                if(!message_image)return {...delivery,message_image_key:null};
                const bytes=new TextEncoder().encode(JSON.stringify(message_image));
                const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
                const key=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
                queuePictures[key]=message_image;
                return {...delivery,message_image_key:key};
              }));
              result.data.queuePictures=queuePictures;
            }
            return result;
          }
          if(name==='admin_save_invitation_picture'){fixtures.event_settings[0].invitation_picture_album.push({id:'album-one',name:args.p_name,picture:args.p_image});return {data:null};}
          if(name==='admin_save_invitation_template'){
            window.__pictureSaves=(window.__pictureSaves||[]);window.__pictureSaves.push(args);
            if(window.__pictureFail){window.__pictureFail=false;return {error:{message:'Synthetic picture save failure'}};}
            const template={id:args.p_id,revision:'88888888-1111-4111-8111-111111111111',...args.p_values};
            window.__pictureTemplates=window.__pictureTemplates.filter(t=>t.id!==args.p_id).concat(template);
            return {data:null};
          }
          if(name==='admin_save_delivery'&&args.p_household_id===h2){
            const result=await pictureRpc(name,args);
            const row=fixtures.invitation_send_queue.find(q=>q.id===result.data);
            const household=fixtures.households.find(h=>h.id===h2);
            const guest=fixtures.guests.find(g=>g.id===household.primary_guest_id);
            if(row?.channel==='whatsapp'){
              row.recipient_snapshot={contact_name:guest.first_name,contact_value:guest.mobile,contact_type:'whatsapp'};
              row.invitation_code_snapshot=fixtures.event_settings[0].is_published?household.invite_code:null;
            }
            return result;
          }
          return pictureRpc(name,args);
        };
      `;
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + seed);
      await page.route("**/version.json", (route) =>
        route.fulfill({ json: { version: "0.9.0-alpha.5" } }),
      );
      const base =
        process.env.RSVP_INSTALLED_SITE ||
        "http://127.0.0.1:" + server.address().port;
      // Isolate configuration as well as SDK data; never contact the installed backend.
      if (process.env.RSVP_INSTALLED_SITE)
        await page.route("**/js/config.js?*", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: 'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};',
          }),
        );
      let productionRequests = 0;
      await page.route(/\/(rest|auth|functions)\/v1\//, (route) => {
        productionRequests++;
        return route.abort();
      });
      if (process.env.RSVP_INSTALLED_SITE)
        await page.route(base + "/**", async (route) => {
          if (route.request().resourceType() !== "document")
            return route.fallback();
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: (await response.text()).replace(/ integrity="[^"]+"/g, ""),
          });
        });
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await page.evaluate((width) => {
        document.documentElement.dataset.theme =
          width === 390 ? "light" : "dark";
      }, width);
      await page.locator("#settingsToggle").click();
      await page.getByRole("tab", { name: "Templates", exact: true }).click();
      const section = page.locator('[data-settings-card="invitation-template:99999999-1111-4111-8111-111111111111"]');
      const open = () => section.locator("[data-local-edit]").click();
      const album = page.locator(".invitation-album");
      const upload = () => album.locator('input[type="file"]');
      const value = () => section.locator("[data-invitation-picture]").first();
      await album.locator(":scope > summary").click();
      await album.locator("[data-local-edit]").click();
      await album
        .getByLabel("Picture name", { exact: true })
        .fill("Example picture");
      await upload().setInputFiles({
        name: "invalid.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg/>"),
      });
      await album
        .getByText("Choose a JPEG under 1.4 MB.", { exact: true })
        .waitFor();
      await upload().setInputFiles({
        name: "synthetic.jpg",
        mimeType: "image/jpeg",
        buffer: fixture,
      });
      await album.locator(".invitation-picture-editor img").waitFor();
      const prepared = JSON.parse(
        await album.locator("[data-invitation-picture]").inputValue(),
      );
      assert.notEqual(
        prepared.image,
        picture.image,
        "album upload re-encodes JPEG without metadata",
      );
      await album
        .getByRole("button", { name: "Add picture", exact: true })
        .click();
      await album.locator(".invitation-album-tile img").waitFor();
      async function choosePicture() {
        await section
          .getByRole("button", { name: "Choose from album", exact: true })
          .click();
        await page
          .getByRole("region", { name: "Choose from album", exact: true })
          .getByRole("button", { name: "Example picture", exact: true })
          .click();
      }
      await open();
      assert.equal(
        await section.locator('input[type="file"]').count(),
        0,
        "templates choose shared pictures instead of uploading",
      );
      await choosePicture();
      await section
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await open();
      assert.equal(
        await value().inputValue(),
        "null",
        "Cancel discards album selection",
      );
      await choosePicture();
      await section
        .getByRole("button", { name: "Test sharing", exact: true })
        .click();
      const testDialog = page.getByRole("region", {
        name: "Test sharing",
        exact: true,
      });
      await testDialog
        .getByRole("button", { name: "Share picture and text", exact: true })
        .click();
      await testDialog
        .getByText(
          "Test share completed. Check the picture, text and preview link in your app.",
          { exact: true },
        )
        .waitFor();
      const testPayload = await page.evaluate(() =>
        window.__pictureShares.at(-1),
      );
      assert.equal(
        testPayload.text,
        "Hello " + new URL("/#guest-preview=landing", page.url()).href,
      );
      assert(testPayload.files.length === 1 && testPayload.activation);
      assert.equal(
        await page.evaluate(() =>
          window.__calls.some((c) =>
            [
              "admin_authorize_device_send",
              "admin_record_share_handoff",
              "admin_record_delivery_sent",
            ].includes(c.name),
          ),
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() => fixtures.event_settings[0].is_published),
        false,
      );
      await testDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.evaluate(() => {
        window.__pictureFail = true;
      });
      await section
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await section.locator('.form-feedback[data-state="error"]').waitFor();
      assert.notEqual(
        await value().inputValue(),
        "null",
        "failed save keeps picture draft",
      );
      await section
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await section.locator(".local-editor-summary img").waitFor();
      assert(
        await page.evaluate(() =>
          window.__pictureSaves
            .at(-1)
            .p_values.versions.en.message_image.image.startsWith("data:image/jpeg;base64,"),
        ),
      );
      assert.equal(await section.locator("form").isVisible(), false);
      await section
        .getByRole("button", { name: "Test sharing", exact: true })
        .click();
      await testDialog
        .getByRole("button", { name: "Share picture and text", exact: true })
        .click();
      await testDialog
        .getByText(
          "Test share completed. Check the picture, text and preview link in your app.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.__pictureShares.at(-1))).text,
        "Hello " + new URL("/#guest-preview=landing", page.url()).href,
      );
      await testDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.getElementById("adminVersion")?.textContent ===
          "v0.9.0-alpha.5",
      );
      assert.equal(
        await page.locator("#adminVersion").textContent(),
        "v0.9.0-alpha.5",
      );
      assert.equal(
        await page.locator("#adminVersion").isVisible(),
        width > 700,
      );
      const headerGeometry = await page
        .locator("header.topbar")
        .evaluate((header) => {
          const rectangles = Array.from(
            header.querySelectorAll("button,a.admin-icon-btn"),
          )
            .filter((node) => node.getClientRects().length)
            .map((node) => node.getBoundingClientRect());
          const collisions = rectangles.some((a, i) =>
            rectangles
              .slice(i + 1)
              .some(
                (b) =>
                  a.left < b.right - 1 &&
                  b.left < a.right - 1 &&
                  a.top < b.bottom - 1 &&
                  b.top < a.bottom - 1,
              ),
          );
          return {
            collisions,
            singleRow: rectangles.every(
              (r) => Math.abs(r.top - rectangles[0].top) < 1,
            ),
            withinViewport: rectangles.every(
              (r) => r.left >= 0 && r.right <= innerWidth,
            ),
            touchSize: rectangles.every((r) => r.width >= 43 && r.height >= 43),
          };
        });
      assert.equal(
        headerGeometry.collisions,
        false,
        "toolbar controls cannot overlap",
      );
      assert.equal(
        headerGeometry.withinViewport,
        true,
        "toolbar controls fit the phone width",
      );
      if (width < 700) {
        assert.equal(
          headerGeometry.touchSize,
          true,
          "phone controls retain 44px tap areas",
        );
        assert.equal(
          headerGeometry.singleRow,
          true,
          "phone header fits on one line",
        );
        for (const id of ["refreshButton", "themeToggle", "guestPreviewButton"])
          assert.equal(await page.locator("#" + id).isVisible(), false);
      }
      if (process.env.RSVP_HEADER_PREVIEW_DIR) {
        fs.mkdirSync(process.env.RSVP_HEADER_PREVIEW_DIR, { recursive: true });
        await page.screenshot({
          path: `${process.env.RSVP_HEADER_PREVIEW_DIR}/admin-template-${width}.png`,
          fullPage: true,
        });
        await page
          .locator("header.topbar")
          .screenshot({
            path: `${process.env.RSVP_HEADER_PREVIEW_DIR}/admin-header-${width}.png`,
          });
        await section.screenshot({
          path: `${process.env.RSVP_HEADER_PREVIEW_DIR}/template-read-${width}.png`,
        });
        await page
          .locator(".admin-topbar-actions")
          .screenshot({
            path: `${process.env.RSVP_HEADER_PREVIEW_DIR}/header-detail-${width}.png`,
          });
      }
      await open();
      await section
        .getByRole("button", { name: "Choose from album", exact: true })
        .click();
      await page
        .getByRole("region", { name: "Choose from album", exact: true })
        .getByRole("button", { name: "No picture", exact: true })
        .click();
      assert.equal(await value().inputValue(), "null");
      await section
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      assert(
        await section.locator(".local-editor-summary img").isVisible(),
        "Cancel restores saved picture",
      );
      await selectWorkTab(page, "invites");
      const household = await page.evaluate(() => window.__pictureHousehold);
      const householdRow = page.locator(
        `[data-invite-household="${household}"]`,
      );
      assert.equal(await page.evaluate(() => window.__calls.some(c => c.name === "admin_save_delivery")), false, "opening Invites does not save a delivery");
      await householdRow.locator('[data-bulk-select="' + household + '"]').check();
      const action = page.locator("#bulkInvitesHost");
      assert.equal(await page.evaluate(() => window.__calls.some(c => c.name === "admin_save_delivery")), false, "selecting a household does not create a delivery");
      await action.getByRole("button", { name: "Make draft(s)", exact: true }).click();
      await page.locator("#bulkInviteStatus").getByText("1 draft created", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__pictureLoadArgs),
        { p_compact_queue_pictures: true }, "the draft refresh requests compact pictures");
      const creation = await page.evaluate(() => window.__calls.find(c => c.name === "admin_save_delivery").args);
      assert.equal(creation.p_id, null);
      assert.equal(creation.p_values.only_if_missing, true);
      assert.equal(creation.p_values.template_id, "99999999-1111-4111-8111-111111111111");
      assert.equal(creation.p_values.template_revision, "88888888-1111-4111-8111-111111111111");
      const drafts = householdRow.locator('[data-invite-delivery-submenu="drafts"]');
      const inlineRecord = drafts.locator(".current-invitation [data-delivery-id]");
      const inlinePicture = inlineRecord.locator(":scope > .invitation-picture");
      assert.equal(await inlinePicture.count(), 0, "collapsed household does not load its picture preview");
      await householdRow.locator(":scope > summary .invite-review-action").click();
      assert.equal(await drafts.evaluate(node => node.open), true, "Review opens Drafts");
      await inlinePicture.waitFor();
      assert.equal(await page.getByRole("dialog", { name: "Invitation delivery", exact: true }).count(), 0, "created delivery review stays inline");
      const savedDraft = await page.evaluate(
        () =>
          window.__calls.find((c) => c.name === "admin_save_delivery").args
            .p_values,
      );
      assert(
        savedDraft.message_image.image.startsWith("data:image/jpeg;base64,"),
      );
      assert.equal(await inlinePicture.getAttribute("src"), savedDraft.message_image.image, "the compact picture reference restores the saved preview");
      assert.equal(savedDraft.status, "draft");
      const editDelivery = inlineRecord.locator(":scope > details.edit-only").first();
      await editDelivery.locator(":scope > summary").click();
      const deliveryForm = editDelivery.locator("form.delivery-review-form");
      await deliveryForm.locator("details.delivery-customize > summary").click();
      await deliveryForm.getByLabel("Message subject", { exact: true }).fill("Picture draft");
      await deliveryForm.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__calls.filter(c => c.name === "admin_save_delivery").length === 2);
      const editedDraft = await page.evaluate(() => window.__calls.filter(c => c.name === "admin_save_delivery").at(-1).args);
      assert.ok(editedDraft.p_id, "inline editor saves the existing draft");
      assert.equal(editedDraft.p_values.message_image.image, savedDraft.message_image.image, "explicit inline Save retains its independent picture snapshot");
      assert.equal(
        await page.evaluate(() => fixtures.event_settings[0].is_published),
        false,
      );
      assert.equal(await inlineRecord.locator("[data-mark-delivery-ready]").count(), 0);
      // Exercise the published route and clipboard with the fixture's saved draft.
      const link = await page.evaluate(() => {
        fixtures.event_settings[0].is_published = true;
        return window.RSVP.invitationURL(fixtures.households.find(h => h.id === h2).invite_code);
      });
      await refreshFixture(page);
      await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
      await householdRow.locator(":scope > summary .invite-review-action").click();
      assert.equal(await inlineRecord.getByRole("button", { name: "Copy message", exact: true }).count(), 0);
      await inlineRecord.getByRole("button", { name: "Make invitation(s)", exact: true }).click();
      const ready = householdRow.locator(':scope > summary [data-invite-copy="invitation"]');
      await ready.getByText("Invitation", { exact: true }).waitFor();
      const readySave = await page.evaluate(() => window.__calls.filter(c => c.name === "admin_save_delivery").at(-1).args);
      assert.equal(readySave.p_expected_revision, 2);
      assert.equal(readySave.p_values.status, "ready");
      assert.equal(readySave.p_values.message_body, "Hello " + link);
      assert.deepEqual(readySave.p_values.message_image, savedDraft.message_image, "Making the invitation keeps the whole picture snapshot");
      const recipientChip = householdRow.locator(':scope > summary [data-invite-copy="recipient"]');
      assert.equal(await recipientChip.innerText(), "WhatsApp");
      await recipientChip.click();
      assert.equal(await page.evaluate(() => window.__pictureCopied), "+12025550111");
      assert.equal(await householdRow.locator(':scope > summary [data-invite-copy="message"]').count(), 0);
      await ready.click();
      await page.waitForFunction(value => window.__pictureCopied === value, "Hello " + link);
      assert.equal(await page.evaluate(() => window.__pictureCopied), "Hello " + link);
      // Exercise the actual share dialog with synthetic device and handoff hooks.
      await page.evaluate((picture) => {
        const host = document.createElement("div");
        host.id = "pictureShareFixture";
        document.body.prepend(host);
        window.RSVP_DEVICE_DELIVERY.appendShare(host, {
          R: window.RSVP,
          T: (text) => window.RSVP_I18N.t(text),
          q: {
            message_image: picture,
            message_body: "Hello\nhttps://example.invalid/?=ABCDEFGH",
            message_subject: "Invitation",
            invitation_code_snapshot: "ABCDEFGH",
          },
          authorize: async () => true,
          recordHandoff: async () => {
            window.__pictureHandoffs = (window.__pictureHandoffs || 0) + 1;
          },
          show: () => {},
        });
      }, picture);
      const trigger = page.locator("#pictureShareFixture button");
      await trigger.click();
      const dialog = page.getByRole("region", {
        name: "Share invitation",
        exact: true,
      });
      if (process.env.RSVP_PICTURE_PREVIEW_DIR) {
        fs.mkdirSync(process.env.RSVP_PICTURE_PREVIEW_DIR, { recursive: true });
        await dialog.screenshot({
          path: `${process.env.RSVP_PICTURE_PREVIEW_DIR}/invitation-share-${width}.png`,
        });
      }
      await dialog
        .getByRole("button", { name: "Share picture and text", exact: true })
        .click();
      const shared = await page.evaluate(() => window.__pictureShares.at(-1));
      assert.equal(shared.files[0].type, "image/jpeg");
      assert.equal(shared.files[0].size, fixture.length);
      assert.equal(shared.text, "Hello\nhttps://example.invalid/?=ABCDEFGH");
      assert.equal(shared.activation, true);
      assert.equal(shared.url, undefined);
      await dialog
        .getByRole("button", { name: "Share picture", exact: true })
        .click();
      const imageOnly = await page.evaluate(() =>
        window.__pictureShares.at(-1),
      );
      assert.equal(imageOnly.text, undefined);
      assert.equal(imageOnly.files.length, 1);
      await dialog
        .getByRole("button", { name: "Copy message", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__pictureCopied),
        shared.text,
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(() => {
        window.__rejectCombined = true;
      });
      await trigger.click();
      await dialog
        .getByRole("button", { name: "Share picture and text", exact: true })
        .click();
      await dialog
        .getByText(
          "System sharing is unavailable here. Use Copy message or open a device app.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Share picture", exact: true })
          .isEnabled(),
        true,
      );
      const before = await page.evaluate(() => window.__pictureHandoffs);
      await page.evaluate(() => {
        window.__cancelShare = true;
      });
      await dialog
        .getByRole("button", { name: "Share picture", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__pictureHandoffs),
        before,
        "cancelled share never logs a handoff",
      );
      assert.equal(
        await page.evaluate(() =>
          window.__calls.some((c) => c.name === "admin_record_delivery_sent"),
        ),
        false,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      if (width === 390) {
        await page.evaluate(() => {
          window.__accessPermissions.preset = "custom";
          window.__accessPermissions.sections.settings = "view";
        });
        await page
          .locator("#refreshButton")
          .evaluate((button) => button.click());
        await page.locator("#settingsToggle").click();
        await page.getByRole("tab", { name: "Templates", exact: true }).click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll("#invitationAlbum form,#invitationTemplatesList form")
              .length === 0,
        );
        assert.equal(await section.locator("[data-local-edit]").count(), 0);
        await section
          .getByRole("button", { name: "Test sharing", exact: true })
          .click();
        await testDialog
          .getByRole("button", { name: "Copy message", exact: true })
          .click();
        assert.equal(
          await page.evaluate(() => window.__pictureCopied),
          "Hello " + new URL("/#guest-preview=landing", page.url()).href,
        );
        assert.equal(
          await page.evaluate(() =>
            window.__calls.some((c) => c.name === "admin_record_delivery_sent"),
          ),
          false,
        );
      }
      assert.equal(
        productionRequests,
        0,
        "installed-site fixtures must not call production APIs",
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px invitation picture upload/re-encode, Cancel, save retry, read preview, removal, combined/picture-only sharing, copy/link preservation and cancellation.`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

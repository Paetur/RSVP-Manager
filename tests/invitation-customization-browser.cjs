const {openBox}=require('./helpers/local-edit-ui.cjs');
const { refreshFixture, selectInterfaceSettingsTab } = require('./helpers/admin-toolbar.cjs');
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { out, server, mock, extra, stageExtra, cleanup } = createPublicFoodHarness(
  "invitation-customization",
);
const jpeg =
  "data:image/jpeg;base64," +
  fs.readFileSync("tests/fixtures/customization.jpg").toString("base64");
const custom =
  "\nfixtures.event_settings[0].guest_background=" +
  JSON.stringify({
    image: jpeg,
    name: "example.jpg",
    crop: { x: 0, y: 0, width: 3, height: 2, sourceWidth: 3, sourceHeight: 2 },
  }) +
  ';fixtures.event_settings[0].guest_theme_default="dark";fixtures.event_settings[0].guest_theme_toggle=false;window.__customWrites=[];window.__customRequests=[];const customizationRpc=client.rpc;client.rpc=async(name,args)=>{if(name==="admin_save_guest_interface"){window.__customRequests.push(args);if(window.__rejectStaleCustom&&args.p_expected.guest_theme_default!==fixtures.event_settings[0].guest_interface_modes[args.p_mode].guest_theme_default)return {error:{message:"Synthetic appearance conflict"}};if(window.__holdCustomSave)await new Promise(resolve=>window.__finishCustomSave=resolve);if(window.__failCustom){window.__failCustom=false;return {error:{message:"Synthetic customization failure"}};}window.__customWrites.push(args);fixtures.event_settings[0].guest_interface_modes||={};fixtures.event_settings[0].guest_interface_modes[args.p_mode]={...fixtures.event_settings[0].guest_interface_modes[args.p_mode],...args.p_values};return {data:null};}const r=await customizationRpc(name,args);if(name==="get_public_event_v2")Object.assign(r.data.event,{guest_design:{dark:{box:"#123456",text:"#ffffff",button:"#346f5c"},light:{box:"#ffffff",text:"#123456",button:"#346f5c"},opacity:60,darken:30,position:"top"},guest_background:fixtures.event_settings[0].guest_background,guest_theme_toggle:true,guest_theme_default:"dark"});return r;};';
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, hasTouch: width < 700 }),
        errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem("rsvp-interface-language", "en");
        localStorage.setItem("event-appearance", "light");
      });
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + stageExtra + custom);
      const base = "http://127.0.0.1:" + server.address().port;
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
      );
      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=interface]").click();
      const appearance = page.locator('#guestAppearanceHost');
      const selectMode = async mode => {
        await appearance.locator('[data-appearance-mode="' + mode + '"]').click();
        assert.equal(await page.locator('[data-settings-card="guest-customization:' + mode + '"]').isVisible(), true);
      };
      const modes = appearance.locator('.guest-appearance-mode-tabs');
      const range = appearance.locator('#guestAppearanceScreenRange');
      assert.deepEqual(await modes.getByRole('tab').allTextContents(), ['Phone', 'Wide']);
      assert.equal(await appearance.getAttribute('data-appearance-mode'), 'phone');
      assert.equal(await range.textContent(), 'Phone screen (below 512 px)');
      await modes.locator('[data-appearance-mode=phone]').focus();
      const keyboardBefore = await modes.locator('button').evaluateAll(nodes => nodes.map(node => ({ id: node.id, role: node.getAttribute('role'), disabled: node.disabled, visible: node.getClientRects().length > 0, focused: node === document.activeElement })));
      await page.keyboard.press('ArrowLeft');
      assert.equal(await appearance.getAttribute('data-appearance-mode'), 'wide', 'mode tabs support keyboard navigation: ' + JSON.stringify(keyboardBefore));
      assert.equal(await range.textContent(), 'Wide screen (512 px and wider)');
      await page.keyboard.press('Home');
      assert.equal(await appearance.getAttribute('data-appearance-mode'), 'phone');
      assert.equal(await modes.locator('[data-appearance-mode=phone]').evaluate(node => node === document.activeElement), true);
      if (width < 700) {
        for (const button of await modes.locator('button').all()) {
          const box = await button.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'coarse-pointer mode switches retain 44px targets');
        }
      }
      const host = page.locator('[data-settings-card="guest-customization:phone"]');
      const showPhoneTitles = host.getByRole('checkbox', { name: 'Show titles', exact: true });
      const phoneTitleLanguages = host.locator('.guest-name-languages');
      const englishPhoneTitle = phoneTitleLanguages.getByRole('checkbox', { name: 'Phone · en', exact: true });
      const wideHost = page.locator('[data-settings-card="guest-customization:wide"]');
      const preview = appearance.locator('details.guest-appearance-preview');
      const sample = preview.locator('.customization-sample');
      const showPreview = async () => {
        if (!await preview.evaluate(node => node.open)) await preview.locator(':scope > summary').click();
        assert.equal(await page.locator('.customization-preview:visible').count(), 1, 'one active appearance preview');
        assert.equal(await sample.isVisible(), true);
      };
      assert.equal(await page.request.get(base + '/AGENTS.md').then(response => response.status()), 404);
      assert.equal(await page.request.get(base + '/internal/docs/codex-handover.md').then(response => response.status()), 404);
      assert.equal(await appearance.getByRole('heading', { name: 'Invitation appearance', exact: true }).count(), 1);
      assert.equal(await preview.count(), 1);
      assert.equal(await preview.evaluate(node => node.open), false, 'preview starts collapsed');
      assert.equal(await page.locator('.customization-preview:visible').count(), 0);
      assert.equal(await wideHost.isVisible(), false);
      const summary = host.locator('.appearance-compact-summary');
      assert.deepEqual(await summary.locator(':scope > div > dt').allTextContents(), ['Photo', 'Colours', 'Titles', 'Names', 'Appearance']);
      assert.equal(await appearance.locator('.appearance-compact-summary:visible').count(), 1);
      assert.doesNotMatch(await summary.innerText(), /Disabled/, 'read view describes chosen appearance without disabled option rows');
      const compactGeometry = await summary.evaluate(node => ({
        height: node.getBoundingClientRect().height,
        rowHeights: [...node.children].map(row => row.getBoundingClientRect().height),
      }));
      assert.ok(compactGeometry.height < 350 && compactGeometry.rowHeights.every(height => height < 90), 'five read rows stay compact at phone and wide widths');
      const metadata = summary.locator('details.appearance-photo-details');
      assert.equal(await metadata.evaluate(node => node.open), false, 'technical photo metadata starts collapsed');
      await metadata.locator(':scope > summary').click();
      assert.match(await metadata.innerText(), /3 × 2 px.*759/s);
      await metadata.locator(':scope > summary').click();
      assert.equal(await page.locator('[data-settings-panel=interface] #notificationSettingsHost').count(), 0, 'Invitations contains no event message editor');
      if (width < 700) {
        const box = await preview.locator(':scope > summary').boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, 'preview disclosure retains its coarse-pointer target');
      }
      if (process.env.RSVP_COMPACT_PREVIEW_DIR) {
        fs.mkdirSync(process.env.RSVP_COMPACT_PREVIEW_DIR, { recursive: true });
        await page.locator('.guest-landing-settings').screenshot({ path: path.join(process.env.RSVP_COMPACT_PREVIEW_DIR, 'compact-landing-' + width + '.png') });
      }
      await selectInterfaceSettingsTab(page, 'messages');
      const status = page.locator('#settingsEventMessages #notificationSettingsHost');
      assert.equal(await status.locator('details.notification-settings-disclosure').count(), 0, 'event messages use a standard card');
      assert.equal(await status.locator(':scope > .settings-card-heading').isVisible(), true);
      assert.equal(await status.locator('[data-settings-card="notification-preferences:phone"] form').isVisible(), true, 'event messages open directly to Phone controls');
      assert.equal(await page.locator('[data-settings-card="notification-preferences:wide"]').isVisible(), false);
      assert.equal(await status.locator('.local-editor-pencil').count(), 0);
      if (width < 700) {
        const box = await status.locator('button[data-notification-mode=wide]').boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, 'event message mode tabs retain coarse-pointer targets');
      }
      await selectInterfaceSettingsTab(page);
      assert.equal(await page.locator('#personalPreferencesForm').isVisible(), true, 'personal preferences can be edited as soon as Interface opens');
      assert.equal(await page.locator('[data-settings-card="personal-preferences"] .appearance-compact-summary').count(), 0);
      await page.locator('[data-settings-tab=interface]').click();
      await showPreview();
      if (process.env.RSVP_COMPACT_PREVIEW_DIR)
        await page.locator('.guest-landing-settings').screenshot({ path: path.join(process.env.RSVP_COMPACT_PREVIEW_DIR, 'compact-landing-preview-' + width + '.png') });
      await openBox(page, 'guest-customization:phone');
      assert.equal(await sample.locator('input[type=radio]:checked').count(), 1);
      await sample.locator('input[value="1"]').check();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Guest Sample household');
      assert.equal(await showPhoneTitles.isChecked(), false);
      assert.equal(await phoneTitleLanguages.isVisible(), false);
      await showPhoneTitles.check();
      assert.equal(await phoneTitleLanguages.isVisible(), true);
      await englishPhoneTitle.check();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest Sample household');
      await host.getByRole('checkbox', { name: 'Show repeated surname beside each guest', exact: true }).uncheck();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest');
      await host.getByLabel('Guest name placement', { exact: true }).selectOption('inline');
      await host.getByRole('button', { name: 'Reset appearance', exact: true }).click();
      assert.equal(await host.getByRole('button', { name: 'Reset appearance', exact: true }).evaluate(node => node === document.activeElement), true, 'Reset retains usable keyboard focus');
      await showPreview();
      assert.equal(await host.getByLabel('Guest name placement', { exact: true }).inputValue(), 'inline');
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'inline',
        'rerendered preview follows the retained unsaved layout');
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest');
      await host.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.locator('[data-local-edit="guest-customization:phone"]').evaluate(node => node === document.activeElement), true, 'Cancel returns focus to the selected mode pencil');
      await openBox(page, 'guest-customization:phone');
      await showPreview();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Guest Sample household');
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'above');
      assert.equal(
        await host
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true,
      );

      const initial = await host
        .getByRole("button", { name: "Save", exact: true })
        .isDisabled();
      assert.equal(initial, true);
      const color = host.getByRole("textbox", {
        name: "Boxes / page",
        exact: true,
      });
      await openBox(page,'guest-customization:phone');
      const boxColor = host.locator("input[type=color]").first();
      await boxColor.fill("#334455");
      await boxColor.dispatchEvent("input");
      assert.equal(
        await sample
          .evaluate((n) => n.style.getPropertyValue("--guest-box")),
        "#334455",
      );
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
      await host
        .getByRole("button", { name: "Remove photo", exact: true })
        .click();
      assert.equal(
        await sample.locator(".customization-sample-backdrop")
          .evaluate((n) => n.style.backgroundImage),
        "none",
      );
      await host.getByRole("button", { name: "Cancel", exact: true }).click();
      await showPreview();
      assert.notEqual(
        await sample.locator(".customization-sample-backdrop")
          .evaluate((n) => n.style.backgroundImage),
        "none",
      );
      assert.equal(await page.evaluate(() => window.__customWrites.length), 0);
      await openBox(page,"guest-customization:phone");
      await host
        .getByRole("button", { name: "Replace JPEG", exact: true })
        .click();
      await host
        .locator("input[type=file]")
        .setInputFiles({
          name: "bad.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from("<svg/>"),
        });
      await host
        .getByText("Choose a JPEG under 1.4 MB.", { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__customWrites.length), 0);
      await page.evaluate(() => {
        window.__originalPreparePhoto = window.RSVP_GUEST_DESIGN.prepareJPEG;
        window.RSVP_GUEST_DESIGN.prepareJPEG = async file => {
          const photo = await window.__originalPreparePhoto(file);
          await new Promise(resolve => window.__finishPhotoPreparation = resolve);
          return photo;
        };
      });
      await host
        .locator("input[type=file]")
        .setInputFiles("tests/fixtures/customization.jpg");
      await page.waitForFunction(() => !!window.__finishPhotoPreparation);
      await host.getByText('Preparing photo…', { exact: true }).waitFor();
      await refreshFixture(page);
      await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
      await page.evaluate(() => {
        window.RSVP_GUEST_DESIGN.prepareJPEG = window.__originalPreparePhoto;
        window.__finishPhotoPreparation();
      });
      await host
        .getByText("Photo prepared. Save to keep it privately.", {
          exact: true,
        })
        .waitFor();
      await host
        .locator(".customization-crop")
        .evaluate((n) => (n.open = true));
      const cropWidth = host.getByRole("spinbutton", {
        name: "Width",
        exact: true,
      });
      await cropWidth.fill("4");
      assert.equal(await cropWidth.evaluate((n) => n.checkValidity()), false);
      await cropWidth.fill("2");
      assert.equal(await cropWidth.evaluate((n) => n.checkValidity()), true);
      await host
        .getByRole("slider", { name: "Box opacity", exact: true })
        .fill("60");
      await host
        .getByRole("slider", { name: "Box opacity", exact: true })
        .dispatchEvent("input");
      await host.locator('.guest-default-choices input[value="light"]').check();
      await host.getByRole("checkbox", { name: "Show light/dark toggle on the guest page", exact: true }).check();
      await page.evaluate(() => (window.__failCustom = true));
      await host.getByRole("button", { name: "Save", exact: true }).click();
      await host
        .getByText("Synthetic customization failure", { exact: true })
        .waitFor();
      assert.equal(
        await host
          .getByRole("slider", { name: "Box opacity", exact: true })
          .inputValue(),
        "60",
      );
      await host.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__customWrites.length === 1);
      assert.equal(
        await page.evaluate(() => !!window.__customWrites[0].p_values.guest_background),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].is_published,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].guest_interface_modes.phone.guest_design.opacity,
        ),
        60,
      );
      await page.waitForFunction(() => !document.getElementById("refreshButton").disabled);
      await openBox(page,"guest-customization:phone");
      await host
        .getByRole("button", { name: "Reset appearance", exact: true })
        .click();
      await showPreview();
      assert.equal(await sample.getAttribute('data-preview-theme'), 'dark',
        'Reset preview uses the same dark appearance as the reset control');
      assert.equal(await host.locator('.guest-default-choices input[value="dark"]').isChecked(), true);
      await host.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__customWrites.length === 2);
      assert.equal(
        await page.evaluate(() => window.__customWrites[1].p_values.guest_design),
        null,
      );
      assert.equal(
        await page.evaluate(() => Object.hasOwn(window.__customWrites[1].p_values,"guest_background")),
        false,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
      await openBox(page, 'guest-customization:phone');
      await host.getByLabel('Guest name placement', { exact: true }).selectOption('inline');
      await showPhoneTitles.check();
      await englishPhoneTitle.check();
      await host.getByRole('checkbox', { name: 'Show repeated surname beside each guest', exact: true }).uncheck();
      await host.locator('input[type=color]').first().fill('#556677');
      await host.locator('input[type=color]').first().dispatchEvent('input');
      await showPreview();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest');
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'inline');
      await host.locator('.customization-crop').evaluate(node => node.open = true);
      await host.getByRole('spinbutton', { name: 'Width', exact: true }).fill('4');
      assert.equal(await host.getByRole('spinbutton', { name: 'Width', exact: true }).evaluate(node => node.checkValidity()), false);
      await selectMode('wide');
      assert.equal(await preview.evaluate(node => node.open), true, 'open shared preview stays open when switching modes');
      await showPreview();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest Sample household', 'mode switch shows Wide settings rather than resizing the Phone draft');
      assert.equal(await sample.locator('input[type=radio]:checked').count(), 1);
      await openBox(page, 'guest-customization:wide');
      await wideHost.getByLabel('Guest name placement', { exact: true }).selectOption('above');
      await wideHost.getByRole('slider', { name: 'Box opacity', exact: true }).fill('74');
      await wideHost.getByRole('slider', { name: 'Box opacity', exact: true }).dispatchEvent('input');
      await page.evaluate(() => window.__holdCustomSave = true);
      await wideHost.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => !!window.__finishCustomSave);
      assert.equal(await modes.locator('button:disabled').count(), 2, 'in-flight Save locks both mode switches');
      await modes.locator('[data-appearance-mode=phone]').evaluate(node => node.click());
      await modes.locator('[data-appearance-mode=wide]').dispatchEvent('keydown', { key: 'ArrowRight' });
      assert.equal(await appearance.getAttribute('data-appearance-mode'), 'wide', 'busy mode cannot switch through click or keyboard');
      await page.evaluate(() => { window.__holdCustomSave = false; window.__finishCustomSave(); });
      await page.waitForFunction(() => window.__customWrites.length === 3 && !document.getElementById('refreshButton').disabled);
      assert.equal(await page.evaluate(() => window.__customWrites[2].p_mode), 'wide');
      assert.equal(await preview.evaluate(node => node.open), true, 'shared preview disclosure retains open state after Save/reload');
      await selectMode('phone');
      await openBox(page, 'guest-customization:phone');
      assert.equal(await host.getByLabel('Guest name placement', { exact: true }).inputValue(), 'inline', 'saving Wide retains the independent Phone draft');
      assert.equal(await host.locator('input[type=color]').first().inputValue(), '#556677');
      const retainedCrop = host.getByRole('spinbutton', { name: 'Width', exact: true });
      assert.equal(await retainedCrop.inputValue(), '4', 'other-mode Save preserves invalid crop text for correction');
      assert.equal(await retainedCrop.evaluate(node => node.checkValidity()), false, 'invalid crop feedback survives unrelated reload');
      await retainedCrop.fill('2');
      assert.equal(await retainedCrop.evaluate(node => node.checkValidity()), true);
      assert.equal(await host.getByRole('checkbox', { name: 'Show repeated surname beside each guest', exact: true }).isChecked(), false);
      await showPreview();
      assert.equal(await sample.locator('.rsvp-person-name').innerText(), 'Son Guest');
      assert.equal(await sample.evaluate(node => node.style.getPropertyValue('--guest-box')), '#556677');
      await selectMode('wide');
      await openBox(page, 'guest-customization:wide');
      await wideHost.getByLabel('Guest name placement', { exact: true }).selectOption('inline');
      await wideHost.getByRole('button', { name: 'Cancel', exact: true }).click();
      await selectMode('phone');
      await openBox(page, 'guest-customization:phone');
      assert.equal(await host.locator('input[type=color]').first().inputValue(), '#556677', 'cancelling Wide does not discard Phone');
      await page.evaluate(() => window.__failCustom = true);
      await host.getByRole('button', { name: 'Save', exact: true }).click();
      await host.getByText('Synthetic customization failure', { exact: true }).waitFor();
      await selectMode('wide');
      await openBox(page, 'guest-customization:wide');
      await wideHost.getByRole('slider', { name: 'Box opacity', exact: true }).fill('75');
      await wideHost.getByRole('slider', { name: 'Box opacity', exact: true }).dispatchEvent('input');
      await wideHost.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => window.__customWrites.length === 4 && !document.getElementById('refreshButton').disabled);
      await selectMode('phone');
      await openBox(page, 'guest-customization:phone');
      await host.getByText('Synthetic customization failure', { exact: true }).waitFor();
      assert.equal(await host.locator('input[type=color]').first().inputValue(), '#556677', 'failed save and inline error survive other-mode Save');
      await refreshFixture(page);
      await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
      await selectMode('wide');
      await showPreview();
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'above', 'Wide sample reflects its saved setting after refresh');
      await selectMode('phone');
      await openBox(page, 'guest-customization:phone');
      await showPreview();
      assert.equal(await host.locator('input[type=color]').first().inputValue(), '#556677', 'failed Phone save draft survives refresh and mode switches');
      assert.equal(await preview.evaluate(node => node.open), true);
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'inline');
      await host.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => window.__customWrites.length === 5 && !document.getElementById('refreshButton').disabled);
      assert.equal(await page.evaluate(() => window.__customWrites[4].p_mode), 'phone');
      assert.equal(await page.evaluate(() => window.__customWrites[4].p_values.guest_show_titles), true);
      assert.equal(await page.evaluate(() => window.__customWrites[4].p_values.guest_title_visibility.en), true);
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].guest_interface_modes.phone.guest_name_layout), 'inline');
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].guest_interface_modes.wide.guest_name_layout), 'above');
      await openBox(page, 'guest-customization:phone');
      await host.getByLabel('Guest name placement', { exact: true }).selectOption('above');
      await host.getByRole('button', { name: 'Cancel', exact: true }).click();
      await showPreview();
      assert.equal(await sample.getAttribute('data-guest-name-layout'), 'inline', 'Cancel restores selected mode saved values');
      await openBox(page, 'guest-customization:phone');
      await host.getByLabel('Guest name placement', { exact: true }).selectOption('above');
      await englishPhoneTitle.uncheck();
      await page.evaluate(() => {
        fixtures.event_settings[0].guest_interface_modes.phone.guest_theme_default = 'light';
        window.__rejectStaleCustom = true;
      });
      await refreshFixture(page);
      await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
      await openBox(page, 'guest-customization:phone');
      await host.getByRole('button', { name: 'Reset appearance', exact: true }).click();
      assert.equal(await host.getByLabel('Guest name placement', { exact: true }).inputValue(), 'above', 'Reset retains unrelated name draft after stored settings change');
      assert.equal(await englishPhoneTitle.isChecked(), false, 'Reset retains unrelated title draft');
      await host.getByRole('button', { name: 'Save', exact: true }).click();
      await host.getByText('Synthetic appearance conflict', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__customRequests.at(-1).p_expected.guest_theme_default), 'dark', 'Reset retains original optimistic baseline');
      assert.equal(await page.evaluate(() => window.__customWrites.length), 5, 'stale reset does not overwrite newer saved settings');
      await host.getByRole('button', { name: 'Cancel', exact: true }).click();
      await openBox(page, 'guest-customization:phone');
      assert.equal(await host.getByLabel('Guest name placement', { exact: true }).inputValue(), 'inline');
      assert.equal(await showPhoneTitles.isChecked(), true);
      assert.equal(await englishPhoneTitle.isChecked(), true);
      assert.equal(await host.locator('.guest-default-choices input[value=light]').isChecked(), true, 'Cancel restores current live saved appearance');
      await host.getByRole('button', { name: 'Cancel', exact: true }).click();
      await showPreview();
      assert.equal(await sample.getAttribute('data-preview-theme'), 'light');
      await preview.locator(':scope > summary').click();
      assert.equal(await page.locator('.customization-preview:visible').count(), 0);
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.goto(base + "/");
      await page.locator("#codeCard:not(.hidden)").waitFor();
      assert.equal(
        await page
          .locator("body")
          .evaluate((n) => n.classList.contains("guest-customized")),
        false,
      );
      await page.goto(base + "/?ABCDEFGH");
      await page.waitForFunction(() =>
        document.body.classList.contains("guest-customized"),
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((n) => n.style.getPropertyValue("--guest-box")),
        "#123456",
      );
      await page.locator("#themeToggle").click();
      assert.equal(
        await page
          .locator("body")
          .evaluate((n) => n.style.getPropertyValue("--guest-box")),
        "#ffffff",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS compact Landing page: one collapsed preview, five compact read rows/metadata, active mode saved/draft previews, independent mode Save/Cancel/refresh/failure/retry, preserved generic summaries and status editors; photo upload/crop, themes, private snapshot and mobile fit.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

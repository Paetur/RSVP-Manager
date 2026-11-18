const { refreshFixture, setInvitesGrouping } = require("./helpers/admin-toolbar.cjs");
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("invites-overview");
const overviewMock = String.raw`
fixtures.event_settings[0].food_stage='interest';
fixtures.guests.push({id:'99999999-9999-4999-8999-999999999999',household_id:h3,first_name:'Other',last_name:'Example'});
fixtures.invitation_send_queue=[{id:'queue-sent',household_id:h2,channel:'email',status:'sent',message_body:'Sent example',created_at:'2026-11-10T12:00:00Z',updated_at:'2026-11-10T12:00:00Z',revision:2,recipient_snapshot:{contact_name:'Example recipient',contact_value:'example@example.invalid'}},{id:'queue-ready',household_id:h3,channel:'sms',status:'ready',message_body:'Ready example',created_at:'2026-11-11T12:00:00Z',updated_at:'2026-11-11T12:00:00Z',revision:1,recipient_snapshot:{contact_name:'Other recipient',contact_value:'+298123456'}}];fixtures.invitation_deliveries=[{queue_id:'queue-sent',confirmed_at:'2026-11-10T12:00:00Z',confirmed_by:h1}];
const overviewTemplate={id:'overview-template',name:'Synthetic invitation',channels:['email'],versions:{en:{language_code:'en',subject:'Synthetic subject',body:'Draft message {invitation_link}',options:['subject','message']}}};
const overviewRpc=client.rpc;client.rpc=async(name,a)=>{if(name==='admin_save_delivery'){(window.__draftWrites??=[]).push(a);let item;if(a.p_id){item=fixtures.invitation_send_queue.find(q=>q.id===a.p_id);Object.assign(item,a.p_values,{revision:item.revision+1,updated_at:'2026-11-12T13:00:00Z'});}else{item={id:crypto.randomUUID(),household_id:a.p_household_id,...a.p_values,revision:1,created_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',recipient_snapshot:{contact_name:'Synthetic recipient',contact_value:'synthetic@example.invalid'}};fixtures.invitation_send_queue.push(item);window.__createdDraftId=item.id;}return {data:item.id};}const result=await overviewRpc(name,a);if(name==='admin_load_data')result.data.invitationTemplates=[overviewTemplate];return result;};`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("rsvp-interface-language", "en"),
      );
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + overviewMock,
        }),
      );
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
        "Invites is the landing section",
      );
      assert.equal(
        await page
          .locator(".admin-main-tabs button")
          .first()
          .getAttribute("data-tab"),
        "overview",
      );
      assert.equal(await page.locator("[data-panel=dashboard]").count(), 0);
      assert.equal(
        await page
          .locator("[data-panel=overview] > :first-child")
          .getAttribute("id"),
        "statsGrid",
      );
      assert.equal(
        await page.locator("#inviteGroupView").isChecked(),
        true,
        "grouping starts checked",
      );
      assert.ok(
        (await page.locator("#inviteRows .invite-overview-group").count()) > 0,
      );
      const geometry = await page.locator(".invite-household > summary").first().evaluate((summary) => {
        const identity = summary.querySelector('.invite-overview-identity'), name = identity.querySelector('strong'), meta = identity.querySelector('.invite-household-meta');
        const a=name.getBoundingClientRect(), b=meta.getBoundingClientRect(), reply=summary.querySelector('.invite-overview-reply').getBoundingClientRect(), food=summary.querySelector('.invite-overview-interest').getBoundingClientRect();
        return { extraArrow:getComputedStyle(identity,'::before').content, nameArrow:getComputedStyle(name,'::before').content, sameLine:Math.abs(a.top-b.top)<6 && b.left>=a.right-1, foodAfterReply:food.left>=reply.right-1, overflow:summary.scrollWidth>summary.clientWidth+1 };
      });
      assert.ok(['none','normal','""'].includes(geometry.extraArrow),'identity must not add a second arrow');
      assert.match(geometry.nameArrow,/›/);
      assert.equal(geometry.sameLine,true,'guest count and language stay beside the name');
      assert.equal(geometry.foodAfterReply,true,'food interest follows RSVP as its own column');
      assert.equal(geometry.overflow,false,'summary stays within its width');
      assert.deepEqual(await page.locator('.invite-overview-heading > span').allTextContents(),['Household','Recipient / channel','Invitation','RSVP','Food interest','Actions']);
      if (width > 1000) assert.equal(await page.evaluate(() => {
        const labels=[...document.querySelectorAll('.invite-overview-heading > span')], cells=[...document.querySelector('.invite-household > summary').children];
        return cells.every((cell,i)=>Math.abs(cell.getBoundingClientRect().left-labels[i].getBoundingClientRect().left)<3);
      }),true,'column headings align with their cells');
      if(process.env.RSVP_INVITE_PREVIEW_DIR){fs.mkdirSync(process.env.RSVP_INVITE_PREVIEW_DIR,{recursive:true});await page.locator('#inviteRows').screenshot({path:path.join(process.env.RSVP_INVITE_PREVIEW_DIR,`invites-${width}.png`)});}
      await page.locator("#settingsToggle").click();
      assert.equal(
        await page
          .locator(".settings-tabs button")
          .first()
          .getAttribute("data-settings-tab"),
        "application",
      );
      await page.locator("[data-settings-tab=application]").click();
      assert.equal(
        await page
          .locator("[data-settings-panel=application] #launchChecklist")
          .isVisible(),
        true,
      );
      assert.equal(await page.locator("#statsGrid").isVisible(), false);
      await page.locator("#mainSectionToggle").click();
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
      );
      await page.goBack();
      assert.equal(
        await page.locator("[data-panel=settings]").isVisible(),
        true,
      );
      await page.goForward();
      assert.equal(
        await page.locator("[data-panel=invites]").isVisible(),
        true,
      );
      await setInvitesGrouping(page, false);
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        2,
      );
      assert.equal(
        await page.locator("#inviteRows .hierarchy-section").count(),
        0,
        "flat layout after unchecking grouping",
      );
      assert.match(
        await page.locator("[data-invite-filter=sent]").innerText(),
        /1/,
      );
      assert.match(
        await page.locator("[data-invite-filter=awaiting]").innerText(),
        /1/,
      );
      await page.locator("[data-invite-filter=ready]").click();
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      assert.match(
        await page.locator("#inviteRows").innerText(),
        /Other recipient/,
      );
      // A data reload must use fresh records without resetting the progress filter.
      await page.evaluate(() => {
        fixtures.invitation_send_queue.find(
          (q) => q.id === "queue-ready",
        ).recipient_snapshot.contact_name = "Refreshed recipient";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(
        await page
          .locator("[data-invite-filter=ready]")
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      assert.match(
        await page.locator("#inviteRows").innerText(),
        /Refreshed recipient/,
      );
      assert.equal(
        await page.locator("#inviteGroupView").isChecked(),
        false,
        "refresh preserves the chosen layout",
      );
      assert.equal(
        await page.locator("#inviteRows .invite-overview-group").count(),
        0,
      );
      await page.locator("[data-invite-filter=all]").click();
      await page.locator("#inviteSearch").fill("example@example.invalid");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteSearch").fill("");
      await page.locator("#inviteLanguageFilter").selectOption("de");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteLanguageFilter").selectOption("all");
      await page.locator("#inviteChannelFilter").selectOption("email");
      assert.equal(
        await page.locator("#inviteRows .invite-household").count(),
        1,
      );
      await page.locator("#inviteChannelFilter").selectOption("all");
      await setInvitesGrouping(page, true);
      assert.ok((await page.locator(".invite-overview-group").count()) > 0);
      await setInvitesGrouping(page, false);

      const sent = page.locator(
        '[data-invite-household="22222222-2222-4222-8222-222222222222"]',
      );
      // The current + action uses a named template and creates a separate draft.
      await sent.getByRole("button", { name: "Create", exact: true }).click();
      await page.locator(".template-choice-popup").getByRole("button", { name: "Synthetic invitation", exact: true }).click();
      await page.waitForFunction(() => window.__draftWrites?.length === 1);
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_id), null);
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_values.status), "draft");
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_values.message_subject), "Synthetic subject");
      assert.equal(await page.evaluate(() => window.__draftWrites[0].p_values.message_body), "Draft message {invitation_link}");
      assert.equal(await sent.getByRole("button", { name: "Record as sent", exact: true }).count(), 0);
      await sent.locator("[data-delivery-id=queue-sent]").evaluate(node => { node.open = true; });
      assert.match(await sent.innerText(), /Manually recorded as sent/);
      const draftId = await page.evaluate(() => window.__createdDraftId);
      const draft = sent.locator('[data-delivery-id="' + draftId + '"]');
      await draft.evaluate(node => { node.open = true; });
      await draft.getByText("Edit delivery", { exact: true }).click();
      const form = draft.locator("form.delivery-review-form");
      assert.equal(await form.getByRole("combobox", { name: "Delivery status", exact: true }).locator("option[value=ready]").count(), 0, "unpublished drafts cannot be marked Ready");
      await form.locator(".delivery-customize").evaluate(node => { node.open = true; });
      await form.getByRole("textbox", { name: "Message text", exact: true }).fill("Updated draft {invitation_link}");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__draftWrites.length === 2);
      assert.equal(await page.evaluate(() => window.__draftWrites[1].p_id), draftId);
      assert.equal(await page.evaluate(() => window.__draftWrites[1].p_values.status), "draft");
      assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === window.__createdDraftId).message_body), "Updated draft {invitation_link}");
      assert.equal(await page.evaluate(() => fixtures.invitation_send_queue.find(queue => queue.id === "queue-sent").message_body), "Sent example");
      assert.equal(await page.evaluate(() => fixtures.invitation_deliveries.length), 1, "draft creation/editing preserves the original Sent confirmation");
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      assert.match(await page.locator("[data-invite-filter=sent]").innerText(), /1/);
      assert.equal(await sent.locator('.invite-household-content > .shortcut-facts [data-shortcut-fact="visits"]').textContent(), "0", "every expanded household shows visit tracking without requiring a Shortcuts batch");
      assert.equal(await sent.locator('.invite-household-content > .shortcut-facts [data-shortcut-fact="rsvp"]').textContent(), "Awaiting reply", "Sent and zero visits do not imply RSVP confirmation");
      // The extracted view must pick up changed permissions on the next reload.
      await page.evaluate(() => {
        window.__accessPermissions.preset = "custom";
        window.__accessPermissions.sections.invites = "view";
      });
      await refreshFixture(page);
      await page.waitForFunction(
        () => !document.querySelector("#refreshButton").disabled,
      );
      assert.equal(await sent.getByRole("button", { name: "Create", exact: true }).count(), 0, "view-only invitation access cannot create drafts");
      await sent.evaluate(node => { node.open = true; node.dispatchEvent(new Event("toggle")); });
      await sent.locator("[data-delivery-id=queue-sent]").evaluate(node => { node.open = true; });
      assert.match(await sent.innerText(), /Sent example/);
      assert.match(await sent.innerText(), /Manually recorded as sent/);
      assert.equal(await sent.getByText("Edit delivery", { exact: true }).count(), 0, "view-only access keeps delivery records read-only");
      assert.equal(await sent.locator("form.delivery-review-form").count(), 0);
      assert.equal(await page.evaluate(() => window.__draftWrites.length), 2);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.evaluate(() => { window.__accessPermissions.sections.food = "none"; });
      await refreshFixture(page);
      await page.waitForFunction(() => !document.querySelector('#refreshButton').disabled);
      assert.equal(await page.locator('.invite-overview-interest').count(),0,'food column follows Food permission');
      assert.equal(await page.locator('.invite-overview-heading > span').count(),5);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "PASS Invites overview: flat/grouped layout, household counts, separate sent/RSVP filters, recipient/language/channel search, unpublished drafts, preserved sent history and mobile/desktop fit.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

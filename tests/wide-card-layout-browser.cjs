// Exercise the real admin layout with fabricated records in a public-only export.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { selectDatabaseTab } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, stageExtra, cleanup } = createPublicFoodHarness("wide-card-layout");
const previewDir = process.env.RSVP_WIDE_LAYOUT_PREVIEW_DIR;
const seed = `
fixtures.event_settings[0].is_published=false;
fixtures.event_settings[0].planning_config={groups:[{id:'group_a',names:{en:'Family',fo:'Familja',de:'Familie'}},{id:'group_b',names:{en:'Friends',fo:'Vinir',de:'Freunde'}}],labels:{households:{en:'Households'},guests:{en:'Guests'}}};
fixtures.event_languages.forEach(l=>l.display_name={en:'English',fo:'Føroyskt',de:'Deutsch'}[l.language_code]);
fixtures.event_locations=[{id:cat1,name:'Example hall',address:'Example street 12',country_code:'DE',timezone:'Europe/Berlin',sort_order:1,notes:'Doors open before the celebration.',welcome_en:'Welcome to our celebration.'},{id:cat2,name:'Example garden',address:'Example lane 2',country_code:'FO',timezone:'Atlantic/Faroe',sort_order:2}];
fixtures.event_sessions=[{id:s1,session_key:'dinner',name:'Celebration dinner',sort_order:1,is_active:true,requires_rsvp:true,location_id:cat1,starts_at:'2027-02-20T17:00:00Z',ends_at:'2027-02-20T21:00:00Z',created_at:'2026-11-01T12:00:00Z'}];
`;

async function rect(locator) {
  return locator.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
  });
}
async function checkPair(panel, boxes, width, label) {
  const [first, second] = await Promise.all([rect(boxes.nth(0)), rect(boxes.nth(1))]);
  if (width >= 1100) {
    assert(Math.abs(first.y - second.y) < 2, label + " shares the wide row");
    assert(Math.abs(second.x - first.right - 16) < 2, label + " has a 16px column gap");
    assert(Math.abs(first.width - second.width) < 2, label + " uses equal columns");
  } else {
    assert(Math.abs(first.x - second.x) < 2, label + " stacks on narrow screens");
    assert(Math.abs(second.y - first.bottom - 16) < 2, label + " has a 16px row gap");
    assert(Math.abs(first.width - (await rect(panel)).width) < 2, label + " uses available width");
  }
}
async function checkFullRow(panel, box, label) {
  assert(Math.abs((await rect(box)).width - (await rect(panel)).width) < 2, label + " editor spans its row");
}
async function checkBounds(page, label) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + " fits without page overflow");
}
async function capture(panel, name, width) {
  if (!previewDir || width === 820) return;
  await panel.screenshot({ path: path.join(previewDir, name + "-" + width + ".png") });
}

async function checkSessionSchedule(form, width) {
  const schedule = form.locator(".session-schedule");
  const venue = schedule.getByLabel("Session venue", { exact: true });
  const range = schedule.locator(".session-time-range");
  const start = range.locator('[aria-label="Starts (venue local time)"]:visible');
  const end = range.locator('[aria-label="Ends (venue local time)"]:visible');
  const [venueBox, rangeBox, startBox, endBox] = await Promise.all([rect(venue), rect(range), rect(start), rect(end)]);
  assert.ok(Math.abs(venueBox.width - rangeBox.width) < 2 && venueBox.bottom < startBox.y,
    "the venue spans the schedule above the date and time fields");
  if (width >= 660) {
    assert.ok(Math.abs(startBox.y - endBox.y) < 2 && startBox.right < endBox.x, "start and end share the wide schedule row");
  } else {
    assert.ok(Math.abs(startBox.x - endBox.x) < 2 && startBox.bottom < endBox.y, "start and end stack on phones");
  }
  assert.equal(await form.locator(".session-options").getByRole("checkbox").count(), 2, "session options stay together");
  return { schedule, venue, start };
}

async function checkSessionEditor(page, session, width) {
  const form = session.locator("form.session-edit-form");
  const { schedule, venue, start } = await checkSessionSchedule(form, width);
  const startValue = width === 820 ? "2027-02-20T18:00" : "2027-02-20";
  assert.equal(await start.inputValue(), startValue, "the saved start remains in the venue's local time");
  if (width !== 820) {
    const clock = schedule.getByRole("textbox", { name: "Starts (venue local time) · Event time", exact: true });
    assert.equal(await clock.inputValue(), width === 390 ? "6:00 PM" : "18:00");
  }

  const footer = form.locator(".form-actions");
  const save = footer.getByRole("button", { name: "Save", exact: true });
  const manage = footer.getByRole("button", { name: "Manage households", exact: true });
  assert.equal(await save.isDisabled(), true, "opening the session shows a clean form");
  assert.equal(await manage.isEnabled(), true, "household management is available on an unchanged session");
  if (width === 1440) {
    const [footerBox, saveBox, manageBox] = await Promise.all([rect(footer), rect(save), rect(manage)]);
    assert.ok(Math.abs(manageBox.right - footerBox.right) < 2 && Math.abs(manageBox.y - saveBox.y) < 2,
      "Manage households sits at the right edge of the wide action row");
    await manage.click();
    const dialog = page.getByRole("dialog", { name: "Manage households · Celebration dinner", exact: true });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await manage.evaluate(button => button === document.activeElement), true, "Cancel returns focus to Manage households");
  }

  const dates = session.locator(".session-record-details");
  assert.equal(await dates.evaluate(record => record.open), false, "record timestamps start collapsed");
  assert.ok((await rect(dates)).y >= (await rect(form)).bottom - 1, "record timestamps follow the editor");
  await dates.locator(":scope > summary").click();
  assert.equal(await dates.locator("time").getAttribute("datetime"), "2026-11-01T12:00:00Z");
  assert.equal(await dates.getByText("Not recorded", { exact: true }).count(), 1);
  await dates.locator(":scope > summary").click();

  const originalVenue = await venue.inputValue();
  await venue.selectOption({ label: "Example garden · FO" });
  assert.equal(await start.inputValue(), startValue, "choosing another venue preserves the typed local date and time");
  assert.match(await schedule.innerText(), /Atlantic\/Faroe/);
  assert.equal(await save.isEnabled(), true, "changing the venue leaves the session editable");
  return { venue, originalVenue };
}

(async () => {
  if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 820, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 1000 }), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((screenWidth) => {
        if (window === window.top) {
          localStorage.setItem("rsvp-interface-language", "en");
          localStorage.setItem("event-appearance", "dark");
          window.__personalProfile = {
            rsvp_interface_language: "en", rsvp_interface_appearance: "dark",
            rsvp_interface_time_format: screenWidth === 390 ? "12" : screenWidth === 1440 ? "24" : "locale",
          };
        }
      }, width);
      await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + stageExtra + "\n" + seed);
      await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
      await page.waitForFunction(() => document.querySelector("#inviteOverviewCounts .invite-stat-row"));

      await page.locator("[data-tab=events]").click();
      const events = page.locator("[data-panel=events]"), eventCards = events.locator(":scope > :is(.settings-card, #planningConfigHost):not(.hidden)");
      await checkPair(events, eventCards, width, "Event cards");
      await checkBounds(page, "Events reading view");
      await capture(events, "events-readonly", width);
      await events.locator('[data-record-pencil="event-settings"]').click();
      await checkFullRow(events, eventCards.first(), "Event settings");
      await page.locator("#settingName").fill("Unsaved example event");
      await page.setViewportSize({ width: width >= 1100 ? 820 : 1440, height: 1000 });
      assert.equal(await page.locator("#settingName").inputValue(), "Unsaved example event", "resizing preserves the event draft");
      await checkFullRow(events, eventCards.first(), "Resized event settings");
      await page.setViewportSize({ width, height: 1000 });
      await checkBounds(page, "Events editor");
      await capture(events, "events-edit", width);
      await page.locator("#eventSettingsForm").getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await page.locator("#settingName").inputValue(), "Example celebration", "Cancel restores event settings");
      assert.equal(await page.locator("#eventSettingsForm").isVisible(), false);
      await checkPair(events, eventCards, width, "Cancelled event cards");
      const planning = await openBox(page, "event-planning");
      await checkFullRow(events, page.locator("#planningConfigHost"), "Planning");
      await planning.locator("[data-discard]").click();
      await checkPair(events, eventCards, width, "Cancelled planning cards");

      await page.locator("[data-tab=venues]").click();
      const venues = page.locator("[data-panel=venues]"), venueWorkspace = venues.locator(":scope > .venue-workspace");
      const venueTab = page.locator('[data-venue-tab="venues"]'), sessionTab = page.locator('[data-venue-tab="sessions"]');
      await checkFullRow(venues, venueWorkspace, "Venue workspace");
      await checkBounds(page, "Venues reading view");
      await capture(venues, "venues-readonly", width);
      const venue = page.locator("#venueList > details").first();
      await venue.locator(":scope > summary").click();
      await venue.locator("[data-record-pencil]").click();
      const venueForm = venue.locator("form.management-form"), venueName = venueForm.locator('input[type="text"]').first();
      await venueName.fill("Unsaved example venue");
      await checkBounds(page, "Venue editor");
      await capture(venues, "venues-edit", width);
      await sessionTab.click();
      assert.equal(await venueForm.isVisible(), false, "the Venues editor is hidden on Sessions");
      const session = page.locator("#sessionsList > details").first();
      await session.locator(":scope > summary").click();
      await session.locator("[data-record-pencil]").click();
      await checkFullRow(venues, venueWorkspace, "Session editor");
      await checkBounds(page, "Session editor");
      const sessionDraft = await checkSessionEditor(page, session, width);
      await capture(session, "sessions-edit", width);
      await session.locator("form [data-discard]").click();
      assert.equal(await sessionDraft.venue.inputValue(), sessionDraft.originalVenue, "Cancel restores the saved venue");
      const addSession = page.locator("#newSessionEditor").locator("..");
      await addSession.locator(":scope > summary").click();
      const createSession = addSession.locator("form.session-edit-form");
      await checkSessionSchedule(createSession, width);
      assert.equal(await createSession.getByRole("button", { name: "Manage households", exact: true }).count(), 0);
      assert.equal(await addSession.locator(".session-record-details").count(), 0);
      await addSession.locator(":scope > summary").click();
      await venueTab.click();
      assert.ok(await venueForm.isVisible(), "returning to Venues restores the open editor");
      assert.equal(await venueName.inputValue(), "Unsaved example venue", "switching tabs preserves the venue draft");
      await venueForm.locator("[data-discard]").click();
      assert.equal(await venueName.inputValue(), "Example hall", "Cancel restores venue name");
      assert.equal(await venueForm.isVisible(), false);
      const addVenue = page.locator("#newVenueForm").locator("..");
      await addVenue.locator(":scope > summary").click();
      await checkBounds(page, "Add venue editor");
      await addVenue.locator(":scope > summary").click();

      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=backups]").click();
      const backups = page.locator("[data-settings-panel=backups]"), database = backups.locator(":scope > .panel");
      assert.equal(await database.count(), 1, "Backup, Restore and Wipe share one Database box");
      await checkFullRow(backups, database, "Database");
      await checkBounds(page, "Backups");
      await capture(backups, "backups", width);
      await page.locator("#backupExportMode input[value=template]").check();
      await page.locator('#backupExportSections input[value="food"]').uncheck();
      await page.locator("#backupExportCompressed").check();
      await page.setViewportSize({ width: width >= 1100 ? 820 : 1440, height: 1000 });
      assert(await page.locator("#backupExportMode input[value=template]").isChecked(), "resizing retains backup mode");
      assert.equal(await page.locator('#backupExportSections input[value="food"]').isChecked(), false, "resizing retains included sections");
      assert(await page.locator("#backupExportCompressed").isChecked(), "resizing retains file options");
      await selectDatabaseTab(page, "restore");
      assert(await page.getByRole("button", { name: "Validate backup", exact: true }).isDisabled(), "no validation without a selected backup");
      assert.equal(await page.getByRole("button", { name: "Restore backup", exact: true }).count(), 0, "restore remains hidden before validation");
      assert.equal(await page.locator("#backupFile").inputValue(), "", "no backup file was selected");
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      assert.equal(await page.evaluate(() => window.__calls.some(({ name }) => /restore|backup|save_venue|save_event|save_session/.test(name))), false, "layout checks never write event or backup data");
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS wide cards: Events split wide and stack narrow; Venues and Sessions share one workspace, retain drafts and fit at 390/820/1440px. Database choices, restore gates and unpublished state are retained.");
    if (previewDir) console.log("Synthetic previews: " + previewDir);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openRecordEditor, selectWorkTab } = require("./helpers/language-ui.cjs");

const mapleId = "22222222-2222-4222-8222-222222222222";
const pineId = "33333333-3333-4333-8333-333333333333";
const oakId = "44444444-4444-4444-8444-444444444445";
const installedRoot = process.env.RSVP_TEST_SITE_ROOT;
const harness = installedRoot
  ? createFoodHarness("food-access", { root: path.resolve(installedRoot) })
  : createPublicFoodHarness("food-access");

const fixture = `
const cedar='44444444-4444-4444-8444-444444444444';
const oak='${oakId}';
const archived='44444444-4444-4444-8444-444444444446';
const empty='44444444-4444-4444-8444-444444444447';
const neighbors='cccccccc-cccc-4ccc-8ccc-cccccccccccd';
const retiredAt='2026-11-21T00:00:00Z';
Object.assign(fixtures.event_settings[0], {food_enabled:true,food_stage:'interest'});
fixtures.event_settings[0].planning_config.groups.reverse();
fixtures.relation_groups=[
  {id:cat1,name:'Family',sort_order:1},
  {id:cat2,name:'Friends',sort_order:3},
  {id:neighbors,name:'Neighbors',sort_order:2},
];
Object.assign(fixtures.households[0], {household_name:'Grouping only',food:false});
Object.assign(fixtures.households[1], {household_name:'Maple household',food:true,food_interest:true});
Object.assign(fixtures.households[2], {household_name:'Pine household',food:false,food_interest:false});
for (const [id,household_name,food,food_interest,food_confirmed,archived_at,planning_group_id,relation_group_id,parent_id,sort_order] of [
  [cedar,'Cedar household',true,true,true,null,'group_b',cat1,h1,3],
  [oak,'Oak household',false,null,false,null,'group_a',neighbors,null,1],
  [archived,'Archived household',true,true,false,retiredAt,'group_a',cat2,null,2],
  [empty,'Retired household',false,null,false,null,'group_a',cat2,null,3],
]) {
  fixtures.households.push({id,household_name,food,food_interest,food_confirmed,archived_at,planning_group_id,
    relation_group_id,parent_id,sort_order,language:'en',rsvp_state:id===cedar?'locked':'open'});
}
for (const id of [h3,cedar,oak,archived,empty]) {
  fixtures.guests.push({id:'guest-'+id,household_id:id,first_name:'Sample',language:'en',
    archived_at:id===empty?retiredAt:null});
}
fixtures.food_claims.push({household_id:cedar,food_item_id:fixtures.food_items[0].id,quantity:1});
fixtures.household_session_defaults.push(...[h2,cedar,oak,archived,empty].map(household_id=>({
  household_id,session_id:s1,is_invited:true,
})));
fixtures.guest_session_overrides.push(
  {guest_id:'guest-'+h3,session_id:s1,is_invited:true},
  {guest_id:'guest-'+oak,session_id:s1,is_invited:false},
);
window.__foodAccessAttempts=[];
window.__foodAccessSuccesses=[];
window.__sessionEdits=[];
const priorFoodAccessRpc=client.rpc;
client.rpc=async(name,args)=>{
  if(name==='admin_load_data') {
    const result=await priorFoodAccessRpc(name,args);
    const sections=window.__accessPermissions.sections;
    result.data.sessionInvitationLocks=sections.invites==='none'?[]:[cedar];
    if(sections.households==='none'&&sections.invites!=='none') {
      result.data.households=result.data.households.map(({food,food_confirmed,...household})=>household);
    }
    return structuredClone(result);
  }
  if(name==='admin_set_food_access') {
    window.__foodAccessAttempts.push(structuredClone(args));
    if(window.__failFoodAccess===args.p_household_id) {
      window.__failFoodAccess=null;
      return {error:{message:'Simulated food access write failure'}};
    }
    const household=fixtures.households.find(item=>item.id===args.p_household_id);
    if(household.food!==args.p_expected) return {error:{message:'Food access changed; refresh and try again'}};
    if(!args.p_enabled&&household.food_confirmed) return {error:{message:'Food commitments exist'}};
    if(window.__accessPermissions.sections.households!=='edit') return {error:{message:'Permission denied'}};
    household.food=args.p_enabled;
    window.__foodAccessSuccesses.push(structuredClone(args));
    return {data:null};
  }
  if(name==='admin_session_invitation_locks') return {data:[cedar]};
  if(name==='admin_edit_session_households') {
    window.__sessionEdits.push(structuredClone(args));
    return {data:null};
  }
  return priorFoodAccessRpc(name,args);
};
`;

function namedButton(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function row(scope, name) {
  return scope.getByRole("row").filter({ hasText: name });
}

async function assertInvitationOnly(dialog) {
  assert.equal(await dialog.getByRole("tab").count(), 0);
  assert.equal(await namedButton(dialog, "Manage food access").count(), 0);
  assert.ok(await dialog.getByRole("checkbox", { name: "Select all", exact: true }).isVisible());
}

async function assertFitsViewport(locator) {
  const result = await locator.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return {
      bounds: bounds.toJSON(), viewport: [innerWidth, innerHeight],
      overflow: bounds.left < -1 || bounds.right > innerWidth + 1 ||
        bounds.top < -1 || bounds.bottom > innerHeight + 1,
    };
  });
  assert.equal(result.overflow, false, `${locator} outside viewport: ${JSON.stringify(result)}`);
}

async function setup(browser, permissions = {}) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 870 }, serviceWorkers: "block" });
  page.setDefaultTimeout(6500);
  const pageErrors = [], liveRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (/\/(rest|auth|functions)\/v1\//.test(new URL(request.url()).pathname)) liveRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("rsvp-interface-language", "en"));
  await routeSyntheticSdk(page, [harness.mock, harness.extra, harness.stageExtra, fixture, `
    Object.assign(window.__accessPermissions.sections, ${JSON.stringify(permissions)});
    window.__accessPermissions.preset=${Object.keys(permissions).length ? "'custom'" : "'full'"};
  `].join("\n"));
  await page.route(/\/js\/config(?:\.production)?\.js(?:\?|$)/, route => route.fulfill({
    contentType: "text/javascript",
    body: 'window.RSVP_CONFIG={supabaseUrl:"https://fixture.supabase.invalid",supabaseKey:"sb_publishable_synthetic"};',
  }));
  await page.goto(`http://127.0.0.1:${harness.server.address().port}/admin/`);
  try {
    await page.waitForFunction(() => window.__fetchCount > 0 && !document.getElementById("adminApp").classList.contains("hidden"));
  } catch (error) {
    throw new Error(`Synthetic admin did not load: ${pageErrors.join("; ")}`, { cause: error });
  }
  return { page, pageErrors, liveRequests };
}

async function manageSessionHouseholds(page) {
  await selectWorkTab(page, "venues");
  await page.getByRole("tab", { name: "Sessions", exact: true }).click();
  const session = page.locator("#sessionsList > details").filter({ hasText: "Dinner" });
  await session.locator(":scope > summary").click();
  await openRecordEditor(session);
  const trigger = namedButton(session, "Manage households");
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Manage households · Dinner", exact: true });
  await dialog.waitFor();
  return { trigger, dialog };
}

async function testOrganizer(browser) {
  const { page, pageErrors, liveRequests } = await setup(browser);
  await selectWorkTab(page, "food");
  const foodAccess = namedButton(page, "Food access");
  const openChoices = namedButton(page, "Open food choices");
  assert.ok(await foodAccess.isVisible());
  assert.ok(await openChoices.isVisible());
  const [accessBox, openBox] = await Promise.all([foodAccess.boundingBox(), openChoices.boundingBox()]);
  assert.ok(accessBox.x + accessBox.width <= openBox.x && Math.abs(accessBox.y - openBox.y) <= 1,
    "Food access sits to the left of Open food choices on wide screens");
  await page.setViewportSize({ width: 320, height: 740 });
  await assertFitsViewport(foodAccess);
  await assertFitsViewport(openChoices);
  await foodAccess.press("Enter");
  const roster = page.getByRole("dialog", { name: "Food access", exact: true });
  await roster.waitFor();
  await assertFitsViewport(roster);
  await assertFitsViewport(namedButton(roster, "Cancel"));
  const [allowed, all, blocked] = ["allowed", "all", "blocked"].map(name => roster.locator(`[data-food-access-filter="${name}"]`));
  assert.equal(await allowed.getAttribute("aria-pressed"), "true");
  assert.match(await allowed.innerText(), /2/);
  assert.match(await blocked.innerText(), /2/);
  assert.match(await all.innerText(), /4/);
  const search = roster.getByRole("searchbox", { name: "Search households" });
  const maple = row(roster, "Maple household"), pine = row(roster, "Pine household"), oak = row(roster, "Oak household");
  const cedarCheck = row(roster, "Cedar household").getByRole("checkbox");
  const groupHeadings = roster.locator("fieldset > legend");
  const householdHeadings = roster.getByRole("rowheader", { name: /^(Maple|Cedar|Oak|Pine) household$/ });
  assert.equal(await maple.getByRole("cell", { name: "Yes", exact: true }).count(), 1);
  assert.equal(await pine.count(), 0);
  assert.deepEqual(await groupHeadings.allTextContents(), ["Example group B"]);
  assert.deepEqual(await householdHeadings.allTextContents(), ["Maple household", "Cedar household"],
    "households follow saved order within their group");
  assert.ok(await cedarCheck.isChecked());
  assert.ok(await cedarCheck.isDisabled(), "existing food commitments keep access enabled");
  await blocked.press("Enter");
  assert.equal(await pine.getByRole("cell", { name: "No", exact: true }).count(), 1);
  assert.equal(await oak.getByRole("cell", { name: "Unanswered", exact: true }).count(), 1);
  await pine.getByRole("checkbox").check();
  await search.fill("oak");
  assert.equal(await pine.count(), 0);
  assert.deepEqual(await groupHeadings.allTextContents(), ["Example group A"]);
  assert.equal(await roster.getByText("Friends", { exact: true }).count(), 0, "filters omit empty groups");
  await oak.getByRole("checkbox").check();
  await search.fill("");
  await allowed.click();
  await all.click();
  assert.deepEqual(await groupHeadings.allTextContents(), ["Example group B", "Example group A"],
    "top-level groups follow the saved planning order");
  assert.deepEqual(await householdHeadings.allTextContents(), [
    "Maple household", "Cedar household", "Oak household", "Pine household",
  ], "relations follow saved order within each planning group");
  assert.ok(await pine.getByRole("checkbox").isChecked());
  assert.ok(await oak.getByRole("checkbox").isChecked());
  assert.equal(await roster.getByText(/Grouping only|Archived household|Retired household/).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__foodAccessAttempts), []);

  const save = namedButton(roster, "Save");
  await page.evaluate(id => (window.__failFoodAccess = id), oakId);
  await save.click();
  await roster.getByText(/Simulated food access write failure/).first().waitFor();
  assert.ok(await oak.getByRole("checkbox").isChecked(), "failed changes survive for retry");
  await save.click();
  await roster.waitFor({ state: "detached" });
  const successful = await page.evaluate(() => window.__foodAccessSuccesses);
  assert.deepEqual(successful.map(call => call.p_household_id).sort(), [pineId, oakId]);
  for (const call of successful) {
    assert.equal(call.p_expected, false);
    assert.equal(call.p_enabled, true);
    assert.ok(call.p_reason.trim());
  }
  assert.equal(await page.evaluate(() => window.__foodAccessAttempts.length), 3);
  await page.waitForFunction(() => document.activeElement?.id === "adminFoodAccess");
  await page.setViewportSize({ width: 1180, height: 870 });
  await openChoices.click();
  await namedButton(page.locator(".inline-confirmation"), "Open food choices").click();
  await openChoices.waitFor({ state: "hidden" });
  assert.equal(await page.locator("#adminFoodStageStatus").innerText(), "Choose food");
  assert.ok(await foodAccess.isVisible(), "the roster stays available in food selection");
  await foodAccess.click();
  await roster.waitFor();
  assert.ok(await pine.getByRole("checkbox").isChecked());
  assert.ok(await oak.getByRole("checkbox").isChecked());
  await maple.getByRole("checkbox").uncheck();
  await save.click();
  await roster.waitFor({ state: "detached" });
  const revoked = await page.evaluate(() => window.__foodAccessSuccesses.at(-1));
  assert.deepEqual([revoked.p_household_id, revoked.p_enabled, revoked.p_expected], [mapleId, false, true]);

  const { trigger, dialog } = await manageSessionHouseholds(page);
  const invitationsTab = dialog.getByRole("tab", { name: "Invitations", exact: true });
  const foodTab = dialog.getByRole("tab", { name: "Food", exact: true });
  assert.equal(await invitationsTab.getAttribute("aria-selected"), "true");
  const mapleAssignment = dialog.getByRole("checkbox", { name: "Maple household", exact: true });
  assert.ok(await mapleAssignment.isChecked());
  assert.ok(await dialog.getByRole("checkbox", { name: /Pine household.*Guest exceptions/ }).isVisible());
  const locked = dialog.getByRole("checkbox", { name: /Cedar household/ });
  assert.ok(await locked.isChecked());
  assert.ok(await locked.isDisabled(), "existing RSVP locks remain enforced");
  await mapleAssignment.uncheck();
  await invitationsTab.press("ArrowRight");
  assert.equal(await foodTab.getAttribute("aria-selected"), "true");
  const foodPanel = dialog.getByRole("tabpanel", { name: "Food", exact: true });
  assert.equal(await row(foodPanel, "Maple household").getByRole("cell", { name: "Blocked", exact: true }).count(), 1,
    "the roster reflects saved invitations while invitation edits are pending");
  assert.equal(await row(foodPanel, "Pine household").getByRole("cell", { name: "Allowed", exact: true }).count(), 1,
    "Pine is included because of its guest-level invitation");
  assert.equal(await row(foodPanel, "Pine household").getByRole("cell", { name: "No", exact: true }).count(), 1,
    "food access remains separate from saved interest");
  assert.equal(await row(foodPanel, "Cedar household").count(), 1);
  assert.equal(await foodPanel.getByText(/Oak household|Grouping only|Archived household|Retired household/).count(), 0,
    "households without an effectively invited active guest are excluded");
  const manage = namedButton(foodPanel, "Manage food access");
  assert.ok(await manage.isDisabled(), "resolve invitation changes before moving to event-wide food access");
  await page.setViewportSize({ width: 390, height: 820 });
  await assertFitsViewport(dialog);
  await assertFitsViewport(manage);
  const close = namedButton(foodPanel, "Close");
  await assertFitsViewport(close);
  assert.ok(await dialog.evaluate(node => node.matches(":modal")));
  await close.click();
  const discard = dialog.locator(".inline-confirmation");
  await discard.getByText("Discard unsaved changes?", { exact: true }).waitFor();
  await namedButton(discard, "Cancel").click();
  await foodTab.press("ArrowLeft");
  assert.equal(await invitationsTab.getAttribute("aria-selected"), "true");
  assert.equal(await mapleAssignment.isChecked(), false, "tab changes and cancelling discard preserve the draft");
  await mapleAssignment.check();
  await foodTab.click();
  await manage.click();
  await roster.waitFor();
  assert.equal(await dialog.isVisible(), false);
  await all.click();
  assert.deepEqual(await groupHeadings.allTextContents(), ["Example group B", "Example group A"],
    "the session shortcut opens the grouped event-wide roster");
  await page.keyboard.press("Escape");
  await roster.waitFor({ state: "detached" });
  await page.waitForFunction(node => node === document.activeElement, await trigger.elementHandle());
  await trigger.press("Enter");
  await dialog.waitFor();
  await foodTab.click();
  await manage.click();
  await roster.waitFor();
  await blocked.click();
  await maple.getByRole("checkbox").check();
  await save.click();
  await roster.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.recordPencil?.startsWith("session:"));
  assert.deepEqual(await page.evaluate(() => window.__sessionEdits), []);

  const invitations = (await manageSessionHouseholds(page)).dialog;
  const assignment = invitations.getByRole("checkbox", { name: "Maple household", exact: true });
  assert.ok(await assignment.isChecked(), "changing food access leaves the session invitation assigned");
  await assignment.uncheck();
  const foodWrites = await page.evaluate(() => window.__foodAccessAttempts.length);
  await namedButton(invitations, "Save").click();
  await invitations.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.recordPencil?.startsWith("session:"));
  const [invitationEdit] = await page.evaluate(() => window.__sessionEdits);
  assert.deepEqual([invitationEdit.p_add, invitationEdit.p_remove], [[], [mapleId]]);
  assert.equal(await page.evaluate(() => window.__foodAccessAttempts.length), foodWrites,
    "saving session invitations leaves household food access alone");
  assert.equal(await page.evaluate(id => window.__fixtures.households.find(h => h.id === id).food_interest, mapleId), true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(liveRequests, []);
}

async function testPermissions(browser) {
  const readOnly = await setup(browser, { food: "view", households: "view" });
  await selectWorkTab(readOnly.page, "food");
  const foodAccess = namedButton(readOnly.page, "Food access");
  assert.equal(await namedButton(readOnly.page, "Open food choices").isVisible(), false);
  await foodAccess.click();
  const roster = readOnly.page.getByRole("dialog", { name: "Food access", exact: true });
  await roster.waitFor();
  assert.equal(await namedButton(roster, "Save").count(), 0);
  assert.equal(await roster.locator('input[type="checkbox"]:enabled').count(), 0);
  await namedButton(roster, "Close").click();
  const { dialog } = await manageSessionHouseholds(readOnly.page);
  await dialog.getByRole("tab", { name: "Food", exact: true }).click();
  await namedButton(dialog, "Manage food access").click();
  await roster.waitFor();
  assert.equal(await namedButton(roster, "Save").count(), 0, "the session shortcut preserves read-only food access");
  assert.deepEqual(readOnly.pageErrors, []);
  assert.deepEqual(readOnly.liveRequests, []);

  const noFood = await setup(browser, { food: "none" });
  assert.equal(await noFood.page.getByRole("tab", { name: "Food", exact: true }).isVisible(), false);
  const invitations = (await manageSessionHouseholds(noFood.page)).dialog;
  await assertInvitationOnly(invitations);
  assert.ok(await invitations.getByRole("checkbox", { name: "Maple household", exact: true }).isChecked());
  assert.deepEqual(noFood.pageErrors, []);
  assert.deepEqual(noFood.liveRequests, []);

  const noHouseholds = await setup(browser, { food: "edit", households: "none" });
  await selectWorkTab(noHouseholds.page, "food");
  assert.equal(await namedButton(noHouseholds.page, "Food access").isVisible(), false,
    "when household access flags are redacted, the roster never presents them as blocked");
  const redacted = (await manageSessionHouseholds(noHouseholds.page)).dialog;
  await assertInvitationOnly(redacted);
  assert.deepEqual(noHouseholds.pageErrors, []);
  assert.deepEqual(noHouseholds.liveRequests, []);
}

harness.server.listen(0, "127.0.0.1", async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await testOrganizer(browser);
    await testPermissions(browser);
    console.log("PASS grouped Food access and Session food, invitation, and permission checks in synthetic Chromium.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    harness.server.close();
    harness.cleanup?.();
  }
});

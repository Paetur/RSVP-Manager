// Approved settings layout against actual controllers, using synthetic data only.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { server, mock, extra, stageExtra, out, cleanup } =
  createPublicFoodHarness("settings-cards");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  let cases = 0;
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const width of [390, 820, 1160])
      for (const theme of ["light", "dark"])
        for (const language of ["en", "de", "fo"]) {
          const page = await browser.newPage({
              viewport: { width, height: 1000 },
              hasTouch: width < 1000,
            }),
            errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript(
            ({ language, theme }) => {
              if (window === window.top) {
                localStorage.setItem("rsvp-interface-language", language);
                localStorage.setItem("event-appearance", theme);
              }
            },
            { language, theme },
          );
          const seed = `fixtures.event_languages.forEach(l=>l.display_name={en:'English',fo:'Føroyskt',de:'Deutsch'}[l.language_code]);fixtures.event_settings[0].is_published=false;fixtures.event_settings[0].event_type='wedding';fixtures.event_settings[0].planning_config={groups:[{id:'family',names:{en:'Family',fo:'Familja',de:'Familie'}},{id:'friends',names:{en:'Friends',fo:'Vinir',de:'Freunde'}}],labels:{households:{en:'Households'},guests:{en:'Guests'}}};fixtures.households[0].planning_group_id='family';`;
          await routeSyntheticSdk(page, mock + "\n" + extra + "\n" + stageExtra + "\n" + seed);
          await page.goto(
            "http://127.0.0.1:" + server.address().port + "/admin/",
          );
          await page.waitForFunction(
            () =>
              document.querySelector("#inviteOverviewCounts .invite-stat-row"),
          );
          await page.locator("[data-tab=events]").click();
          const saveText = { en: "Save", de: "Speichern", fo: "Goym" }[
            language
          ];
          for (const selector of [
            "#eventSettingsForm",
            "#planningConfigHost form",
            "#eventFeaturesHost form",
          ])
            assert.equal(
              await page
                .locator(selector + " button[type=submit]")
                .textContent(),
              saveText,
            );
          const cards = page.locator(
            "[data-panel=events] .settings-card",
          );
          const rects = await cards.evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width };
            }),
          );
          assert.equal(rects.length, 3);
          if (width >= 1100) {
            assert(Math.abs(rects[0].y - rects[1].y) < 2, "reading cards share the wide row");
            assert(Math.abs(rects[1].x - rects[0].right - 16) < 2, "wide cards retain a 16px horizontal gap");
            assert(Math.abs(rects[2].y - Math.max(rects[0].bottom, rects[1].bottom) - 16) < 2, "next reading row retains a 16px gap");
          } else {
            for (let i = 1; i < rects.length; i++)
              assert(Math.abs(rects[i].y - rects[i - 1].bottom - 16) < 2, "narrow cards stack with 16px gaps");
          }
          async function checkPencils() {
            for (const button of await page
              .locator(
                ":is([data-panel=events],.settings-subsection):not(.hidden) .settings-card-heading > :is([data-record-pencil],[data-local-edit]):visible",
              )
              .all()) {
              const geometry = await button.evaluate((n) => {
                const card = n.closest("[data-settings-card]"),
                  c = card.getBoundingClientRect(),
                  b = n.getBoundingClientRect(),
                  s = getComputedStyle(card);
                return {
                  right: c.right - b.right,
                  top: b.top - c.top,
                  padRight:
                    parseFloat(s.paddingRight) + parseFloat(s.borderRightWidth),
                  padTop:
                    parseFloat(s.paddingTop) + parseFloat(s.borderTopWidth),
                  heading: !!n.closest(".settings-card-heading"),
                  title: n.getAttribute("aria-label"),
                };
              });
              assert(geometry.heading);
              assert(Math.abs(geometry.right - geometry.padRight) < 3);
              assert(
                Math.abs(geometry.top - geometry.padTop) < 4,
                JSON.stringify({ width, theme, language, geometry }),
              );
            }
          }
          await checkPencils();
          assert.equal(
            await page.locator("#planningConfigHost form").isVisible(),
            false,
          );
          const planningSummary = page.locator("#planningConfigHost .compact-read-grid");
          assert.equal(await planningSummary.locator("dt").count(), 3);
          const groupNames = { en: "Family · Friends", de: "Familie · Freunde", fo: "Familja · Vinir" }[language];
          assert.equal(await planningSummary.getByText(groupNames, { exact: true }).isVisible(), true);
          const planning = await openBox(page, "event-planning");
          assert(await planning.isVisible());
          const sizes = await planning.evaluate((n) => ({
            form: n.getBoundingClientRect().width,
            card: n.closest(".settings-card").clientWidth,
            padding: parseFloat(
              getComputedStyle(n.closest(".settings-card")).paddingLeft,
            ),
          }));
          assert(
            Math.abs(sizes.form - (sizes.card - 2 * sizes.padding)) < 2,
            "full-width planning form",
          );
          assert.equal(
            await page.locator("[data-local-edit=event-planning]").isVisible(),
            false,
          );
          const row = planning.locator(".planning-groups > fieldset").first();
          assert(await row.locator(".form-actions button").last().isDisabled());
          if (width === 1160) {
            const tops = await row
              .locator(":scope>label")
              .evaluateAll((ns) =>
                ns.map((n) => n.getBoundingClientRect().top),
              );
            assert(Math.max(...tops) - Math.min(...tops) < 2);
          }
          if (language === "en" && theme === "dark")
            await page.locator("[data-panel=events]").screenshot({
              path: path.join(out, "event-planning-edit-" + width + ".png"),
            });
          await planning.locator("[data-discard]").click();
          assert.equal(await planning.isVisible(), false);
          await page.locator("#settingsToggle").click();
          await page.locator("[data-settings-tab=languages]").click();
          await checkPencils();
          assert.equal(
            await page
              .locator("#languagePreferences button[type=submit]")
              .textContent(),
            saveText,
          );
          for (const button of await page
            .locator("#languageRows button[type=submit]")
            .all())
            assert.equal(await button.textContent(), saveText);
          await page.locator("[data-settings-tab=checklist]").click();
          await checkPencils();
          assert.equal(
            await page.locator("#personalPreferencesForm").isVisible(),
            true,
            "Interface opens directly in its editable form",
          );
          assert.equal(await page.locator('[data-local-edit="personal-preferences"]').isVisible(), false);
          assert.equal(
            await page.locator("#savePersonalPreferences").textContent(),
            saveText,
          );
          await page.locator("#cancelPersonalPreferences").click();
          assert.equal(await page.locator("#personalPreferencesForm").isVisible(), true);
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "phone/tablet fits without horizontal scrolling",
          );
          assert.deepEqual(errors, []);
          assert.equal(
            await page.evaluate(() => fixtures.event_settings[0].is_published),
            false,
          );
          cases++;
          await page.close();
        }
    console.log(
      "PASS approved settings cards: " +
        cases +
        " width/theme/locale cases; header pencils, consistent card spacing, full-width planning, read-only summary, Save labels, bound-group guard, Cancel and unpublished state.",
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

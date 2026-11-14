const {openBox}=require('./helpers/local-edit-ui.cjs');
// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } = createFoodHarness(
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
  ';fixtures.event_settings[0].guest_customization_revision="revision-1";fixtures.event_settings[0].guest_theme_default="dark";fixtures.event_settings[0].guest_theme_toggle=false;window.__customWrites=[];const customizationRpc=client.rpc;client.rpc=async(name,args)=>{if(name==="admin_save_guest_customization"){if(window.__failCustom){window.__failCustom=false;return {error:{message:"Synthetic customization failure"}};}window.__customWrites.push(args);Object.assign(fixtures.event_settings[0],{guest_design:args.p_design,guest_theme_toggle:args.p_show_toggle,guest_theme_default:args.p_default_theme,guest_customization_revision:"revision-"+(window.__customWrites.length+1)});if(args.p_background_mode==="replace")fixtures.event_settings[0].guest_background=args.p_background;if(args.p_background_mode==="remove")fixtures.event_settings[0].guest_background=null;return {data:null};}const r=await customizationRpc(name,args);if(name==="get_public_event_v2")Object.assign(r.data.event,{guest_design:{dark:{box:"#123456",text:"#ffffff",button:"#346f5c"},light:{box:"#ffffff",text:"#123456",button:"#346f5c"},opacity:60,darken:30,position:"top"},guest_background:fixtures.event_settings[0].guest_background,guest_theme_toggle:true,guest_theme_default:"dark"});return r;};';
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } }),
        errors = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem("rsvp-interface-language", "en");
        localStorage.setItem("event-appearance", "light");
      });
      await page.route("**maps.google.com/**", (r) =>
        r.fulfill({ contentType: "text/html", body: "Map fixture" }),
      );
      await page.route("**/supabase.min.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: mock + "\n" + extra + "\n" + stageExtra + custom,
        }),
      );
      const base = "http://127.0.0.1:" + server.address().port;
      await page.goto(base + "/admin/");
      await page.waitForFunction(
        () => document.querySelectorAll("#statsGrid .stat-card").length === 4,
      );
      await page.locator("#settingsToggle").click();
      await page.locator("[data-settings-tab=interface]").click();
    await openBox(page,'guest-customization');
      const host = page.locator("#guestAppearanceHost");
      assert.match(await host.innerText(), /3 × 2 px.*759/s);
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
      await openBox(page,'guest-customization');
      const boxColor = host.locator("input[type=color]").first();
      await boxColor.fill("#334455");
      await boxColor.dispatchEvent("input");
      assert.equal(
        await host
          .locator(".customization-sample")
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
        await host
          .locator(".customization-sample-backdrop")
          .evaluate((n) => n.style.backgroundImage),
        "none",
      );
      await host.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.notEqual(
        await host
          .locator(".customization-sample-backdrop")
          .evaluate((n) => n.style.backgroundImage),
        "none",
      );
      assert.equal(await page.evaluate(() => window.__customWrites.length), 0);
      await openBox(page,"guest-customization");
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
      await host
        .locator("input[type=file]")
        .setInputFiles("tests/fixtures/customization.jpg");
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
      await host
        .getByRole("combobox", {
          name: "Guest default appearance",
          exact: true,
        })
        .selectOption("light");
      await host.getByRole("checkbox").check();
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
        await page.evaluate(() => window.__customWrites[0].p_background_mode),
        "replace",
      );
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].is_published,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(
          () => window.__fixtures.event_settings[0].guest_design.opacity,
        ),
        60,
      );
      await openBox(page,"guest-customization");
      await host
        .getByRole("button", { name: "Reset appearance", exact: true })
        .click();
      await host.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => window.__customWrites.length === 2);
      assert.equal(
        await page.evaluate(() => window.__customWrites[1].p_design),
        null,
      );
      assert.equal(
        await page.evaluate(() => window.__customWrites[1].p_background_mode),
        "keep",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
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
      "PASS customization UI: private photo metadata/upload validation; live colors and opacity; retained failed-save drafts; Save/Cancel/reset; theme isolation; authorized-only guest design and mobile fit.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

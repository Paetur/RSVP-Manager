// Actual UI with synthetic APIs only. No live accounts or event data.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { root, out, server, mock, extra, stageExtra } =
  createFoodHarness("guest-background");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 950 },
    });
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      canvas.getContext("2d").fillRect(0, 0, 2, 2);
      return {
        image: canvas.toDataURL("image/jpeg"),
        crop: {
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          sourceWidth: 2,
          sourceHeight: 2,
        },
      };
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    await page.route("**maps.google.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: "<p>Map fixture</p>" }),
    );
    const addPhoto =
      "\nconst photoRpc=client.rpc;client.rpc=async(name,args)=>{const result=await photoRpc(name,args);if(name==='get_public_event_v2'&&result.data?.event)result.data.event.guest_background=" +
      JSON.stringify(photo) +
      ";return result;};";
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + stageExtra + addPhoto,
      }),
    );
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base + "/");
    await page.locator("#codeCard:not(.hidden)").waitFor();
    assert.equal(await page.locator("#guestPhotoBackdrop").count(), 0);
    await page.goto(base + "/?ABCDEFGH");
    await page.locator("body.guest-photo").waitFor();
    const dimensions = await page
      .locator("#guestPhotoBackdrop")
      .evaluate(async (layer) => {
        const source = layer.style.backgroundImage.slice(5, -2);
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = source;
        });
        return [image.naturalWidth, image.naturalHeight];
      });
    assert.deepEqual(dimensions, [2, 2]);
    const darkPanel = await page
      .locator("#invitationCard")
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    await page.evaluate(() =>
      window.RSVP_THEME.configureGuest({
        showToggle: false,
        defaultTheme: "light",
      }),
    );
    const lightPanel = await page
      .locator("#invitationCard")
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    assert.notEqual(
      lightPanel,
      darkPanel,
      "photo panels support both guest appearances",
    );
    await page.evaluate(() =>
      window.RSVP_THEME.configureGuest({
        showToggle: true,
        defaultTheme: "dark",
      }),
    );
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.equal(
        await page.locator(".rsvp-inline").first().isVisible(),
        true,
      );
      const panelStyle = await page.evaluate(() => {
        const panel = document.getElementById("invitationCard"),
          date = document.getElementById("eventDate");
        return {
          gap:
            panel.getBoundingClientRect().top -
            date.getBoundingClientRect().bottom,
          background: getComputedStyle(panel).backgroundColor,
        };
      });
      assert.ok(
        panelStyle.gap >= 12 && panelStyle.gap <= 24,
        JSON.stringify(panelStyle),
      );
      assert.ok(panelStyle.background.includes("0.82"), panelStyle.background);
      const footerGap = await page.evaluate(() => {
        const boxes = [
          ...document.querySelectorAll(".guest-main>.panel"),
        ].filter((n) => n.getClientRects().length);
        return (
          document.querySelector(".guest-footnote p").getBoundingClientRect()
            .top - boxes.at(-1).getBoundingClientRect().bottom
        );
      });
      assert.ok(footerGap >= 12 && footerGap <= 24, "footer gap " + footerGap);
      assert.ok(
        await page
          .locator("#guestEventName")
          .evaluate((n) => parseFloat(getComputedStyle(n).fontSize) >= 18),
      );
      const alignment = await page.evaluate(() => ({
        name: document.getElementById("guestEventName").getBoundingClientRect()
          .left,
        box: document.getElementById("invitationCard").getBoundingClientRect()
          .left,
      }));
      assert.ok(
        Math.abs(alignment.name - alignment.box) < 2,
        JSON.stringify(alignment),
      );
      assert.equal(await page.locator("#guestPreviewLabel").count(), 0);
      await page.screenshot({
        path: out + "/photo-background-" + width + ".png",
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS photo: synthetic JPEG decoded through declared crop; no background before invitation; responsive phone/desktop cards and no script errors.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

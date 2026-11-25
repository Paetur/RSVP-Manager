import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { createSetupServer } from "../setup-service/server.ts";
const require = createRequire(import.meta.url),
  { fixture } = require("./helpers/setup-management-fixture.cjs");
for (const width of [390, 1160]) {
  const f = await fixture(),
    server = createSetupServer(process.cwd(), { fetcher: f.fetcher });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port,
    browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }),
      errors = [],
      privateValues = [
        f.config.serviceKey,
        f.config.accessToken,
        "Correct setup password 123!",
      ];
    page.setDefaultTimeout(12_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/");
    await page.locator("#automaticWizard:not(.hidden)").waitFor();
    assert.equal(await page.locator('[data-auto-step="2"]').isDisabled(), true);
    for (const [name, value] of Object.entries(f.config))
      await page.locator('#automaticConnect [name="' + name + '"]').fill(value);
    await page.locator("#automaticConnect button[type=submit]").click();
    await page.locator('[data-auto-panel="1"]:not(.hidden)').waitFor();
    for (const name of ["serviceKey", "accessToken", "publicKey"])
      assert.equal(
        await page
          .locator('#automaticConnect [name="' + name + '"]')
          .inputValue(),
        "",
      );
    await page.locator('[data-run="database"]').click();
    await page.locator('[data-auto-panel="2"]:not(.hidden)').waitFor();
    await page
      .locator('#automaticAdministrator [name="email"]')
      .fill("owner@example.invalid");
    await page
      .locator('#automaticAdministrator [name="password"]')
      .fill(privateValues[2]);
    await page.locator('#automaticAdministrator [name="confirmPassword"]').fill(privateValues[2]);
    await page.locator("#automaticAdministrator button[type=submit]").click();
    await page.locator('[data-auto-panel="3"]:not(.hidden)').waitFor();
    assert.equal(
      await page
        .locator('#automaticAdministrator [name="password"]')
        .inputValue(),
      "",
    );
    await page.reload();
    await page.locator('[data-auto-panel="3"]:not(.hidden)').waitFor();
    await page.locator("#automaticAddSecret").click();
    await page.locator('[name="secretName"]').fill("RSVP_OPTIONAL_TEST");
    await page
      .locator('[name="secretValue"]')
      .fill("temporary optional secret");
    await page.locator('[data-run="secrets"]').click();
    await page.locator('[data-auto-panel="4"]:not(.hidden)').waitFor();
    assert.equal(await page.locator('[name="secretValue"]').inputValue(), "");
    f.state.fail = { path: "/functions/deploy", method: "POST", status: 500 };
    await page.locator('[data-run="functions"]').click();
    await page.locator("#automaticStatus.error").waitFor();
    assert(
      !(await page.locator("#automaticStatus").textContent()).includes(
        f.config.serviceKey,
      ),
    );
    assert.equal(await page.locator('[data-auto-panel="4"]').isVisible(), true);
    await page.locator('[data-run="functions"]').click();
    await page.locator('[data-auto-panel="5"]:not(.hidden)').waitFor();
    await page.locator('[data-run="configuration"]').click();
    await page.locator('[data-auto-panel="6"]:not(.hidden)').waitFor();
    await page.locator('[data-run="verification"]').click();
    await page.locator("#automaticComplete:not(.hidden)").waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#automaticDownload").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let contents = "";
    for await (const chunk of stream) contents += chunk.toString();
    assert(contents.includes(f.config.publicKey));
    for (const value of privateValues) assert(!contents.includes(value));
    const link = new URL(
      await page.locator("#automaticLogin").getAttribute("href"),
    );
    assert.equal(link.pathname, "/wedding/setup.html");
    const connection = JSON.parse(
      decodeURIComponent(link.hash.slice("#connection=".length)),
    );
    assert.deepEqual(connection, {
      supabaseUrl: f.config.projectUrl,
      supabaseKey: f.config.publicKey,
    });
    const storage = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    for (const value of [...privateValues, "temporary optional secret"])
      assert(!storage.includes(value));
    assert.equal(
      (await f.db.query("SELECT is_published FROM public.event_settings"))
        .rows[0].is_published,
      false,
    );
    for (const language of ["de", "fo"]) {
      await page.locator("#automaticLanguage").selectOption(language);
      await page.waitForFunction(
        (code) => document.documentElement.lang === code,
        language,
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#automaticComplete h2").textContent !==
          "Setup complete",
      );
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
}
console.log(
  "PASS automated setup browser: seven-step install, Auth login, credential clearing/no storage, refresh recovery, deployment retry, public-only configuration/redirect, EN/DE/FO and phone/desktop fit.",
);

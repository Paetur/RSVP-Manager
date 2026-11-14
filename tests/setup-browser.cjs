// Real wizard against static files and synthetic SDK/gateway adapters. No live backend.
const { chromium } = require("playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const sdk = `window.__setupCalls=[];window.supabase={createClient:()=>({rpc:async(name)=>{window.__setupCalls.push(name);if(name==='get_public_event'&&window.__schemaFailure)return {error:{message:'Synthetic schema unavailable'}};return {data:name==='is_admin'?true:null,error:null}},functions:{invoke:async()=>({data:null,error:null})},auth:{signInWithPassword:async()=>({error:null})}})};`;
const server = http.createServer((req, res) => {
  let name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (name.startsWith("/event/")) name = name.slice(6);
  if (name === "/version.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        version: fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(),
      }),
    );
    return;
  }
  const file = path.resolve(root, "." + name);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    name.endsWith(".html")
      ? "text/html"
      : name.endsWith(".js")
        ? "application/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch();
    const origin = "http://127.0.0.1:" + server.address().port;
    for (const prefix of ["", "/event"])
      for (const width of [390, 1160])
        for (const language of ["en", "de", "fo"]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
            acceptDownloads: true,
          });
          const errors = [];
          page.setDefaultTimeout(7000);
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript(
            (language) =>
              localStorage.setItem("rsvp-interface-language", language),
            language,
          );
          await page.addInitScript(sdk);
          await page.route("**/supabase.min.js", (r) =>
            r.fulfill({ contentType: "application/javascript", body: sdk }),
          );
          await page.route("**/functions/v1/**", (r) =>
            r.fulfill({ contentType: "application/json", body: "null" }),
          );
          await page.goto(origin + prefix + "/setup.html");
          await page.waitForFunction(() =>
            document
              .getElementById("setupSiteSecrets")
              .textContent.includes("RSVP_SITE_URL"),
          );
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            false,
          );
          await page.locator("[name=dbMode][value=new]").check();
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            true,
          );
          assert.equal(
            await page.locator("[name=databaseLocation]:checked").count(),
            0,
          );
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator('[data-step-panel="1"]').isVisible(),
            true,
          );
          await page.locator('[data-step="2"]').click();
          assert.equal(
            await page.locator('[data-step-panel="1"]').isVisible(),
            true,
          );
          assert.equal(
            await page.locator("[value=local]+strong").textContent(),
            { en: "Local", de: "Lokal", fo: "Lokalt" }[language],
          );
          await page.locator("[name=databaseLocation][value=local]").check();
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator("#newLocalInstructions").isVisible(),
            true,
          );
          assert.equal(
            await page.locator("#newCloudInstructions").isVisible(),
            false,
          );
          assert.equal(
            await page.locator("#setupDeploymentGuide").getAttribute("href"),
            "docs/LocalSetup.html",
          );
          assert.equal(
            await page.locator("#localStudioLink").getAttribute("href"),
            "http://127.0.0.1:54323/",
          );
          assert.equal(
            await page.locator("#setupUrl").getAttribute("placeholder"),
            "http://127.0.0.1:54321",
          );
          const installer = await page.request.get(
            origin + prefix + "/supabase/install.sql",
          );
          assert.equal(installer.status(), 200);
          assert.equal(
            await installer.text(),
            fs.readFileSync(path.join(root, "supabase/install.sql"), "utf8"),
          );
          if (prefix === "" && width === 390 && language === "en") {
            const pending = page.waitForEvent("download");
            await page.locator('[download="rsvp-install.sql"]').click();
            const download = await pending;
            assert.equal(download.suggestedFilename(), "rsvp-install.sql");
            assert.equal(
              fs.readFileSync(await download.path(), "utf8"),
              fs.readFileSync(path.join(root, "supabase/install.sql"), "utf8"),
            );
          }
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            "No phone overflow " +
              prefix +
              "/" +
              width +
              "/" +
              language +
              " " +
              JSON.stringify(
                await page.evaluate(() =>
                  [...document.querySelectorAll("main *,header *,footer *")]
                    .filter((el) => {
                      const r = el.getBoundingClientRect();
                      return r.width && r.right > innerWidth + 1;
                    })
                    .map((el) => ({
                      tag: el.tagName,
                      id: el.id,
                      class: el.className,
                      width: el.getBoundingClientRect().width,
                      right: el.getBoundingClientRect().right,
                    })),
                ),
              ),
          );
          for (const target of ["local", "cloud"]) {
            if (target === "cloud") {
              await page.locator('[data-step="1"]').click();
              await page
                .locator("[name=databaseLocation][value=cloud]")
                .check();
              await page.locator('[data-step="4"]').click();
              assert.equal(
                await page.locator('[data-step-panel="1"]').isVisible(),
                true,
                "Changing target invalidates verified access",
              );
              await page.locator('[data-step-panel="1"] [data-next]').click();
              assert.equal(
                await page.locator("#newCloudInstructions").isVisible(),
                true,
              );
              assert.equal(
                await page.locator("#newLocalInstructions").isVisible(),
                false,
              );
              assert.equal(
                await page
                  .locator("#setupDeploymentGuide")
                  .getAttribute("href"),
                "docs/StudioSetup.html",
              );
            }
            if (target === "cloud") {
              const states = {
                en: ["ON", "OFF", "ON"],
                de: ["EIN", "AUS", "EIN"],
                fo: ["TENDRAÐ", "SLØKT", "TENDRAÐ"],
              }[language];
              assert.deepEqual(
                (
                  await page
                    .locator("#cloudProjectSettings strong")
                    .allTextContents()
                ).map((text) => text.trim()),
                [
                  "Enable Data API: " + states[0],
                  "Automatically expose new tables: " + states[1],
                  "Enable automatic RLS: " + states[2],
                ],
              );
            }
            assert.equal(
              await page.locator("#setupServerPrerequisites").isVisible(),
              true,
            );
            for (const id of [
              "setupSiteSecrets",
              "setupAuthURLs",
              "setupDeploymentGuide",
            ]) {
              assert.equal(
                await page.locator("#" + id).isVisible(),
                true,
                id + " must be available before Test connection",
              );
              assert.equal(
                await page
                  .locator("#" + id)
                  .evaluate(
                    (el) => el.closest("[data-step-panel]").dataset.stepPanel,
                  ),
                "2",
              );
            }
            assert.equal(
              await page.locator("[data-setup-local]").isVisible(),
              target === "local",
            );
            assert.equal(
              await page.locator("[data-setup-cloud]").isVisible(),
              target === "cloud",
            );
            assert.ok(
              (await page.locator("#setupSiteSecrets").textContent()).includes(
                origin + prefix + "/",
              ),
            );
            assert.ok(
              (await page.locator("#setupAuthURLs").textContent()).includes(
                origin + prefix + "/admin/?admin-invitation=1",
              ),
            );
            assert.ok(
              await page
                .locator("#setupServerPrerequisites")
                .evaluate(
                  (el) =>
                    !!(
                      el.compareDocumentPosition(
                        document.getElementById("connectForm"),
                      ) & Node.DOCUMENT_POSITION_FOLLOWING
                    ),
                ),
            );
            assert.ok(
              (await page.locator("#setupHostingHelp").textContent()).includes(
                "GitHub Pages",
              ),
            );
            await page.locator("#setupUrl").fill("https://synthetic.invalid");
            await page.locator("#setupKey").fill("sb_publishable_synthetic");
            await page.locator("#connectForm button[type=submit]").click();
            await page.locator('[data-step-panel="3"]:not(.hidden)').waitFor();
            await page
              .locator("#setupAdminEmail")
              .fill("synthetic@example.invalid");
            await page
              .locator("#setupAdminPassword")
              .fill("synthetic-test-password");
            await page.locator("#setupLoginForm button[type=submit]").click();
            await page.locator('[data-step-panel="4"]:not(.hidden)').waitFor();
            assert.equal(
              await page
                .locator('[data-step-panel="4"] #setupServerPrerequisites')
                .count(),
              0,
            );
            assert.equal(
              await page.locator("#setupPagesInstructions li").count(),
              4,
            );
            const publishHelp = await page
              .locator('[data-step-panel="4"]')
              .textContent();
            for (const variable of [
              "RSVP_SUPABASE_URL",
              "RSVP_PUBLISHABLE_KEY",
              "js/config.js",
            ])
              assert.ok(publishHelp.includes(variable));
            assert.equal(
              await page.locator("#setupSiteSecrets").isVisible(),
              false,
            );
            if (
              target === "cloud" &&
              prefix === "" &&
              width === 390 &&
              language === "en"
            ) {
              const pending = page.waitForEvent("download");
              await page.locator("#downloadConfig").click();
              const download = await pending;
              assert.equal(download.suggestedFilename(), "config.js");
              const config = fs.readFileSync(await download.path(), "utf8");
              assert.ok(config.includes("https://synthetic.invalid"));
              assert.ok(config.includes("sb_publishable_synthetic"));
              assert.ok(
                !config.includes("RSVP_SITE_ORIGIN"),
                "Server settings stay separate from browser configuration",
              );
            }
          }
          await page.locator('[data-step="1"]').click();
          await page.locator("[name=dbMode][value=existing]").check();
          assert.equal(
            await page.locator("#databaseLocationChoices").isVisible(),
            false,
          );
          await page.locator('[data-step-panel="1"] [data-next]').click();
          assert.equal(
            await page.locator("#newDatabaseInstructions").isVisible(),
            false,
          );
          await page.evaluate(() => (window.__schemaFailure = true));
          await page.locator("#connectForm button[type=submit]").click();
          await page.waitForFunction(() =>
            document
              .getElementById("setupStatus")
              .textContent.includes("Synthetic schema unavailable"),
          );
          await page.locator('[data-step="3"]').click();
          assert.equal(
            await page.locator('[data-step-panel="2"]').isVisible(),
            true,
          );
          assert.ok(
            (await page.evaluate(() => window.__setupCalls)).every((name) =>
              ["get_public_event", "is_admin", "get_setup_status"].includes(name),
            ),
            "Only public setup probes/login checks are called",
          );
          assert.deepEqual(errors, []);
          await page.close();
        }
    console.log(
      "PASS setup: explicit Local/Cloud choice, guarded steps, server prerequisites before connection, Pages publishing after verification, correct guides/Studio URL, actual SQL/config download, connection/verification invalidation and errors; root/subdirectory EN/DE/FO at 390/1160px.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

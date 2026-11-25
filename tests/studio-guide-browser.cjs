// Browser acceptance against a synthetic local release server. No live APIs.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { chromium } = require("playwright");
(async () => {
  const root = path.resolve(__dirname, "..");
  let mode = "ok";
  const requested = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url);
    let name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (name.startsWith("/event/")) name = name.slice(6);
    if (name === "/version.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version:
            mode === "version"
              ? "mismatch"
              : fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(),
        }),
      );
      return;
    }
    if (mode === "corrupt" && name.endsWith("/guest-gateway.ts")) {
      res.end("corrupt");
      return;
    }
    const target = path.resolve(root, "." + name);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      name.endsWith(".html")
        ? "text/html"
        : name.endsWith(".js")
          ? "application/javascript"
          : name.endsWith(".json")
            ? "application/json"
            : "text/plain",
    );
    res.end(fs.readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const base = "http://127.0.0.1:" + server.address().port;
    for (const prefix of ["", "/event"]) {
      mode = "ok";
      await page.goto(base + prefix + "/docs/StudioSetup.html");
      await page.waitForFunction(() =>
        document.getElementById("codeStatus").textContent.startsWith("Both "),
      );
      assert.equal(
        await page.locator("[data-site-origin]").textContent(),
        base,
      );
      for (const value of await page
        .locator("[data-site-url]")
        .allTextContents())
        assert.equal(value, base + prefix + "/");
      assert.equal(
        await page.locator("[data-admin-redirect]").textContent(),
        base + prefix + "/admin/?admin-invitation=1",
      );
      assert.equal(
        await page.locator("#guestCode").inputValue(),
        fs.readFileSync(
          path.join(root, "supabase/studio/guest-gateway.ts"),
          "utf8",
        ),
      );
      assert.equal(await page.locator("#copyGuest").isEnabled(), true);
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        }),
      );
      await page
        .locator("details")
        .first()
        .evaluate((el) => (el.open = true));
      await page.locator("#copyGuest").click();
      assert.match(
        await page.locator("#codeStatus").textContent(),
        /Select and copy/,
      );
      assert.equal(
        await page
          .locator("#guestCode")
          .evaluate((el) => el.selectionEnd - el.selectionStart),
        (await page.locator("#guestCode").inputValue()).length,
      );
    }
    for (const [value, message] of [
      ["version", "version mismatch"],
      ["corrupt", "checksum mismatch"],
    ]) {
      mode = value;
      await page.goto(base + "/event/docs/StudioSetup.html");
      await page.waitForFunction(() =>
        document.getElementById("codeStatus").textContent.startsWith("Unable"),
      );
      assert.ok(
        (await page.locator("#codeStatus").textContent()).includes(message),
      );
      assert.equal(await page.locator("#copyGuest").isEnabled(), false);
      assert.equal(await page.locator("#copyAdmin").isEnabled(), false);
    }
    assert.ok(
      requested.every(
        (url) => !url.includes("/functions/v1/") && !url.includes("/rest/v1/"),
      ),
    );
    console.log(
      "PASS Studio guide: root/subdirectory URLs, complete release-matching code, clipboard fallback, version and corruption rejection.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Reuse the public publisher and synthetic fixture without serving private source.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"),
  { execFileSync } = require("node:child_process");
const { createFoodHarness } = require("./food-browser-harness.cjs");

function createPublicFoodHarness(artifactName) {
  const source = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-browser-site-")),
    site = path.join(temporary, "site"), config = path.join(temporary, "config.js");
  fs.writeFileSync(config, 'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};\n');
  try {
    execFileSync("python3", [path.join(source, "deployment/publish-web.py"), source, config, site], { stdio: "pipe" });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  const harness = createFoodHarness(artifactName, {
    root: site, out: path.join(temporary, "artifacts", artifactName),
  });
  fs.mkdirSync(harness.out, { recursive: true });
  return { ...harness, cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }) };
}

async function routeSyntheticSdk(page, script) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/supabase.min.js"))
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/functions/v1/"))
      return route.abort();
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
}

module.exports = { createPublicFoodHarness, routeSyntheticSdk };

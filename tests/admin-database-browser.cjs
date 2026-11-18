// Actual wipe controller and catalogs; every destructive operation is synthetic.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), actor = "11111111-1111-4111-8111-111111111111";
const aliases = JSON.parse(fs.readFileSync(path.join(root, "locales/aliases.json"), "utf8"));
const catalogs = Object.fromEntries(["en", "de", "fo"].map(language => [language,
  Object.fromEntries(["interface", "food", "types"].map(category => [category,
    JSON.parse(fs.readFileSync(path.join(root, "locales", language, category + ".json"), "utf8"))]))]));
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1160, height: 900 } }), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><main class="site-width"><section id="databaseWipeHost" class="panel"></section></main>' });
    });
    await page.goto("https://database.synthetic.invalid/");
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, "css/app.css"), "utf8") });
    await page.evaluate(({ aliases, catalogs, actor }) => {
      const h = window.h = { actor, full: true, language: "en", store: { settings: { is_published: false } },
        calls: [], downloads: [], missing: [], notices: [], reloads: 0, signouts: 0, confirmResult: true,
        sequence: 0, nowDelta: 0, realNow: Date.now };
      Date.now = () => h.realNow() + h.nowDelta;
      h.T = (source, parameters = {}) => {
        const key = aliases[source];
        if (!key) { h.missing.push(source); return source; }
        const [category, group, name] = key.split(".");
        let value = catalogs[h.language][category][group][name] || catalogs.en[category][group][name];
        for (const [key, replacement] of Object.entries(parameters)) value = value.replaceAll("{" + key + "}", String(replacement));
        return value;
      };
      h.R = { byId: id => document.getElementById(id), dom(tag, attributes = {}, text) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === "boolean") node[key] = value;
          else node.setAttribute(key, value);
        }
        if (text !== undefined) node.textContent = String(text);
        return node;
      } };
      h.review = () => ({ can_wipe: true, keep_current_admin: document.getElementById("databaseKeepAdmin").checked,
        event_name: "Synthetic celebration", destination_state: "synthetic_destination_state", current_counts: {
          "public.households": 6, "public.guests": 6, "public.invitation_send_queue": 12,
          "public.invitation_deliveries": 0, "public.rsvp_submissions": 2, "public.food_claims": 3, "public.admins": 2,
        } });
      h.rpc = async (name, args) => {
        h.calls.push({ name, args: structuredClone(args) });
        if (name === "admin_preview_wipe_all") {
          const result = { ...h.review(), keep_current_admin: args.p_keep_current_admin };
          if (h.holdPreview) await new Promise(resolve => { h.resolvePreview = resolve; });
          if (h.failPreview) throw Error("Synthetic preview failure");
          return result;
        }
        if (name === "admin_prepare_wipe_all") {
          h.sequence++;
          const result = { ...h.review(), keep_current_admin: args.p_keep_current_admin,
            token: "22222222-2222-4222-8222-" + String(h.sequence).padStart(12, "0"),
            expires_at: new Date(Date.now() + (h.expiredPreparation ? -1000 : 600000)).toISOString(),
            safety_backup: { format: "rsvp-application-backup", marker: "SYNTHETIC_PRIVATE_BACKUP" } };
          h.latestToken = result.token;
          if (h.holdPrepare) await new Promise(resolve => { h.resolvePrepare = resolve; });
          return result;
        }
        if (name === "admin_wipe_all") {
          if (h.failWipe) throw Error("Synthetic lost acknowledgment");
          return { application_data_cleared: true, current_admin_retained: args.p_keep_current_admin,
            sign_out_required: !args.p_keep_current_admin, schema_ready: true };
        }
        throw Error("Unexpected operation");
      };
    }, { aliases, catalogs, actor });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, "js/admin-database.js"), "utf8") });
    await page.evaluate(() => {
      h.controller = window.RSVP_ADMIN_DATABASE.create({ R: h.R, T: h.T, getStore: () => h.store,
        can: section => section === "full" && h.full, getActor: () => h.actor, rpc: h.rpc,
        reload: async () => { h.reloads++; return !h.failReload; },
        signOut: async () => { h.signouts++; if (h.failSignout) throw Error("Synthetic sign-out failure"); },
        confirm: async trigger => {
          if (!trigger.isConnected || trigger.closest("#databaseWipeHost") !== document.getElementById("databaseWipeHost"))
            throw Error("The confirmation trigger must be connected to the wipe card");
          if (h.switchOnConfirm) h.actor = "99999999-9999-4999-8999-999999999999";
          if (h.publishOnConfirm) h.store.settings.is_published = true;
          return h.confirmResult;
        },
        downloadSafetyBackup: async (backup, current) => {
          if (h.holdDownload) await new Promise(resolve => { h.resolveDownload = resolve; });
          if (h.failDownload || !current()) throw Error("Synthetic failed/cancelled download");
          h.downloads.push(structuredClone(backup));
        }, adminTime: value => new Date(value).toISOString(), onMessage: text => h.notices.push(text),
      });
      h.reset = () => {
        Object.assign(h, { actor: "11111111-1111-4111-8111-111111111111", full: true, language: "en", calls: [],
          downloads: [], missing: [], notices: [], reloads: 0, signouts: 0, confirmResult: true, nowDelta: 0,
          holdPreview: false, holdPrepare: false, holdDownload: false, failPreview: false, failDownload: false,
          failWipe: false, failReload: false, failSignout: false, expiredPreparation: false,
          switchOnConfirm: false, publishOnConfirm: false });
        h.store.settings.is_published = false;
        h.controller.clear(); h.controller.render();
      };
      h.reset();
    });
    const calls = name => page.evaluate(name => h.calls.filter(call => call.name === name), name);
    const review = async () => {
      await page.locator("#databasePreviewWipe").click();
      await page.locator("#databaseWipePreview").waitFor();
      await page.waitForFunction(() => !document.getElementById("databasePrepareWipe").disabled);
    };
    const prepare = async () => {
      await review(); await page.locator("#databasePrepareWipe").click();
      await page.locator("#databaseWipeAll").waitFor();
      await page.waitForFunction(() => document.getElementById("databaseWipeHost").getAttribute("aria-busy") === "false");
    };
    assert.equal(await page.locator("#databaseKeepAdmin").isChecked(), true);
    assert.equal((await calls("admin_preview_wipe_all")).length, 0);
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    await page.evaluate(() => { h.store.settings.is_published = true; h.controller.render(); });
    assert.equal(await page.locator("#databasePreviewWipe").isDisabled(), true);
    await page.locator("#databasePreviewWipe").evaluate(node => node.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.equal((await calls("admin_preview_wipe_all")).length, 0);
    await page.evaluate(() => { h.reset(); h.full = false; h.controller.render(); });
    assert.equal(await page.locator("#databaseWipeHost").isHidden(), true);
    await page.evaluate(() => h.reset());

    await prepare();
    assert.deepEqual((await calls("admin_prepare_wipe_all"))[0].args, { p_keep_current_admin: true, p_expected_state: "synthetic_destination_state" });
    assert.equal(await page.evaluate(() => h.downloads.length), 1);
    const html = await page.locator("#databaseWipeHost").innerHTML();
    assert.equal(html.includes(await page.evaluate(() => h.latestToken)), false, "receipt never enters DOM");
    assert.equal(html.includes("SYNTHETIC_PRIVATE_BACKUP"), false, "backup payload never enters DOM");
    assert.equal((await page.locator("#databaseWipePreview").innerText()).includes("public."), false, "review uses product labels rather than table names");
    assert.equal(await page.locator("#databaseWipeConfirmation").count(), 0, "wipe requires no typed confirmation");
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true);
    await page.evaluate(() => { h.confirmResult = false; });
    await page.locator("#databaseWipeAll").click();
    await page.waitForFunction(() => !document.getElementById("databaseWipeAll").disabled);
    assert.equal((await calls("admin_wipe_all")).length, 0, "cancel does not wipe");
    assert.equal(await page.locator("#databaseWipeAll").isEnabled(), true, "No retains the safety receipt");
    await page.evaluate(() => { h.confirmResult = true; });
    await page.locator("#databaseWipeAll").click();
    await page.waitForFunction(() => h.reloads === 1);
    assert.deepEqual((await calls("admin_wipe_all"))[0].args, {
      p_keep_current_admin: true, p_confirmation: "WIPE", p_safety_token: await page.evaluate(() => h.latestToken),
    });
    assert.equal(await page.evaluate(() => h.signouts), 0);
    assert.equal(await page.locator("#databaseWipeAll").count(), 0, "successful operation cannot be automatically repeated");

    await page.evaluate(() => h.reset()); await prepare();
    await page.locator("#databaseKeepAdmin").uncheck();
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    assert.equal(await page.locator("#databaseWipePreview").count(), 0, "retention change invalidates reviewed state and token");
    await prepare();
    await page.locator("#databaseWipeAll").click(); await page.waitForFunction(() => h.signouts === 1);
    assert.equal((await calls("admin_wipe_all"))[0].args.p_keep_current_admin, false);
    assert.equal(await page.evaluate(() => h.reloads), 0);

    await page.evaluate(() => h.reset()); await prepare();
    await page.evaluate(() => { h.nowDelta = 3600000; h.controller.render(); });
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    assert.match(await page.locator("#databaseWipeStatus").innerText(), /expired/i);
    await page.evaluate(() => h.reset()); await review();
    await page.evaluate(() => { h.failDownload = true; });
    await page.locator("#databasePrepareWipe").click();
    await page.waitForFunction(() => document.getElementById("databaseWipeStatus").textContent.includes("could not be downloaded"));
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    assert.equal(await page.evaluate(() => h.downloads.length), 0);

    await page.evaluate(() => h.reset()); await prepare();

    await page.evaluate(() => { h.failWipe = true; }); await page.locator("#databaseWipeAll").click();
    await page.waitForFunction(() => document.getElementById("databaseWipeStatus").textContent.includes("could not be confirmed"));
    assert.equal((await calls("admin_wipe_all")).length, 1);
    assert.equal(await page.locator("#databaseWipeAll").count(), 0, "uncertain result discards token rather than retrying");
    assert.equal(await page.evaluate(() => h.reloads + h.signouts), 0);

    for (const change of ["switchOnConfirm", "publishOnConfirm"]) {
      await page.evaluate(() => h.reset()); await prepare();
      await page.evaluate(change => { h[change] = true; }, change); await page.locator("#databaseWipeAll").click();
      await page.waitForFunction(() => document.getElementById("databaseWipeHost").getAttribute("aria-busy") === "false");
      assert.equal((await calls("admin_wipe_all")).length, 0, "actor/publication is rechecked after confirmation");
    }
    await page.evaluate(() => h.reset()); await review();
    await page.evaluate(() => { h.holdPrepare = true; }); await page.locator("#databasePrepareWipe").click();
    await page.waitForFunction(() => typeof h.resolvePrepare === "function");
    await page.evaluate(() => { h.controller.clear(); h.controller.render(); h.resolvePrepare(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);
    assert.equal(await page.evaluate(() => h.downloads.length), 0, "same-user clear invalidates a late preparation");

    await page.evaluate(() => h.reset()); await review();
    await page.evaluate(() => { h.holdDownload = true; }); await page.locator("#databasePrepareWipe").click();
    await page.waitForFunction(() => typeof h.resolveDownload === "function");
    await page.evaluate(() => { h.actor = "99999999-9999-4999-8999-999999999999"; h.controller.render(); h.resolveDownload(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => h.downloads.length), 0, "backup cannot finish downloading into another account");
    assert.equal(await page.locator("#databaseWipeAll").count(), 0);

    for (const language of ["en", "de", "fo"]) for (const width of [390, 1160]) {
      await page.evaluate(language => { h.reset(); h.language = language; h.controller.render(); }, language);
      await page.setViewportSize({ width, height: 900 }); await prepare();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await page.evaluate(() => h.missing), []);
    }
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal((await page.context().cookies()).length, 0);
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 1, "controller makes no network calls outside injected RPCs");
    console.log("PASS Database wipe UI: Full/unpublished gates, safety backup, double confirmation without typing, retain/sign-out, stale/expired/uncertain recovery, account isolation and EN/DE/FO phone/wide.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

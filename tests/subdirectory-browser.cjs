// Mounted production pages: root-relative asset leaks receive 404, APIs use fixtures.
const { chromium } = require('playwright');
const http = require('node:http'), assert = require('node:assert/strict');
const { createFoodHarness } = require('./helpers/food-browser-harness.cjs');
const harness = createFoodHarness('subdirectory');
const setupFixture = `
const originalSetupRpc = client.rpc;
client.rpc = async (name, args) =>
  name === 'get_setup_status'
    ? { data: { initialized: false, setup_locked: false }, error: null }
    : originalSetupRpc(name, args);
`;
const outside = [];
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/marriage/')) {
    if (req.url !== '/favicon.ico') outside.push(req.url);
    res.writeHead(404); return res.end();
  }
  req.url = req.url.slice('/marriage'.length);
  harness.server.emit('request', req, res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const origin = 'http://127.0.0.1:' + server.address().port, base = origin + '/marriage/';
    for (const width of [390, 1160]) for (const language of ['en', 'de', 'fo']) {
      const page = await browser.newPage({viewport:{width,height:1000}}), errors=[];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(language => localStorage.setItem('rsvp-interface-language', language), language);
      const householdLanguage = `window.__invite.household.language=${JSON.stringify(language)};`;
      await page.route('**/supabase.min.js', r => r.fulfill({contentType:'text/javascript',body:[harness.mock,harness.extra,harness.stageExtra,"window.__invite.household.rsvp_state='locked';",setupFixture,householdLanguage].join('\n')}));
      await page.route('**maps.google.com/**', r => r.fulfill({contentType:'text/html',body:'Synthetic map'}));
      await page.goto(base + '?ABCDEFGH');
      await page.locator('#foodCard:not(.hidden)').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      assert.equal(await page.evaluate(() => RSVP.siteRoot.href), base);
      assert.equal(await page.evaluate(() => RSVP.invitationURL('ABCDEFGH')), base + '?=ABCDEFGH');
      assert.ok((await page.evaluate(() => RSVP.guestPreviewURL('sample', true))).startsWith(base + 'admin/'));
      await page.locator('.food-interest-choices button').first().click();
      await page.locator('#confirmFoodInterest').click();
      await page.waitForFunction(() => window.__interestWrites === 1);
      assert.equal(await page.locator('#foodList').isHidden(), true);
      await page.goto(base + 'admin/');
      await page.waitForFunction(() => window.RSVP_ADMIN?.state?.settings || document.querySelector('#adminApp:not(.hidden)'));
      assert.equal(await page.evaluate(() => RSVP.siteRoot.href), base);
      await page.goto(base + 'setup.html');
      await page.waitForFunction(() => document.querySelector('#setupSiteSecrets')?.textContent.includes('RSVP_SITE_URL'));
      assert.ok((await page.locator('#setupSiteSecrets').textContent()).includes(base));
      assert.ok((await page.locator('#setupAuthURLs').textContent()).includes(base + 'admin/?admin-invitation=1'));
      assert.equal((await page.request.get(base + 'supabase/install.sql')).status(), 200);
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.deepEqual(outside, []);
    console.log('PASS: /marriage/ guest interest, admin, setup, links and assets in EN/DE/FO at 390/1160px');
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => {console.error(e);process.exitCode=1;server.close();});

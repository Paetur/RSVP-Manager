// Public UI with synthetic records/account only; no real API calls or data writes.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { openBox } = require("./helpers/local-edit-ui.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("languages-reading");
const fixture = `
fixtures.event_locations=[{id:'venue-a',name:'Synthetic first venue',welcome_en:'Venue welcome EN\\nSecond venue line',notes:'Synthetic entrance note'},{id:'venue-b',name:'Synthetic second venue'}];
fixtures.event_sessions[0].description='Session description EN\\nSecond session line';
fixtures.event_settings[0].food_introduction={en:'Guest explanation EN',de:'Guest explanation DE',fo:'Guest explanation FO'};
for(const language of ['en','de','fo']){
 fixtures.event_content.push({content_key:'welcome',language_code:language,content_value:'Welcome '+language.toUpperCase()+'\\nLiteral <b>text</b>'});
 if(language!=='en'){
  fixtures.event_content.push({content_key:'venue:venue-a:welcome',language_code:language,content_value:'Venue welcome '+language.toUpperCase()});
  fixtures.event_content.push({content_key:'session:'+s1+':description',language_code:language,content_value:'Session description '+language.toUpperCase()});
 }
}
const readingRpc=client.rpc;client.rpc=async(name,args)=>{
 if(name==='admin_save_translations'){
  if(window.__failReadingSave){window.__failReadingSave=false;return {error:{message:'Synthetic reading save failure'}};}
  for(const change of args.p_changes){let row=fixtures.event_content.find(r=>r.content_key===change.key&&r.language_code===change.language);if(!row){row={content_key:change.key,language_code:change.language};fixtures.event_content.push(row);}row.content_value=change.value;}
  window.__readingSaves=(window.__readingSaves||0)+1;return {data:null};
 }
 const result=await readingRpc(name,args);
 if(name==='admin_load_data')result.data.guestFoodReplies=['en','de','fo'].flatMap(language=>[
  {template_key:'food-interest-reply',language_code:language,body:'Guest reply '+language.toUpperCase()+' {rsvp_deadline:+5}'},
  {template_key:'food-interest-reply-no-deadline',language_code:language,body:'Guest fallback '+language.toUpperCase()}
 ]);
 return result;
};
`;
function card(page, key) { return page.locator('[data-translation-record="' + key + '"]'); }
async function readings(page, key, expected) {
  const current = card(page, key), summary = current.locator('.local-editor-summary');
  await summary.locator('.translation-language-reading').first().waitFor();
  assert.equal(await current.evaluate(n => n.open), true);
  assert.equal(await summary.locator('.translation-language-reading').count(), 3);
  assert.equal(await summary.locator('input,textarea,select,button').count(), 0, 'reading has no editing or placeholder controls');
  assert.equal(await summary.locator('.translation-reading-field small').filter({ hasText: '{…}' }).count(), 0);
  for (const text of expected) assert.equal(await summary.getByText(text, { exact: true }).isVisible(), true, text);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), cases = [];
  try {
    for (const language of ['en', 'de', 'fo']) for (const width of [390, 1160]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('rsvp-interface-language', language);
        localStorage.setItem('event-appearance', theme);
      }, { language, theme });
      await routeSyntheticSdk(page, mock + '\n' + extra + '\n' + fixture);
      await page.goto('http://127.0.0.1:' + server.address().port + '/admin/');
      await page.waitForFunction(() => document.querySelectorAll('#statsGrid .stat-card').length === 4);
      const cancelLabel = await page.evaluate(() => window.RSVP_I18N.t('Cancel'));
      await page.locator('#contentLanguagesToggle').click();
      const tab = name => page.locator('#contentTranslationTabs [data-translation-tab="' + name + '"]');
      await readings(page, 'welcome', ['en', 'de', 'fo'].map(code => 'Welcome ' + code.toUpperCase() + '\nLiteral <b>text</b>'));
      assert.equal(await card(page, 'welcome').locator('.local-editor-summary b').count(), 0, 'stored markup remains literal text');
      assert.equal(await card(page, 'welcome').locator('.translation-reading-field p').first().evaluate(n => getComputedStyle(n).whiteSpace), 'pre-wrap');
      await tab('venue').click();
      await readings(page, 'venue:venue-a', ['Venue welcome EN\nSecond venue line', 'Venue welcome DE', 'Venue welcome FO', 'Synthetic entrance note']);
      await tab('session').click();
      await readings(page, 'session:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ['Session description EN\nSecond session line', 'Session description DE', 'Session description FO']);
      await tab('guests').click();
      await readings(page, 'food-explanation', ['Guest explanation EN', 'Guest explanation DE', 'Guest explanation FO']);
      await readings(page, 'food-interest-reply', ['Guest reply EN {rsvp_deadline:+5}', 'Guest reply DE {rsvp_deadline:+5}', 'Guest reply FO {rsvp_deadline:+5}', 'Guest fallback EN']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'reading layout fits viewport');

      // Exercise Cancel, failed Save and independent drafts once at each width.
      if (language === 'en' && theme === 'light') {
        await tab('welcome').click();
        let form = await openBox(page, 'translations:welcome');
        const english = () => form.locator('[data-language-code="en"] textarea.translation-field');
        await english().fill('Unsaved welcome text');
        await form.locator('[data-language-code="en"] .placeholder-help-toggle').click();
        await form.locator('[data-language-code="en"] .placeholder-browser > input[type=search]').fill('event');
        await form.getByRole('button', { name: cancelLabel, exact: true }).click();
        await readings(page, 'welcome', ['Welcome EN\nLiteral <b>text</b>']);
        form = await openBox(page, 'translations:welcome');
        await english().fill('Saved welcome update');
        await form.locator('button[type=submit]').click();
        await card(page, 'welcome').locator('.local-editor-summary').getByText('Saved welcome update', { exact: true }).waitFor();
        form = await openBox(page, 'translations:welcome');
        await english().fill('Failed welcome draft');
        await page.evaluate(() => { window.__failReadingSave = true; });
        await form.locator('button[type=submit]').click();
        await form.locator('.form-feedback[data-state=error]').waitFor();
        assert.equal(await english().inputValue(), 'Failed welcome draft');
        await form.getByRole('button', { name: cancelLabel, exact: true }).click();
        await readings(page, 'welcome', ['Saved welcome update']);
        await tab('venue').click();
        let first = await openBox(page, 'translations:venue:venue-a:name');
        await first.locator('[data-language-code="en"] input.translation-field').fill('Retained first venue draft');
        const second = await openBox(page, 'translations:venue:venue-b:name');
        await second.locator('[data-language-code="en"] input.translation-field').fill('Saved second venue update');
        await second.locator('button[type=submit]').click();
        await card(page, 'venue:venue-b').locator('.local-editor-summary').getByText('Saved second venue update', { exact: true }).waitFor();
        first = await openBox(page, 'translations:venue:venue-a:name');
        assert.equal(await first.locator('[data-language-code="en"] input.translation-field').inputValue(), 'Retained first venue draft');
        await first.getByRole('button', { name: cancelLabel, exact: true }).click();
        await readings(page, 'venue:venue-a', ['Synthetic first venue']);
      }

      await page.locator('#settingsToggle').click();
      await page.locator('[data-settings-tab="languages"]').click();
      const rows = page.locator('#languageRows .settings-language-card');
      await rows.first().waitFor();
      assert.equal(await rows.count(), 3);
      for (let index = 0; index < 3; index++) {
        const row = rows.nth(index), header = row.locator(':scope > .settings-card-heading');
        assert.equal(await row.locator('[data-read-only-action="true"]').count(), 1, 'one working export action');
        const download = header.locator('[data-read-only-action="true"]'), pencil = header.locator('[data-local-edit]');
        assert.equal(await download.isVisible(), true);
        const left = await download.boundingBox(), right = await pencil.boundingBox();
        assert.ok(left.x + left.width <= right.x && right.x - left.x - left.width <= 12, 'export directly left of pencil');
        assert.equal(await header.evaluate(n => [...n.querySelectorAll('button')].map(b => b.hasAttribute('data-read-only-action') ? 'export' : 'pencil').join(',')), 'export,pencil');
      }
      await page.evaluate(() => { window.__languageDownloads = []; window.RSVP.dl = (...args) => window.__languageDownloads.push(args); });
      await rows.first().locator('[data-read-only-action="true"]').click();
      await page.waitForFunction(() => window.__languageDownloads.length === 1);
      assert.equal(await page.evaluate(() => window.__languageDownloads[0][0]), 'rsvp-locales-v2-en.csv');
      const editing = await openBox(page, 'language:en');
      assert.equal(await rows.first().locator('[data-read-only-action="true"]').isVisible(), true, 'export remains available while editing');
      await editing.getByRole('button', { name: cancelLabel, exact: true }).click();
      assert.equal(await rows.first().locator('[data-local-edit]').isVisible(), true);
      assert.equal(await rows.first().locator('[data-read-only-action="true"]').count(), 1);

      // A viewer can read translated text and export, but cannot open its pencil.
      if (language === 'en' && theme === 'light') {
        await page.evaluate(() => { window.__accessPermissions.preset = 'custom'; window.__accessPermissions.sections.languages = 'view'; });
        const old = await page.evaluate(() => window.__fetchCount);
        await refreshFixture(page);
        await page.waitForFunction(old => window.__fetchCount > old && !document.getElementById('refreshButton').disabled, old);
        assert.equal(await page.locator('[data-local-edit="language:en"]').isVisible(), false);
        const download = page.locator('[data-editor-key="language:en"] [data-read-only-action="true"]');
        assert.equal(await download.isEnabled(), true);
        assert.equal(await download.isVisible(), true);
        await download.click();
        await page.waitForFunction(() => window.__languageDownloads.length === 2);
        await page.locator('#contentLanguagesToggle').click();
        await tab('welcome').click();
        await readings(page, 'welcome', ['Saved welcome update']);
        assert.equal(await page.locator('[data-local-edit="translations:welcome"]').isVisible(), false);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await page.evaluate(() => fixtures.event_settings[0].is_published), false);
      assert.deepEqual(errors, []);
      cases.push({ language, width, theme });
      await page.close();
    }
    console.log('PASS Languages reading and export header: ' + cases.length + ' language/width/theme cases, all four text views, safe multiline text, Save/Cancel/failure, retained drafts, viewer permissions and working CSV exports.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); cleanup(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

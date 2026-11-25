const {openBox}=require('./helpers/local-edit-ui.cjs');
const {selectContentTranslation,openWordingEditor}=require('./helpers/language-ui.cjs');
// Only the synthetic SDK fixture server removes production integrity checks.
// Local-only multilingual browser checks. All application data and saves are synthetic.
const {chromium,webkit}=require('playwright');
const {mock}=require('./helpers/admin-fixture.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=process.cwd();
const context={window:{}};vm.runInNewContext(fs.readFileSync('js/translations.js','utf8'),context);
const catalog=context.window.RSVP_TRANSLATIONS;
const readLeaf=(lang,key)=>{const [category,...parts]=key.split('.');return parts.reduce((value,part)=>value[part],JSON.parse(fs.readFileSync(`locales/${lang}/${category}.json`,'utf8')));};
for(const entry of Object.values(catalog))for(const lang of ['fo','de'])entry[lang]=readLeaf(lang,entry.key);
const tokens=s=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(x=>x[1]).sort().join(',');
for(const [source,translations]of Object.entries(catalog))for(const lang of ['fo','de']){
 assert.ok(translations[lang]?.trim(),`${lang}: ${source}`);assert.equal(tokens(source),tokens(translations[lang]),`Placeholders ${lang}: ${source}`);
}
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'text/plain')+';charset=utf-8');res.end(path.extname(file)==='.html'?fs.readFileSync(file,'utf8').replace(/ integrity="[^"]+"/g,''):fs.readFileSync(file));
});
const extra=`
const originalFrom=client.from;client.from=function(name){const query=originalFrom.call(this,name);query.upsert=async(rows,options)=>{if(name!=='event_content')throw Error('Unexpected mutation '+name);window.__contentSave={rows,options};fixtures.event_content=rows;return {error:null};};return query;};
fixtures.event_languages=['fo','en','de'].map((language_code,i)=>({language_code,display_name:language_code,enabled:true,sort_order:i+1}));
fixtures.event_languages.push({language_code:'sv',display_name:'Svenska',enabled:false,sort_order:4});
fixtures.households[0].household_name='Food';fixtures.guests[0].first_name='Settings';
const invitationLanguages={JKLMNPQR:{id:h1,language:'de'},MNPRSTUV:{id:h3,language:'de'},RSTUVWXY:{id:'40000000-0000-4000-8000-000000000001',language:'sv'}};
client.functions={invoke:async(name,request)=>{const action=request.body.action;if(action==='get_invitation_v2')return {data:{eventData:{event:{event_name:'Settings',default_language:'fo',event_date:'2027-02-20',timezone:'Europe/Berlin',food_enabled:true,food_stage:'selection'},content:{de:'Unser Fest',fo:'Okkara veitsla'},sessions:[{id:s1,name:'Food'}],locations:[],translations:[]},household:{id:h2,name:'Food',language:'fo',rsvp_state:'open',...invitationLanguages[request.body.args.p_code]},guests:[{id:'g',first_name:'Settings'}],invitations:[{guest_id:'g',session_id:s1,requires_rsvp:true}]}};if(action==='get_household_food')return {data:{stage:'selection',interest:true,items:[{id:'dish',name_en:'Food',quantity_needed:5,claimed_total:0}],claims:[]}};return {error:null};}};
const originalRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='get_language_configuration')return {data:{languages:fixtures.event_languages,default_language:'fo',fallback_language:'en',translations:fixtures.event_content}};if(name==='admin_save_translation'){fixtures.event_content=fixtures.event_content.filter(c=>c.content_key!==args.p_key||c.language_code!==args.p_language);fixtures.event_content.push({content_key:args.p_key,language_code:args.p_language,content_value:args.p_value});return {data:null};}return name.startsWith('get_public_event')?{data:{event:{event_name:'Settings',default_language:'fo',event_date:'2027-02-20',timezone:'Europe/Berlin'},content:{de:'Unser Fest',fo:'Okkara veitsla'},sessions:[{id:s1,name:'Food'}]}}:originalRpc(name,args);};
`;
async function run(browserType){
 const browser=await browserType.launch({headless:true});
 try{
  for(const lang of ['en','fo','de']){
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(lang=>localStorage.setItem('rsvp-interface-language',lang),lang);
   await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra}));
   const base='http://127.0.0.1:'+server.address().port;
   await page.goto(base+'/admin/');await page.locator('#adminApp:not(.hidden)').waitFor();
   await page.locator('#statsGrid .stat-card').first().waitFor({state:'attached'});
   assert.equal(await page.locator('html').getAttribute('lang'),lang);
   assert.equal(await page.locator('[data-tab="households"]').textContent(),lang==='en'?'Households':catalog.Households[lang]);
   await page.locator('#settingsToggle').click();
   await page.locator('[data-settings-tab="interface"]').click();
   await openBox(page,'notification-preferences:wide');
   const wideStatus=page.locator('[data-settings-card="notification-preferences:wide"]');
   const timeLabel=lang==='en'?'Show timestamps':catalog['Show timestamps'][lang],timestampChecks=wideStatus.getByRole('checkbox',{name:timeLabel,exact:true});
   assert.equal(await timestampChecks.count(),2);assert.equal(await timestampChecks.first().isChecked(),true);assert.equal(await timestampChecks.nth(1).isChecked(),false);
   await wideStatus.getByRole('button',{name:lang==='en'?'Cancel':catalog.Cancel[lang],exact:true}).click();
   await page.locator('[data-settings-tab="backups"]').click();
   for(const label of ['Full backup','Partial backup'])assert.equal(await page.locator('#backupExportMode').getByRole('checkbox',{name:lang==='en'?label:catalog[label][lang],exact:true}).count(),1);
   assert.equal(await page.getByRole('checkbox',{name:lang==='en'?'Include activity logs':catalog['Include activity logs'][lang],exact:true}).count(),1);
   for(const label of ['Backup','Restore','Wipe'])assert.equal(await page.locator('#databaseTabs').getByRole('tab',{name:lang==='en'?label:catalog[label][lang],exact:true}).count(),1);
   await page.locator('[data-database-tab="restore"]').click();
   const destinations=page.locator('#backupRestoreDestination');
   assert.equal(await destinations.getByRole('radio').count(),4);
   for(const [value,label] of [['clean','Clean database'],['restart','Restart planning from backup'],['replace','Replace event data'],['wipe','Wipe and restore']]){
    const text=await destinations.locator('input[value="'+value+'"]').evaluate(input=>input.labels[0].textContent);
    assert.ok(text.includes(lang==='en'?label:catalog[label][lang]),lang+': '+label);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'backup controls fit at 390px in '+lang);
   await page.locator('[data-settings-tab="languages"]').click();
   await selectContentTranslation(page,'welcome');
   for(const l of ['fo','en','de'])await page.locator('#foodTranslationGrid [data-language-code="'+l+'"] textarea').fill('Message '+l);
   await page.locator('#foodTranslationGrid button[type="submit"]').click();
   await page.waitForFunction(()=>['fo','en','de'].every(l=>window.__fixtures.event_content.some(c=>c.content_key==='welcome'&&c.language_code===l&&c.content_value==='Message '+l)));
   assert.equal(await page.evaluate(()=>window.__fixtures.event_settings[0].is_published),false);
   const wordingRow=await openWordingEditor(page,lang,'interface.messages.households');
   await wordingRow.locator('textarea').fill('<img src=x onerror=alert(1)>');
   await wordingRow.locator('button[type="submit"]').click();
   await page.waitForFunction(l=>window.RSVP_I18N.t('Households',{},l)==='<img src=x onerror=alert(1)>',lang);
   assert.equal(await page.locator('#foodTranslationGrid img').count(),0);
   assert.equal(await page.evaluate(()=>{try{window.RSVP_I18N.applyWording('Quantity for {item}','de','Menge');return false;}catch{return true;}}),true);
   const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>n.tagName+'#'+n.id+'.'+n.className).slice(0,12));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Mobile admin overflow: '+overflow.join(', '));
   await page.goto(base+'/setup.html');const setupTitle=lang==='en'?'Make this event yours.':catalog['Make this event yours.'][lang];await page.waitForFunction(expected=>document.querySelector('h1')?.textContent===expected,setupTitle);assert.equal(await page.locator('h1').textContent(),setupTitle);
   await page.goto(base+'/?ABCDEFGH');
   await page.locator('#invitationCard:not(.hidden) #householdName').filter({hasText:/^Food$/}).waitFor();
   assert.equal(await page.locator('#guestEventName').textContent(),'Settings');assert.equal(await page.locator('#householdName').textContent(),'Food');
   await page.locator('input[value="attending"]').check();await page.locator('#languageSwitcher [data-language="de"]').click();
   assert.equal(await page.locator('html').getAttribute('lang'),'de');assert.equal(await page.locator('input[value="attending"]').isChecked(),true);
   await page.waitForFunction(()=>document.querySelector('#welcomeMessage').textContent==='Unser Fest');
   assert.equal(await page.locator('#inviteCode').getAttribute('placeholder'),catalog['Invitation code'].de);
   assert.equal(await page.locator('.guest-food-choice>button').textContent(),'Food');
   assert.equal(await page.locator('#foodList input[type=number]').count(),1);assert.equal(await page.locator('#foodList input[type=number]').getAttribute('aria-label'),catalog['Quantity for {item}'].de.replace('{item}','Food'));
   if(lang==='en'){
    assert.equal(await page.evaluate(()=>localStorage.getItem('rsvp-interface-language')),'en','guest language choice does not change organizer preference');
    async function openInvitation(code,expectedLanguage){
     await page.goto(base+'/?='+code);
     await page.waitForFunction(expected=>document.documentElement.lang===expected&&document.querySelector('#rsvpRows input[value=attending]'),expectedLanguage);
     const label=expectedLanguage==='en'?'Attending':catalog.Attending[expectedLanguage];
     await page.locator('#rsvpRows').getByText(label,{exact:true}).waitFor();
    }
    await openInvitation('JKLMNPQR','de');
    await page.locator('#languageSwitcher [data-language="en"]').click();
    await page.locator('#rsvpRows').getByText('Attending',{exact:true}).waitFor();
    await openInvitation('JKLMNPQR','en');
    await openInvitation('MNPRSTUV','de');
    await openInvitation('RSTUVWXY','fo');
    assert.equal(await page.locator('#languageSwitcher [data-language="sv"]').count(),0);
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  const ipad=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
  const localeRequests=[];
  ipad.on('request',request=>{if(request.url().includes('/locales/'))localeRequests.push(request.url());});
  await ipad.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
  await ipad.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra}));
  await ipad.goto('http://127.0.0.1:'+server.address().port+'/admin/');
  await ipad.locator('#adminApp:not(.hidden)').waitFor();
  await ipad.evaluate(()=>window.RSVP_I18N.loadCatalogs(['en','fo','de']));
  const requestsBefore=localeRequests.length;
  await ipad.evaluate(()=>Promise.all(Array.from({length:5},()=>window.RSVP_I18N.loadCatalogs(['en','fo','de']))));
  assert.equal(localeRequests.length,requestsBefore,'repeated locale reads reuse cached requests');
  assert.equal(requestsBefore,9,'one request per language and category');
  assert.equal(await ipad.evaluate(()=>window.RSVP_I18N.t('interface.messages.save',{},'de')),catalog.Save.de);

  await ipad.locator('#settingsToggle').click();
  await ipad.locator('[data-settings-tab="languages"]').click();
  await openWordingEditor(ipad,'de','interface.messages.save');
  assert.equal(await ipad.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'iPad width');
  fs.mkdirSync('artifacts',{recursive:true});
  await ipad.screenshot({path:'artifacts/json-languages-ipad-'+browserType.name()+'.png',fullPage:true});
  await ipad.close();
  console.log('PASS '+browserType.name()+': FO/EN/DE admin, setup, household invitation language, scoped guest choices, welcome saves, safe custom text, placeholders, mobile layout and retained RSVP answers');
 }finally{await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await run(chromium);if(process.env.RSVP_TEST_BROWSER!=='chromium')await run(webkit);}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

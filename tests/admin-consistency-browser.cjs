const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const {openBox}=require('./helpers/local-edit-ui.cjs');
const {chromium,webkit}=require('playwright');
const {mock}=require('./helpers/admin-fixture.cjs');
const {selectContentTranslation,openWordingEditor,selectWorkTab}=require('./helpers/language-ui.cjs');
const {parseCsv,importLanguageCsv}=require('../tools/import-language-csv.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const root=process.cwd(),preview=process.env.CONSISTENCY_PREVIEW;
const server=http.createServer((request,response)=>{
 let name=new URL(request.url,'http://localhost').pathname;if(name.endsWith('/'))name+='index.html';const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){response.writeHead(404);response.end();return;}
 response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'text/plain')+';charset=utf-8');
 response.end(file.endsWith('.html')?fs.readFileSync(file,'utf8').replace(/ integrity="[^"]+"/g,''):fs.readFileSync(file));
});
const extra=`fixtures.event_languages=[{language_code:'fo',display_name:'Føroyskt',sort_order:1,enabled:true},{language_code:'en',display_name:'English',sort_order:2,enabled:true},{language_code:'de',display_name:'Deutsch',sort_order:3,enabled:true},{language_code:'sv',display_name:'Svenska',sort_order:4,enabled:false}];
fixtures.event_content=['fo','en','de'].map(language_code=>({content_key:'welcome',language_code,content_value:{fo:'Vælkomin til veitsluna.',en:'Welcome to our celebration.',de:'Willkommen zu unserem Fest.'}[language_code]}));
fixtures.event_locations=[{id:'venue',name:'Main hall',timezone:'UTC',sort_order:0,map_url:'https://maps.example.invalid/main-hall'},{id:'garden',name:'Garden',timezone:'UTC',sort_order:1}];fixtures.event_sessions[0].location_id='venue';
fixtures.food_items[0].description_en='Bring chilled';fixtures.food_items[0].admin_comment='Private supplier note';
fixtures.other_categories=[{id:'other',name:'Preparations',sort_order:0,updated_at:'2026-11-07T12:00:00Z'},{id:'empty',name:'Equipment',sort_order:1,updated_at:'2026-11-07T12:00:00Z'}];fixtures.other_items=[{id:'task',category_id:'other',item:'Arrange chairs',notes:'Keep the entrance clear',assigned_to:'Example helper',status:'open',sort_order:1,updated_at:'2026-11-07T12:00:00Z'}];
const oldFrom=client.from;client.from=function(name){const table=oldFrom.call(this,name);if(name==='food_items')table.insert=async row=>{fixtures.food_items.push({...row,id:'created-food'});window.__createdFood=row;return {error:null};};if(name==='food_item_types')table.insert=async row=>{(fixtures.food_item_types??=[]).push(row);return {error:null};};return table;};
fixtures.event_settings[0].planning_config={groups:[{id:'group_a',names:{en:'Existing group'}},{id:'group_b',names:{en:'Second group'}}],labels:{households:{},guests:{}}};
const original=client.rpc;client.rpc=async(name,args)=>{
if(name==='admin_save_planning_configuration'){fixtures.event_settings[0].planning_config=args.p_config;fixtures.event_settings[0].event_type=args.p_preset;return {data:null,error:null};}
if(name==='admin_save_food_category'){if(window.__failCategoryRename){window.__failCategoryRename=false;return {data:null,error:{message:'Synthetic category rename failed'}};}const category=fixtures.food_categories.find(row=>row.id===args.p_category_id),previous=category.name;category.name=args.p_name;fixtures.food_items.filter(row=>row.category===previous).forEach(row=>row.category=args.p_name);return {data:null,error:null};}
if(name==='admin_move_venue'){const rows=[...fixtures.event_locations].sort((a,b)=>a.sort_order-b.sort_order);const position=rows.findIndex(row=>row.id===args.p_venue_id),target=position+args.p_direction;if(target>=0&&target<rows.length)[rows[position],rows[target]]=[rows[target],rows[position]];rows.forEach((row,index)=>row.sort_order=index);fixtures.event_locations=rows;return {data:null,error:null};}
if(name==='admin_move_other_category'){const rows=[...fixtures.other_categories].sort((a,b)=>a.sort_order-b.sort_order);const position=rows.findIndex(row=>row.id===args.p_category_id),target=position+args.p_direction;if(target>=0&&target<rows.length)[rows[position],rows[target]]=[rows[target],rows[position]];rows.forEach((row,index)=>{row.sort_order=index;row.updated_at='2026-11-07T13:00:00Z';});fixtures.other_categories=rows;return {data:rows,error:null};}
if(name==='admin_delete_other_category'){window.__categoryDeletes=(window.__categoryDeletes||0)+1;fixtures.other_categories=fixtures.other_categories.filter(row=>row.id!==args.p_category_id);return {data:null,error:null};}
if(name==='admin_save_other_category'){const row=fixtures.other_categories.find(row=>row.id===args.p_id);row.name=args.p_name;row.updated_at='2026-11-07T13:00:00Z';return {data:row,error:null};}
if(name==='admin_save_translation'){window.__wordingSaves=(window.__wordingSaves||0)+1;fixtures.event_content=fixtures.event_content.filter(row=>row.content_key!==args.p_key||row.language_code!==args.p_language);if(args.p_value)fixtures.event_content.push({content_key:args.p_key,language_code:args.p_language,content_value:args.p_value});return {data:null,error:null};}if(name==='admin_save_other'){window.__otherSaves=(window.__otherSaves||0)+1;const row={id:args.p_id,...args.p_values,updated_at:'2026-11-07T12:01:00Z'};const existing=fixtures.other_items.find(item=>item.id===args.p_id);if(existing)Object.assign(existing,row);else fixtures.other_items.push(row);return {data:row,error:null};}return original(name,args);};`;
async function run(type){const browser=await type.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:1024,height:900},hasTouch:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
 // Keep provider scripts outside this synthetic UI test; real map links are checked separately.
 await page.route('**maps.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Map fixture</p>'}));
 await page.route('**/supabase.min.js',route=>route.fulfill({contentType:'text/javascript',body:mock+'\n'+extra}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');await page.locator('#adminApp:not(.hidden)').waitFor();
 assert.equal(await page.locator('.topbar .admin-section-menu').count(),1);assert.equal(await page.locator('.topbar .brand,#adminApp .admin-section-menu').count(),0);
 assert.deepEqual(await page.locator('.admin-section-menu > button').evaluateAll(buttons=>buttons.map(button=>button.id)),['mainSectionToggle','contentLanguagesToggle','settingsToggle']);
 assert.deepEqual(await page.locator('#adminTopActions > *').evaluateAll(buttons=>buttons.map(button=>button.id)),['refreshButton','themeToggle','guestPreviewButton','logout']);
 assert.equal(await page.locator('.admin-heading p').count(),0);assert.match(await page.locator('#adminModeLabel').textContent(),/^Manage invitations/);
 const beforeTheme=await page.locator('html').getAttribute('data-theme');await page.locator('#themeToggle').click();assert.notEqual(await page.locator('html').getAttribute('data-theme'),beforeTheme);await page.locator('#themeToggle').click();
 if(preview&&type.name()==='webkit')await page.screenshot({path:preview+'/header-main.png',fullPage:true});
 if(preview&&type.name()==='webkit')await page.locator('.admin-main-tabs').screenshot({path:preview+'/main-menu.png'});
 assert.deepEqual(await page.locator('.admin-main-tabs [role="tab"]').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.tab)),['invites','venues','households','food','other']);
 await selectWorkTab(page,'venues');
 for(const id of ['venueList','sessionsList'])assert.equal(await page.locator('#'+id).evaluate(node=>node.closest('details').open),true);
 assert.equal(await page.locator('#newVenueForm').evaluate(node=>!!(node.closest('details').compareDocumentPosition(document.getElementById('venueList'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.equal(await page.locator('#newSessionEditor').evaluate(node=>!!(node.closest('details').compareDocumentPosition(document.getElementById('sessionsList'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.equal(await page.locator('#sessionsList .venue-map-link').count(),0);

 const venueRow=page.locator('#venueList > details').first();await venueRow.locator(':scope > summary').click();await venueRow.locator('[data-record-pencil]').click();
 await venueRow.getByRole('button',{name:'Translate in Languages',exact:true}).click();
 assert.equal(await page.locator('#foodTranslationGrid [data-translation-record="venue:venue"]').count(),1);
 assert.equal(await page.locator('#foodTranslationGrid [data-translation-record="venue:venue"]').getByLabel('Name · English',{exact:true}).inputValue(),'Main hall');
 await selectWorkTab(page,'venues');
 await page.locator('#venueList > details').first().getByRole('button',{name:'Move venue down',exact:true}).click();
 await page.locator('#venueList > details').first().locator(':scope > summary').getByText('Garden',{exact:true}).waitFor();
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="venues"]').screenshot({path:preview+'/venues-and-sessions.png'});

 await selectContentTranslation(page,'welcome');
 assert.deepEqual(await page.locator('#contentTranslationTabs button').allTextContents(),['Welcome Message','Venues','Sessions','Food','Guests']);
 assert.equal(await page.locator('#foodTranslationGrid textarea').count(),3);
 assert.equal(await page.locator('#translationSearch').isVisible(),false);
 assert.equal(await page.locator('#settingLanguage').count(),0);
 assert.equal(await page.locator('#foodTranslationTabs').isVisible(),false);
 assert.equal(await page.locator('#wordingCategoryTabs').isVisible(),false);
 if(preview&&type.name()==='webkit'){await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('[data-panel="language"]').screenshot({path:preview+'/main-language-tabs.png'});await page.screenshot({path:preview+'/header-languages.png',fullPage:true});}
 await selectContentTranslation(page,'food');assert.deepEqual(await page.locator('#foodTranslationTabs button').allTextContents(),['Food','Categories','Units']);
 await selectContentTranslation(page,'guests');assert.deepEqual(await page.locator('#foodTranslationTabs button').allTextContents(),['Food explanation','Food Interest Reply']);
 await page.locator('#foodTranslationTabs [data-translation-tab=food-interest-reply]').click();assert.equal(await page.locator('#foodTranslationGrid textarea').count(),6);assert.equal(await page.locator('#foodTranslationGrid output').count(),3);
 await selectWorkTab(page,'other');const task=page.locator('[data-other-id="task"]');
 assert.equal(await task.locator('input:visible,textarea:visible,select:visible').count(),0);
 await task.getByRole('button',{name:/Edit item/}).click();
 await task.locator('textarea').fill('Bring linen');assert.equal(await page.evaluate(()=>window.__otherSaves||0),0);
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="other"]').screenshot({path:preview+'/other-text-and-editor.png'});
 await task.getByRole('button',{name:'Save',exact:true}).click();await task.locator('form').waitFor({state:'hidden'});
 assert.ok((await task.locator('.other-line-summary').textContent()).includes('Bring linen'));
 const gap=await page.locator('.admin-main-tabs').evaluate(nav=>{const other=nav.querySelector('[data-tab=other]').getBoundingClientRect(),invites=nav.querySelector('[data-tab=invites]').getBoundingClientRect();return invites.left-other.right;});assert.ok(gap<25,'Invites follows Other without an auto margin');
 const category=page.locator('[data-other-category="other"]'),empty=page.locator('[data-other-category="empty"]');
 const addCategory=page.locator('[data-panel="other"] summary').filter({hasText:'Add category'});
 assert.ok(await addCategory.isVisible());assert.equal(await addCategory.locator('.action-symbol').count(),0);
 assert.equal(await category.locator(':scope > summary').getByRole('button',{name:'Move category up',exact:true}).isDisabled(),true);
 await category.locator(':scope > summary').getByRole('button',{name:'Edit category',exact:true}).click();await category.locator('.other-category-name-form').getByRole('button',{name:'Delete category',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__categoryDeletes||0),0,'nonempty category cannot delete its items');
 assert.equal(await category.locator('.other-category-name-form button[type=submit]').isDisabled(),true);
 await category.locator('.other-category-name-form input').fill('Event preparations');
 await category.locator('.other-category-name-form').getByRole('button',{name:'Save',exact:true}).click();
 await category.locator('.other-category-title').getByText('Event preparations',{exact:true}).waitFor();
 await category.locator(':scope > summary').getByRole('button',{name:'Add item',exact:true}).click();
 const newItem=category.locator('.other-line[data-new-item="true"]');assert.equal(await newItem.evaluate(node=>!!(node.compareDocumentPosition(node.parentElement.querySelector('.other-column-heading'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Other create editor precedes list header');await newItem.locator('input').first().fill('Bring tablecloths');
 await newItem.locator('textarea').fill('Use the white ones');
 await empty.locator(':scope > summary').getByRole('button',{name:'Move category up',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.other-category').dataset.otherCategory==='empty');
 assert.equal(await page.locator('.other-category').first().getAttribute('data-other-category'),'empty');
 assert.equal(await newItem.locator('input').first().inputValue(),'Bring tablecloths','reordering retains item draft');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Other category controls fit mobile');await page.setViewportSize({width:1024,height:900});
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="other"]').screenshot({path:preview+'/other-category-controls.png'});
 await newItem.getByRole('button',{name:'Save',exact:true}).click();await newItem.locator('form').waitFor({state:'hidden'});
 await empty.locator(':scope > summary').getByRole('button',{name:'Edit category',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await empty.locator('.other-category-name-form').getByRole('button',{name:'Delete category',exact:true}).click();await empty.waitFor({state:'detached'});
 await selectWorkTab(page,'food');const item=page.locator('.food-compact-item').first();
 assert.equal(await item.evaluate(node=>node.open),false);

 assert.ok(await item.getByText('Guest: Bring chilled',{exact:true}).isVisible());
 assert.ok(await item.getByText('Admin: Private supplier note',{exact:true}).isVisible());
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="food"]').screenshot({path:preview+'/collapsed-food-comments.png'});

 const foodCategory=page.locator('.food-category').first();
 await foodCategory.locator(':scope > summary').getByRole('button',{name:'Add item or sub-category',exact:true}).click();await page.getByRole('dialog',{name:'Add item or sub-category',exact:true}).getByRole('button',{name:'Add item',exact:true}).click();
 assert.equal(await page.locator('#newFoodCategory').inputValue(),'Main dishes');
 assert.ok(await foodCategory.locator('.food-inline-add-host #addFoodForm').isVisible());
 assert.equal(await page.locator('summary').filter({hasText:'＋ Add food item'}).count(),0);
 await page.locator('#newFoodName').fill('New sample dish');await page.locator('#newFoodUserComment').fill('Bring chilled');
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="food"]').screenshot({path:preview+'/food-inline-create.png'});
 await page.locator('#addFoodForm button[type=submit]').click();await page.waitForFunction(()=>window.__createdFood?.name_en==='New sample dish');
 await page.locator('#addFoodForm').waitFor({state:'hidden'});
 await foodCategory.locator(':scope > summary').getByRole('button',{name:'Add item or sub-category',exact:true}).click();await page.getByRole('dialog',{name:'Add item or sub-category',exact:true}).getByRole('button',{name:'Add item',exact:true}).click();await page.locator('#newFoodName').fill('Discard this draft');await page.locator('#cancelFoodCreate').click();

 await foodCategory.locator(':scope > summary').getByRole('button',{name:'Rename food category',exact:true}).click();
 const categoryEditor=foodCategory.locator('.food-category-name-form');assert.equal(await categoryEditor.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
 await categoryEditor.locator('input').fill('Dinner dishes');await page.evaluate(()=>window.__failCategoryRename=true);
 await categoryEditor.getByRole('button',{name:'Save',exact:true}).click();await categoryEditor.getByText('Error · Synthetic category rename failed',{exact:true}).waitFor();
 assert.equal(await categoryEditor.locator('input').inputValue(),'Dinner dishes');
 await categoryEditor.getByRole('button',{name:'Save',exact:true}).click();await foodCategory.locator('.food-category-title').getByText('Dinner dishes',{exact:true}).waitFor();
 await categoryEditor.getByRole('button',{name:'Cancel',exact:true}).click();
 const edit=item.getByRole('button',{name:'Edit food item',exact:true});assert.ok(await edit.isVisible());
 assert.equal(await edit.evaluate(button=>!!button.closest('summary .food-header-actions')),true);
 await edit.click();assert.ok(await item.locator('.food-edit-form').isVisible());
 assert.equal(await item.getByRole('button',{name:'Save food item',exact:true}).isDisabled(),true);
 await item.locator('[data-food-language]').click();
 const popup=page.locator('.food-language-dialog');await popup.waitFor();
 assert.equal(await popup.getByLabel(/^Type ·/).count(),0);
 assert.equal(await popup.getByLabel(/^Guest note ·/).count(),3);
 assert.equal(await popup.getByRole('button',{name:'Save translations',exact:true}).isDisabled(),true);
 if(preview&&type.name()==='webkit')await popup.screenshot({path:preview+'/food-language-popup.png'});
 await popup.getByRole('button',{name:'Cancel',exact:true}).click();
 if(preview&&type.name()==='webkit')await page.locator('[data-panel="food"]').screenshot({path:preview+'/food-header-actions.png'});
 await page.locator('#addFoodType').click();const typeManager=page.getByRole('dialog',{name:'Manage units',exact:true});
 assert.equal(await typeManager.locator('.type-manager-row').count(),6);
 await typeManager.getByLabel('New food unit',{exact:true}).fill('Basket(s)');
 await typeManager.getByRole('button',{name:'Add unit',exact:true}).click();await typeManager.getByText('Unit added',{exact:true}).waitFor();
 assert.equal(await typeManager.locator('.type-manager-row').count(),7);
 if(preview&&type.name()==='webkit')await typeManager.screenshot({path:preview+'/manage-food-types.png'});
 await typeManager.getByRole('button',{name:'Translate · Basket(s)',exact:true}).click();
 assert.equal(await page.locator('#foodTranslationGrid [data-translation-record="ui:Food type: Basket(s)"]').evaluate(row=>row.open),true);
 assert.equal(await page.locator('#foodTranslationGrid [data-translation-record="ui:Food type: Basket(s)"]').getByLabel('Unit · English',{exact:true}).inputValue(),'Basket(s)');
 await page.locator('#settingsToggle').click();await page.locator('[data-settings-tab="interface"]').click();
 assert.match(await page.locator('#adminModeLabel').textContent(),/^Manage event details/);
 await openBox(page,'personal-preferences');assert.ok(await page.locator('#interfaceLanguageHost #interfaceLanguage').isVisible());assert.ok(await page.locator('#interfaceAppearanceHost #themePreference').isVisible());assert.equal(await page.locator('#languageToggle,#themeMenu,#closeSettings').count(),0);
 if(preview&&type.name()==='webkit'){await page.locator('#themePreference').selectOption('dark');await page.mouse.move(0,0);await page.screenshot({path:preview+'/settings-interface.png',fullPage:true});}
 await page.locator('[data-settings-tab="languages"]').click();
 assert.equal(await page.locator('.settings-tabs').getAttribute('role'),'tablist');
 assert.equal(await page.locator('#contentTranslationTabs').isVisible(),false);
 assert.deepEqual(await page.locator('#interfaceLanguageTabs button').allTextContents(),['Føroyskt','English','Deutsch']);
 const categoryTabs=page.locator('#wordingCategoryTabs');assert.ok(await categoryTabs.isVisible());
 const counts=await categoryTabs.locator('.wording-category-count').allTextContents();assert.equal(counts.slice(1).reduce((sum,count)=>sum+Number(count),0),Number(counts[0]),'each phrase has exactly one category');
 assert.equal(await page.locator('.wording-row').count(),25);assert.equal(await page.locator('.wording-edit-form:visible').count(),0);
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText(/Page 2 of/).waitFor();
 await categoryTabs.locator('[data-translation-tab="households"]').click();await page.getByText(/Page 1 of/).waitFor();
 if(!await page.locator('#translationSearch').isVisible())await page.locator('#translationSearchToggle').click();
 await page.locator('#translationSearch').fill('Households');await page.locator('[data-wording-key="interface.messages.households"]').waitFor();
 await categoryTabs.locator('[data-translation-tab="backups"]').click();await page.locator('[data-wording-key="interface.messages.backup_sections_help"]').waitFor();assert.equal(await page.locator('[data-wording-key="interface.messages.households"]').count(),0);
 await page.locator('#translationSearch').fill('');await categoryTabs.locator('[data-translation-tab="all"]').click();
 await page.getByRole('combobox',{name:'Rows per page',exact:true}).selectOption('10');assert.equal(await page.locator('.wording-row').count(),10);
 let wording=await openWordingEditor(page,'de','interface.messages.households');
 await wording.locator('textarea').fill('Unfinished wording');
 await categoryTabs.locator('[data-translation-tab="backups"]').click();assert.equal(await page.locator('[data-wording-key="interface.messages.households"]').count(),0);
 await categoryTabs.locator('[data-translation-tab="households"]').click();assert.equal(await wording.locator('textarea').inputValue(),'Unfinished wording');
 await page.locator('#interfaceLanguageTabs [data-translation-tab="en"]').click();
 await page.locator('#interfaceLanguageTabs [data-translation-tab="de"]').click();
 wording=page.locator('[data-wording-key="interface.messages.households"]');assert.equal(await wording.locator('textarea').inputValue(),'Unfinished wording');
 const translated='Haushalte, "Familien"\nWeitere';await wording.locator('textarea').fill(translated);
 assert.equal(await page.evaluate(()=>window.__wordingSaves||0),0);
 await wording.locator('button[type="submit"]').click();await page.waitForFunction(()=>window.RSVP_I18N.t('Households',{},'de')==='Haushalte, "Familien"\nWeitere');
 await page.locator('#translationSearch').fill('');await page.waitForFunction(()=>document.querySelectorAll('.wording-row').length===10);
 await page.waitForFunction(()=>document.querySelector('.wording-row')?.dataset.wordingSource!=='Households');
 if(preview&&type.name()==='webkit'){await page.locator('.settings-page').screenshot({path:preview+'/settings-language-list.png'});await page.locator('#translationEditor').screenshot({path:preview+'/settings-wording-categories.png'});}
 await page.getByRole('heading',{name:'Choose enabled languages',exact:true}).waitFor();
 const language=page.locator('#languageRows [data-language-code="de"]');
 assert.equal(await language.locator('button[type="submit"]').textContent(),'Save');
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-editor-key="language:de"] .local-editor-summary').getByRole('button',{name:/Export CSV/}).click();const download=await downloadEvent;
 assert.equal(download.suggestedFilename(),'rsvp-locales-v2-de.csv');const csv=fs.readFileSync(await download.path(),'utf8');
 const rows=parseCsv(csv);assert.deepEqual(rows[0],['format_version','catalog_version','language_code','category','key','source','translation']);assert.equal(rows[1][0],'2');assert.match(rows[1][1],/^sha256:[0-9a-f]{64}$/);assert.equal(rows.find(row=>row[5]==='Households')[6],translated);
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rsvp-browser-csv-'));
 try{
  fs.mkdirSync(path.join(temporary,'locales/en'),{recursive:true});
  fs.copyFileSync('locales/aliases.json',path.join(temporary,'locales/aliases.json'));
  for(const category of ['interface','food','types'])fs.copyFileSync('locales/en/'+category+'.json',path.join(temporary,'locales/en',category+'.json'));
  importLanguageCsv(csv,temporary);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temporary,'locales/de/interface.json'),'utf8')).messages.households,translated);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 await page.locator('#mainSectionToggle').click();await selectWorkTab(page,'food');
 await page.evaluate(()=>{window.__fixtures.food_items[0].description_en='Keep chilled. '.repeat(40);});await refreshFixture(page);await page.waitForFunction(()=>!document.getElementById('refreshButton').disabled);
 await item.evaluate(node=>node.open=false);
 const more=item.locator('.comment-more');await more.waitFor();await more.click();assert.equal(await item.evaluate(node=>node.open),false,'reading comments does not expand editor');
 assert.equal(await more.getAttribute('aria-expanded'),'true');
 await item.getByRole('button',{name:'Show less',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile width');
 for(const icon of await page.locator('.topbar .admin-icon-btn:visible').all()){const box=await icon.boundingBox();assert.ok(box.width>=44&&box.height>=44,'toolbar touch targets');}
 await page.locator('[data-tab="language"]').click();assert.equal(await page.locator('.admin-main-tabs').isVisible(),false);assert.equal(await page.locator('#contentLanguagesToggle').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#tabOverflowHint').isVisible(),false);
 await page.locator('#settingsToggle').click();
 await page.locator('[data-settings-tab=event]').click();

 await openBox(page,'event-planning');const planning=page.locator('#planningConfigHost');
 const savePlanning=planning.getByRole('button',{name:'Save'});
 assert.equal(await savePlanning.isDisabled(),true);
 await planning.getByLabel('Event preset').selectOption('conference');
 await planning.getByRole('button',{name:'Use preset suggestions'}).click();
 await planning.locator('.planning-groups fieldset').nth(3).waitFor();
 await planning.locator('.planning-groups fieldset').first().getByLabel('English').fill('Renamed group');
 await savePlanning.click();
 await page.waitForFunction(()=>window.__fixtures.event_settings[0].planning_config.labels.households.en==='Bookings');
 await page.waitForFunction(()=>document.querySelector('[data-tab=households]').textContent==='Bookings');
 assert.deepEqual(await page.evaluate(()=>window.__fixtures.event_settings[0].planning_config.groups.map(g=>g.names.en)),['Renamed group','Second group','Attendees','Speakers']);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS '+type.name()+': navigation order, content tabs, Other panels, food header actions, paginated wording drafts and browser CSV-to-JSON round trip');
}finally{await browser.close();}}
(async()=>{if(preview)fs.mkdirSync(preview,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await run(chromium);if(process.env.RSVP_TEST_BROWSER!=='chromium')await run(webkit);}finally{server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});

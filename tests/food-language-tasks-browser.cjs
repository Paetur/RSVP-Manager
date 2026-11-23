const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const {openBox}=require('./helpers/local-edit-ui.cjs');
const {selectContentTranslation,openWordingEditor,selectWorkTab}=require('./helpers/language-ui.cjs');
// Geometry regression for native disclosures; uses only synthetic administration data.
const {chromium,webkit}=require('playwright');
const {mock}=require('./helpers/admin-fixture.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'text/plain')+';charset=utf-8');res.end(path.extname(file)==='.html'?fs.readFileSync(file,'utf8').replace(/ integrity="[^"]+"/g,''):fs.readFileSync(file));
});
async function assertAssignmentModal(dialog, workspace, originalHeight) {
 const presentation=await dialog.evaluate(node=>{
   const {left,top,right,bottom}=node.getBoundingClientRect();
   return {
     modal:node.matches(':modal'),
     bodyOwned:node.parentElement===document.body,
     focusInside:node.contains(document.activeElement),
     fitsViewport:left>=0&&top>=0&&right<=innerWidth+1&&bottom<=innerHeight+1,
   };
 });
 assert.deepEqual(presentation,{modal:true,bodyOwned:true,focusInside:true,fitsViewport:true});
 if(originalHeight!==undefined)assert.equal(await workspace.evaluate(node=>node.offsetHeight),originalHeight,'opening the assignment popup does not resize the venue workspace');
}
async function run(type){const browser=await type.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:820,height:1180}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   if(window===window.top)localStorage.setItem('rsvp-interface-language','en');
 });
 const extra=`fixtures.event_content.push({content_key:'venue:venue-1:welcome',language_code:'fo',content_value:'Vælkomin í høllina'});fixtures.event_sessions[0].description='Meet before dinner';fixtures.event_sessions[0].location_id='venue-1';fixtures.event_locations=[{id:'venue-1',name:'Main hall',welcome_en:'Welcome to the hall',notes:'Use the front door',address:'12 Example Street',country_code:'FO',timezone:'Atlantic/Faroe',map_url:'https://maps.example.invalid/main-hall'},{id:'venue-2',name:'Garden'}];fixtures.households[1].food=true;fixtures.households[2].food=true;fixtures.household_session_defaults.push({household_id:h2,session_id:s1,is_invited:true});fixtures.other_categories=[{id:'other-cat',name:'Tasks',sort_order:0}];fixtures.other_items=[{id:'task-one',category_id:'other-cat',item:'Arrange chairs',assigned_to:'Example helper',status:'open',sort_order:0,updated_at:'2026-11-01T12:00:00Z'}];fixtures.food_items.forEach(f=>{f.description_en='Bring chilled';f.admin_comment='Private supplier note';});const foodFrom=client.from;client.from=function(name){const table=foodFrom.call(this,name);if(name==='food_item_types')table.insert=async record=>{(fixtures.food_item_types??=[]).push(record);return {error:null};};if(name==='food_items')table.update=record=>({eq:(_,id)=>{Object.assign(fixtures.food_items.find(f=>f.id===id),record);window.__savedFood=record;return {then:resolve=>Promise.resolve({error:null}).then(resolve),select:async()=>({data:[{id}],error:null})};}});return table;};const oldTaskRpc=window.__managementRpc;window.__managementRpc=(name,args)=>{if(name==='admin_session_invitation_locks')return {data:[h1],error:null};if(name==='admin_edit_session_households'){window.__sessionHouseholds=args;for(const [ids,invited] of [[args.p_add,true],[args.p_remove,false]])for(const id of ids){const existing=fixtures.household_session_defaults.find(d=>d.household_id===id&&d.session_id===args.p_session_id);if(existing)existing.is_invited=invited;else fixtures.household_session_defaults.push({household_id:id,session_id:args.p_session_id,is_invited:invited});}return {data:null,error:null};}if(name==='admin_move_session'){const rows=[...fixtures.event_sessions].sort((a,b)=>a.sort_order-b.sort_order);const i=rows.findIndex(s=>s.id===args.p_session_id),j=i+args.p_direction;if(j>=0&&j<rows.length){[rows[i],rows[j]]=[rows[j],rows[i]];rows.forEach((s,index)=>s.sort_order=index+1);}return {data:null,error:null};}if((name==='admin_rename_member'||name==='admin_update_member')){window.__renamedAdmin=args;return {data:null,error:null};}if(name==='admin_list_members'&&window.__renamedAdmin)return {data:[{user_id:h1,name:window.__renamedAdmin.p_name,email:'test-admin@example.invalid'}],error:null};if(name==='admin_edit_venue_food'){window.__venueFood=args;for(const id of args.p_add){const item=fixtures.food_items.find(f=>f.id===id);item.venue_ids=[...new Set([...(item.venue_ids||[]),args.p_venue_id])];}for(const id of args.p_remove){const item=fixtures.food_items.find(f=>f.id===id);item.venue_ids=(item.venue_ids||fixtures.event_locations.filter(v=>!v.archived_at).map(v=>v.id)).filter(venue=>venue!==args.p_venue_id);}return {data:null,error:null};}if(name==='admin_save_translation'){(window.__savedTypeTranslations??=[]).push(args);fixtures.event_content=fixtures.event_content.filter(row=>row.content_key!==args.p_key||row.language_code!==args.p_language);if(args.p_value)fixtures.event_content.push({content_key:args.p_key,language_code:args.p_language,content_value:args.p_value});return {data:null,error:null};}if(name==='admin_save_food_translations'){window.__foodTranslationSaves=(window.__foodTranslationSaves||0)+1;if(window.__failFoodTranslations){window.__failFoodTranslations=false;return {data:null,error:{message:'Simulated translation failure'}};}window.__savedTranslations=args;for(const change of args.p_changes){fixtures.event_content=fixtures.event_content.filter(row=>row.content_key!==change.key||row.language_code!==change.language);if(change.value)fixtures.event_content.push({content_key:change.key,language_code:change.language,content_value:change.value});}return {data:null,error:null};}if(name==='admin_set_food_selection'){const old=fixtures.food_claims.findIndex(c=>c.household_id===args.p_household_id&&c.food_item_id===args.p_food_item_id);if(old>=0)fixtures.food_claims.splice(old,1);if(args.p_quantity)fixtures.food_claims.push({household_id:args.p_household_id,food_item_id:args.p_food_item_id,quantity:args.p_quantity});window.__savedSelection=args;return {data:null,error:null};}if(name==='admin_save_other'){window.__savedOther=args;const value={...args.p_values,id:args.p_id,updated_at:new Date().toISOString()},old=fixtures.other_items.find(r=>r.id===args.p_id);if(old)Object.assign(old,value);else fixtures.other_items.push(value);return {data:value,error:null};}return oldTaskRpc(name,args);};const batchRpc=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_save_translations')(window.__batchTranslationSaves??=[]).push(args);return batchRpc(name,args);};`;
 await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');await page.waitForFunction(()=>document.querySelector('#inviteOverviewCounts .invite-stat-row'));
 assert.equal(await page.locator('[data-tab="invites"]').textContent(),'Main');
 await selectWorkTab(page,'invites');
 await page.locator('#inviteRows details.tree-disclosure').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
 const inviteHousehold=page.locator('[data-invite-household="22222222-2222-4222-8222-222222222222"]');
 await inviteHousehold.locator(':scope > summary').click();
 const rsvpPanel=page.locator('#invite-rsvp-22222222-2222-4222-8222-222222222222');
 await rsvpPanel.locator('summary').first().click();
 assert.ok(await rsvpPanel.getByText('Open for responses',{exact:true}).isVisible());
 assert.ok(await rsvpPanel.getByRole('cell',{name:'Dinner',exact:true}).first().isVisible());
 if(process.env.RSVP_LAYOUT_PREVIEW&&type.name()==='chromium')await rsvpPanel.screenshot({path:process.env.RSVP_LAYOUT_PREVIEW+'/invites-rsvp-management.png'});
 await page.locator('[data-invite-household="22222222-2222-4222-8222-222222222222"] > summary .invite-compact-name').click();
 assert.equal(await rsvpPanel.isVisible(),false);
 await selectWorkTab(page,'food');
 const food=page.locator('.food-compact-item').first();assert.equal(await food.evaluate(n=>n.open),false);assert.ok(await food.getByText('Guest: Bring chilled',{exact:true}).isVisible());assert.ok(await food.getByText('Admin: Private supplier note',{exact:true}).isVisible());
 await food.locator(':scope > summary strong').first().click();assert.equal(await food.locator('.food-expanded').isVisible(),true);assert.ok((await food.textContent()).includes('Private supplier note'));
 assert.equal(await food.locator('[name="name_fo"]').count(),0);assert.equal(await food.locator('[name="name_en"]').count(),1);assert.equal(await food.locator('[name="admin_comment"]').inputValue(),'Private supplier note');
 const comments=await food.locator('.food-comment-grid > span').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().y));assert.equal(comments.length,2);assert.ok(Math.abs(comments[0]-comments[1])<2,'read-only comments side by side');
 assert.equal(await food.locator('.food-edit-form').isVisible(),false);
 await food.getByRole('button',{name:'Edit food item',exact:true}).click();
 const shown=food.getByRole('checkbox',{name:'Show to guests',exact:true});
 assert.equal(await shown.isChecked(),true);
 await shown.uncheck();
 assert.equal(await food.locator('.food-guest-visibility [title="Hidden from guests"] svg').count(),1);
 await shown.check();
 const nameBox=await food.locator('[name="name_en"]').boundingBox(),qtyBox=await food.locator('[name="quantity_needed"]').boundingBox(),userBox=await food.locator('[name="description_en"]').boundingBox(),adminBox=await food.locator('[name="admin_comment"]').boundingBox();
 assert.ok(Math.abs(nameBox.y-qtyBox.y)<2&&Math.abs(userBox.y-adminBox.y)<2&&userBox.y>nameBox.y,'Name/Quantity above paired comments');
 await food.getByLabel('Unit',{exact:true}).selectOption('Tray(s)');
 assert.ok(await food.getByRole('checkbox',{name:'Main hall'}).isChecked());
 assert.ok(await food.getByRole('checkbox',{name:'Garden'}).isChecked());
 if(process.env.FOOD_SETTINGS_PREVIEW&&type.name()==='chromium'){
   await food.getByRole('checkbox',{name:'Garden'}).uncheck();
   await food.screenshot({path:process.env.FOOD_SETTINGS_PREVIEW+'/food-types-venues-editor.png'});
   await food.getByRole('checkbox',{name:'Garden'}).check();
 }
 await food.locator('[name="description_en"]').fill('');
 await food.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>window.__savedFood?.description_en==='');
 await food.getByRole('button',{name:'Edit food item',exact:true}).click();
 assert.equal(await food.locator('[name="description_en"]').inputValue(),'');
 assert.equal(await food.getByLabel('Unit',{exact:true}).inputValue(),'Tray(s)');
 assert.equal(await food.getByText('Source amount:',{exact:false}).count(),0);
 await food.getByRole('button',{name:'Cancel',exact:true}).click();
 const languageButton=food.getByRole('button',{name:'Language',exact:true});
 assert.equal(await food.locator('.food-item-links').getByRole('button',{name:'Language',exact:true}).count(),0);
 await food.getByRole('button',{name:'Edit food item',exact:true}).click();
 await food.locator('[name="quantity_needed"]').fill('6');
 await languageButton.click();
 const languageDialog=page.getByRole("dialog",{name:'Language · Sample dish',exact:true});
 await languageDialog.waitFor();
 assert.equal(await languageDialog.getByLabel(/^Type ·/).count(),0);
 assert.equal(await languageDialog.getByLabel(/^Guest note ·/).count(),3);
 assert.equal(await languageDialog.locator('.food-translation-row').count(),3);
 for(const row of await languageDialog.locator('.food-translation-row').all()){assert.equal(await row.getByRole('textbox').count(),2);assert.ok(await row.getByRole('textbox').first().isVisible());}
 await languageDialog.locator('[data-language-code="fo"]').getByRole('textbox').first().fill('Discard this translation');
 await languageDialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await languageDialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.__foodTranslationSaves||0),0,'cancel does not save');
 await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-food-language'));
 await languageButton.click();
 assert.notEqual(await languageDialog.locator('[data-language-code="fo"]').getByRole('textbox').first().inputValue(),'Discard this translation');
 await languageDialog.locator('[data-language-code="fo"]').getByRole('textbox').first().fill('Føroyskur rættur');
 await languageDialog.locator('[data-language-code="de"]').getByRole('textbox').nth(1).fill('Bitte gekühlt bringen');
 await languageDialog.locator('[data-language-code="fo"]').getByRole('textbox').nth(1).fill('Tak við køldum');
 assert.equal(await page.evaluate(()=>window.__foodTranslationSaves||0),0,'typing does not save');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile translation dialog width');
 await page.setViewportSize({width:820,height:1180});
 if(process.env.FOOD_LANGUAGE_POPUP_PREVIEW&&type.name()==='webkit'){
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  await page.mouse.move(0,0);
  await languageDialog.screenshot({path:process.env.FOOD_LANGUAGE_POPUP_PREVIEW+'/food-item-languages.png'});
 }
 await page.evaluate(()=>{window.__failFoodTranslations=true;});
 await languageDialog.getByRole('button',{name:'Save',exact:true}).click();
 await languageDialog.getByRole('alert').filter({hasText:'Simulated translation failure'}).waitFor();
 assert.equal(await languageDialog.locator('[data-language-code="fo"]').getByRole('textbox').first().inputValue(),'Føroyskur rættur');
 await languageDialog.getByRole('button',{name:'Save',exact:true}).click();
 await languageDialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.__savedTranslations.p_changes.length),3);
 assert.equal(await food.locator('[name="quantity_needed"]').inputValue(),'6','unfinished food draft survives translation save');
 assert.ok(await food.locator('.food-edit-form').isVisible());
 await food.getByRole('button',{name:'Cancel',exact:true}).click();
 const recipeText='Melt:\n - 360g dark chocolate\n - 300g butter\n\nStir well';
 await food.getByRole('button',{name:'+ Recipe',exact:true}).click();
 const recipeDialog=page.getByRole("region",{name:'Recipe'});
 await recipeDialog.getByLabel('Recipe',{exact:true}).fill(recipeText);
 if(process.env.FOOD_PREVIEW&&type.name()==='chromium')await recipeDialog.screenshot({path:process.env.FOOD_PREVIEW+'/food-recipe-popup.png'});
 await recipeDialog.getByRole('button',{name:'Save',exact:true}).click();
 const recipeLink=food.getByRole('button',{name:'Recipe',exact:true});
 await recipeLink.waitFor();
 await page.evaluate(()=>{window.print=()=>{window.__recipePrint=document.querySelector('.recipe-print-view').textContent;window.dispatchEvent(new Event('afterprint'));};});
 await recipeLink.click();await page.getByRole("region",{name:'Recipe',exact:true}).getByRole('button',{name:/^Edit/}).click();await page.getByRole("region",{name:'Recipe',exact:true}).getByRole('button',{name:'Preview',exact:true}).click();
 assert.match(await page.evaluate(()=>window.__recipePrint),/^Sample dishMelt:/);
 assert.equal(await food.evaluate(n=>n.open),true);
 assert.equal(await page.evaluate(()=>window.__savedFood.recipe_text),recipeText);await page.getByRole("region",{name:'Recipe',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
 const itemSelection=food.locator('.food-selection-editor');
 await itemSelection.locator('summary').click();
 await itemSelection.getByLabel('Household',{exact:true}).selectOption({label:'Example child'});
 await itemSelection.getByLabel('Quantity',{exact:true}).fill('2');
 await itemSelection.getByRole('button',{name:'Save',exact:true}).click();
 await food.locator('.food-selections tbody tr').waitFor();
 if(process.env.FOOD_SETTINGS_PREVIEW&&type.name()==='chromium')await page.locator('[data-panel="food"]').screenshot({path:process.env.FOOD_SETTINGS_PREVIEW+'/food-toolbar-households.png'});
 assert.match(await food.locator('.food-selections tbody tr').textContent(),/Example child\s*2/);
 await selectWorkTab(page,'households');
 await page.locator('#expandHouseholds').click();
 assert.equal(await page.locator('#householdRows .food-selections').count(),0);
 await selectWorkTab(page,'food');
 assert.match(await food.locator('.food-selections tbody tr').textContent(),/Example child\s*2/);
 const summary=food.locator(':scope > summary');
 await summary.locator('strong').first().click();
 assert.equal(await food.evaluate(n=>n.open),false);
 assert.ok(await summary.getByText('Example child · 2',{exact:true}).isVisible());
 assert.equal(await page.locator('.food-category-heading .tree-count').first().textContent(),'1 item · Quantity: 2/4');
 await summary.locator('strong').first().click();
 await page.evaluate(()=>{window.__fixtures.households[1].food_confirmed=true;});
 await refreshFixture(page);
 await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
 if(process.env.FOOD_PREVIEW&&type.name()==='chromium')await food.screenshot({path:process.env.FOOD_PREVIEW+'/food-claim-controls.png'});
 await food.getByRole('button',{name:'Edit quantity for Example child'}).click();
 if(process.env.FOOD_PREVIEW&&type.name()==='chromium')await food.screenshot({path:process.env.FOOD_PREVIEW+'/food-edit-quantity.png'});
 const claimRow=food.locator('.food-selections tbody tr');
 await claimRow.getByLabel('Quantity',{exact:true}).fill('3');
 await claimRow.getByRole('button',{name:'Save',exact:true}).click();
 await summary.getByText('Example child · 3',{exact:true}).waitFor();
 if(process.env.PREVIEW_OUTPUT)await page.locator('[data-panel="food"]').screenshot({path:process.env.PREVIEW_OUTPUT+'/food-admin-draft.png'});
 await food.getByRole('button',{name:'Remove assignment for Example child'}).click();
 await page.locator('.inline-confirmation [data-inline-confirm]').click();
 await summary.locator('.food-claim-summary').waitFor({state:'detached'});
 assert.equal(await page.locator('.food-category-heading .tree-count').first().textContent(),'1 item · Quantity: 0/4');
 await page.evaluate(()=>window.__fixtures.food_items.forEach(f=>{f.description_en=null;f.admin_comment=null;}));await refreshFixture(page);await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);assert.equal(await page.locator('.food-comment-grid').count(),0,'empty read-only comments are omitted');
 await page.locator('.food-category-heading').first().getByRole('button',{name:'Add item or sub-category',exact:true}).click();await page.getByRole("dialog",{name:'Add item or sub-category',exact:true}).getByRole('button',{name:'Add item',exact:true}).click();
 await page.locator('#addFoodType').click();
 const typesDialog=page.getByRole("region",{name:'Manage units',exact:true});
 await typesDialog.getByLabel('New food unit',{exact:true}).fill('Basket(s)');
 await typesDialog.getByRole('button',{name:'Add unit',exact:true}).click();
 await typesDialog.getByText('Unit added',{exact:true}).waitFor();
 await typesDialog.getByRole('button',{name:'Close',exact:true}).click();
 assert.equal(await page.locator('#newFoodType').inputValue(),'Basket(s)');
 if(process.env.FOOD_SETTINGS_PREVIEW&&type.name()==='chromium')await page.locator('#addFoodForm').screenshot({path:process.env.FOOD_SETTINGS_PREVIEW+'/food-add-type.png'});
 await page.evaluate(()=>{
   const items=window.__fixtures.food_items;
   items.push({id:'dessert-example',category:'Desserts',name_en:'Sample dessert',sort_order:0,quantity_needed:1,active:true});
   items.push({id:'first-example',category:'Main dishes',name_en:'First dish',sort_order:0,quantity_needed:1,active:true});
 });
 await refreshFixture(page);
 await page.waitForFunction(()=>document.querySelectorAll('.food-compact-item').length===3);
 const foodOrder=await page.locator('.food-compact-item').evaluateAll(items=>items.map(item=>item.dataset.treeKey.slice('food:item:'.length)));
 await page.locator('[data-tab="language"]').click();
 await selectContentTranslation(page,'food');
 const translationGrid=page.locator('#foodTranslationGrid'); let grid=translationGrid;
 const selectCard=async(title)=>{assert.ok((await translationGrid.locator('h3').allTextContents()).includes(title),title+' in '+JSON.stringify(await translationGrid.locator('h3').allTextContents()));const card=translationGrid.locator('.translation-record-card').filter({has:page.locator('h3').filter({hasText:title})});await openBox(page,await card.locator('[data-local-edit]').getAttribute('data-local-edit'));grid=card;};
 assert.deepEqual(await translationGrid.locator('.translation-record-card').evaluateAll(cards=>cards.map(card=>card.dataset.translationRecord.slice(5))),foodOrder);
 await translationGrid.getByLabel('Food categories',{exact:true}).selectOption('category:Desserts');
 assert.equal(await translationGrid.locator('[data-translation-record="food:dessert-example"]').count(),1);
 await translationGrid.getByLabel('Food categories',{exact:true}).selectOption('category:Main dishes');
 await selectCard('Sample dish');

 await openBox(page,await grid.locator('[data-local-edit]').first().getAttribute('data-local-edit'));
 assert.equal(await grid.locator('.food-translation-row').count(),3);
 for(const row of await grid.locator('.food-translation-row').all())assert.equal(await row.getByRole('textbox').count(),2);
 if(process.env.RSVP_LAYOUT_PREVIEW&&type.name()==='chromium')await page.locator('[data-panel="language"]').screenshot({path:process.env.RSVP_LAYOUT_PREVIEW+'/food-language-grid.png'});
 await grid.locator('.food-translation-row input').first().fill('Updated sample dish');
 await grid.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>window.__savedTranslations?.p_changes.length===1&&!document.querySelector('#foodTranslationGrid form[aria-busy]'));
 await selectContentTranslation(page,'food-types');
 const typeKeys=await translationGrid.locator('.translation-record-card').evaluateAll(cards=>cards.map(card=>card.dataset.translationRecord));
 for(const name of ['Batches','Pieces','Trays','Packets','kg','Grams'])assert.ok(typeKeys.includes('ui:'+name));
 assert.deepEqual(await page.evaluate(()=>window.RSVP.foodTypes),['Batch(s)','Piece(s)','Tray(s)','Packet(s)','Kg','Grams'],'Persisted unit identities stay unchanged');
 assert.ok(typeKeys.includes('ui:Food type: Basket(s)'));
 await selectCard('Trays');
 assert.equal(await grid.locator('.food-type-translation-row').count(),3);
 assert.equal(await grid.getByLabel('Unit · English',{exact:true}).inputValue(),'Trays');
 if(process.env.FOOD_LANGUAGE_PREVIEW&&type.name()==='chromium')await page.locator('[data-panel="language"]').screenshot({path:process.env.FOOD_LANGUAGE_PREVIEW+'/language-food-types-category.png'});
 await openBox(page,await grid.locator('[data-local-edit]').first().getAttribute('data-local-edit'));await grid.getByLabel('Unit · English',{exact:true}).fill('Baking trays');
 await grid.getByLabel('Unit · Deutsch',{exact:true}).fill('Backbleche');
 await grid.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>window.__savedTypeTranslations?.length===2&&!document.querySelector('#foodTranslationGrid form[aria-busy]'));
 assert.deepEqual(await page.evaluate(()=>window.__savedTypeTranslations.map(row=>row.p_language)),['en','de']);
 const sections=[
  {category:'food-category',picker:'Food categories',label:'Main dishes',fields:1,source:'Main dishes',edits:[['fo',0,'Maturflokkur'],['de',0,'Hauptgerichte']]},
  {category:'venue',picker:'Venue',label:'Main hall',fields:3,source:'Main hall',edits:[['fo',0,'Høvuðshøll'],['fo',1,'Vælkomin í nýggju høllina'],['de',2,'Bitte den Haupteingang benutzen']]},
  {category:'session',picker:'Session',label:'Dinner',fields:2,source:'Dinner',edits:[['de',0,'Abendessen'],['de',1,'Bitte früh ankommen']]}
 ];
 for(const section of sections){
  await selectContentTranslation(page,section.category);
  await selectCard(section.label);
  assert.equal(await page.locator('#translationLanguage').count(),0,'no separate language selector');
  await openBox(page,await grid.locator('[data-local-edit]').first().getAttribute('data-local-edit'));
 assert.equal(await grid.locator('.food-translation-row').count(),3);
  for(const row of await grid.locator('.food-translation-row').all()){
   assert.equal(await row.getByRole('textbox').count(),section.fields);
   const tops=await row.getByRole('textbox').evaluateAll(fields=>fields.map(field=>field.getBoundingClientRect().top));
   assert.ok(tops.every((top,index)=>!index||top>tops[index-1]),'fields stack within each language column');
   for(const label of await row.locator('label').all()){
    // Smooth scrolling can move the page between separate boundingBox calls.
    // Read both rectangles in one frame so this checks layout rather than scroll timing.
    const {caption,box}=await label.evaluate(node=>({caption:node.querySelector(':scope > span').getBoundingClientRect().toJSON(),box:node.querySelector('input,textarea').getBoundingClientRect().toJSON()}));
    assert.ok(caption.y+caption.height<=box.y+1,'caption sits above its box '+section.category+' '+JSON.stringify({caption,box}));
   }
  }
  assert.equal(await grid.locator('[data-language-code="en"]').getByRole('textbox').first().inputValue(),section.source);
  const before=await page.evaluate(()=>(window.__batchTranslationSaves||[]).length);
  for(const [language,index,value] of section.edits)await grid.locator('[data-language-code="'+language+'"]').getByRole('textbox').nth(index).fill(value);
  assert.equal(await page.evaluate(()=>(window.__batchTranslationSaves||[]).length),before,'typing does not save');
  await grid.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#foodTranslationGrid form[aria-busy]'));
  const batchSaves=await page.evaluate(()=>window.__batchTranslationSaves);
  assert.equal(batchSaves.length,before+1,'one atomic request');
  assert.equal(batchSaves.at(-1).p_changes.length,section.edits.length);
  await openBox(page,await grid.locator('[data-local-edit]').first().getAttribute('data-local-edit'));
  for(const [language,index,value] of section.edits)assert.equal(await grid.locator('[data-language-code="'+language+'"]').getByRole('textbox').nth(index).inputValue(),value);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile editor width '+section.category+' '+JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(node=>({tag:node.tagName,id:node.id,cls:node.className,right:node.getBoundingClientRect().right})))));
  await page.setViewportSize({width:1024,height:768});
  if(process.env.CONTENT_LANGUAGE_PREVIEW&&type.name()==='webkit'){
   await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
   await page.locator('[data-panel="language"]').screenshot({path:process.env.CONTENT_LANGUAGE_PREVIEW+'/language-'+section.category+'-top-labels.png'});
  }
 }
 if(!await page.locator('#translationSearch').isVisible())await page.locator('#translationSearchToggle').click();
 await page.locator('#translationSearch').fill('zzzz-no-matching-record');
 grid=translationGrid;
 await grid.getByText('No matching entries.',{exact:true}).waitFor();
 assert.equal(await grid.locator('form').count(),0);
 await page.locator('#translationSearch').fill('');
 await page.waitForFunction(()=>document.querySelector('#foodTranslationGrid .translation-record-card'));
 await selectCard('Dinner');

 await grid.locator('.local-editor-open form').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await grid.locator('[data-language-code="en"]').getByRole('textbox').count(),0);
 assert.ok(await grid.locator('.local-editor-summary').isVisible());

 await selectContentTranslation(page,'food');
 if(process.env.FOOD_LANGUAGE_PREVIEW&&type.name()==='chromium')await page.locator('[data-panel="language"]').screenshot({path:process.env.FOOD_LANGUAGE_PREVIEW+'/language-food-category-picker.png'});
 await selectContentTranslation(page,'welcome');
 assert.equal(await page.locator('#foodTranslationGrid textarea').count(),3);
 await openWordingEditor(page,'en','interface.messages.save');
 assert.equal(await page.locator('#contentTranslationTabs').isVisible(),false);
 if(process.env.SETTINGS_PREVIEW&&type.name()==='chromium')await page.locator('#translationEditor').screenshot({path:process.env.SETTINGS_PREVIEW+'/settings-language-preview.png'});
 await page.locator('#mainSectionToggle').click();
 await selectWorkTab(page,'venues');
 const venueTab=page.locator('[data-venue-tab="venues"]'),sessionTab=page.locator('[data-venue-tab="sessions"]');
 await sessionTab.click();
 const sessionRow=page.locator('#sessionsList > details').first();
 assert.equal(await sessionRow.evaluate(node=>node.open),false);
 assert.ok(await sessionRow.getByText('Main hall · Unscheduled · Atlantic/Faroe · RSVP required',{exact:true}).isVisible());
 assert.equal(await sessionRow.getByRole('link',{name:/Map link/}).count(),0);
 await page.evaluate(()=>window.__fixtures.event_sessions.push({id:'session-later',name:'Later session',session_key:'later',sort_order:2,location_id:'venue-1',is_active:true,requires_rsvp:false}));
 await refreshFixture(page);
 await page.waitForFunction(()=>document.querySelectorAll('#sessionsList > details').length===2);
 assert.ok(await sessionRow.getByRole('button',{name:'Move session up'}).isDisabled());
 await sessionRow.getByRole('button',{name:'Move session down'}).click();
 await sessionRow.locator(':scope > summary').getByText('Later session',{exact:true}).waitFor();
 assert.equal(await sessionRow.evaluate(node=>node.open),false);

 if(process.env.SETTINGS_PREVIEW&&type.name()==='chromium')await page.locator('[data-panel="venues"]').screenshot({path:process.env.SETTINGS_PREVIEW+'/settings-sessions.png'});
 await venueTab.click();
 const venue=page.locator('#venueList details').filter({hasText:'Main hall'});
 assert.equal(await venue.evaluate(d=>d.open),false);
 assert.ok(await venue.locator(':scope > summary').getByText('12 Example Street',{exact:false}).isVisible());
 assert.equal(await venue.getByRole('link',{name:'Map & directions · Main hall',exact:true}).getAttribute('href'),'https://maps.example.invalid/main-hall');
 if(process.env.SETTINGS_PREVIEW&&type.name()==='chromium')await page.locator('#venueList').screenshot({path:process.env.SETTINGS_PREVIEW+'/settings-venues-preview.png'});
 await venue.locator(':scope > summary').evaluate(summary=>summary.parentElement.open=true);if(!await venue.locator('form.reading-editor').isVisible())await venue.locator('[data-record-pencil]').click();
 assert.equal(await venue.getByRole('button',{name:'Add households',exact:true}).count(),0);
 await page.evaluate(()=>{window.__fixtures.food_items.find(item=>item.id==='dessert-example').venue_ids=['venue-2'];});
 await refreshFixture(page);
 await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
 await venue.locator(':scope > summary').evaluate(summary=>summary.parentElement.open=true);if(!await venue.locator('form.reading-editor').isVisible())await venue.locator('[data-record-pencil]').click();
 const workspace=page.locator('.venue-workspace');
 const manageFood=venue.getByRole('button',{name:'Manage food',exact:true});
 assert.equal(await manageFood.getAttribute('aria-haspopup'),'dialog');
 const foodDialog=page.getByRole('dialog',{name:'Venue food · Main hall',exact:true});
 const venuesHeight=await workspace.evaluate(node=>node.offsetHeight);
 await manageFood.click();
 await assertAssignmentModal(foodDialog,workspace,venuesHeight);
 await foodDialog.getByRole('checkbox',{name:'First dish',exact:true}).uncheck();
 await foodDialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await foodDialog.waitFor({state:'detached'});
 await page.waitForFunction(node=>document.activeElement===node,await manageFood.elementHandle());
 assert.equal(await page.evaluate(()=>Boolean(window.__venueFood)),false,'Cancel does not write venue food assignments');
 await manageFood.click();
 assert.deepEqual(await foodDialog.locator('legend').allTextContents(),['Main dishes','Desserts']);
 assert.deepEqual(await foodDialog.getByRole('group',{name:'Main dishes'}).locator('label').allTextContents(),['First dish','Sample dish']);
 assert.ok(await foodDialog.getByRole('checkbox',{name:'First dish',exact:true}).isChecked());
 await foodDialog.getByRole('checkbox',{name:'First dish',exact:true}).uncheck();
 await foodDialog.getByRole('checkbox',{name:'Sample dessert',exact:true}).check();
 if(process.env.SETTINGS_PREVIEW&&type.name()==='chromium')await foodDialog.screenshot({path:process.env.SETTINGS_PREVIEW+'/venue-manage-food-categories.png'});
 await page.evaluate(()=>{
   const write=window.__managementRpc;
   window.__managementRpc=(name,args)=>{
     if(name!=='admin_edit_venue_food')return write(name,args);
     window.__managementRpc=write;
     return {error:{message:'Simulated venue food save failure'}};
   };
 });
 const saveFood=foodDialog.getByRole('button',{name:'Save',exact:true});
 await saveFood.click();
 await foodDialog.getByRole('status').getByText('Simulated venue food save failure',{exact:true}).waitFor();
 assert.equal(await foodDialog.getByRole('checkbox',{name:'First dish',exact:true}).isChecked(),false);
 assert.equal(await foodDialog.getByRole('checkbox',{name:'Sample dessert',exact:true}).isChecked(),true);
 await saveFood.click();
 await foodDialog.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.activeElement?.getAttribute('data-record-pencil')==='venue:venue-1');
 assert.deepEqual(await page.evaluate(()=>window.__venueFood.p_add),['dessert-example']);
 assert.deepEqual(await page.evaluate(()=>window.__venueFood.p_remove),['first-example']);
 assert.deepEqual(await page.evaluate(()=>window.__fixtures.food_items.find(item=>item.id==='first-example').venue_ids),['venue-2']);
 await venue.locator(':scope > summary').evaluate(summary=>summary.parentElement.open=true);if(!await venue.locator('form.reading-editor').isVisible())await venue.locator('[data-record-pencil]').click();
 await venue.getByRole('button',{name:'Manage food',exact:true}).click();
 await foodDialog.getByRole('checkbox',{name:'Select all',exact:true}).check();
 await foodDialog.getByRole('checkbox',{name:'Select all',exact:true}).uncheck();
 assert.ok(await foodDialog.getByRole('button',{name:'Save',exact:true}).isEnabled());
 await foodDialog.getByRole('button',{name:'Save',exact:true}).click();
 await foodDialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.__venueFood.p_add.length),0);
 assert.equal(await page.evaluate(()=>window.__venueFood.p_remove.length),2);
 await page.evaluate(()=>{
   const f=window.__fixtures;
   for(const household of [f.households[0],f.households[2]])f.guests.push({id:'guest-'+household.id,household_id:household.id,first_name:'Sample',language:'en'});
   f.guest_session_overrides.push({guest_id:f.guests[0].id,session_id:f.event_sessions[0].id,is_invited:true});
 });
 await refreshFixture(page);
 await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);
 await sessionTab.click();
 const dinner=page.locator('#sessionsList > details').filter({hasText:'Dinner'});
 await dinner.locator(':scope > summary').click();if(!await dinner.locator('form.reading-editor').isVisible())await dinner.locator('[data-record-pencil]').click();
 const manageHouseholds=dinner.getByRole('button',{name:'Manage households',exact:true});
 assert.equal(await manageHouseholds.getAttribute('aria-haspopup'),'dialog');
 const householdDialog=page.getByRole('dialog',{name:'Manage households · Dinner',exact:true});
 const sessionsHeight=await workspace.evaluate(node=>node.offsetHeight);
 await manageHouseholds.press('Enter');
 await assertAssignmentModal(householdDialog,workspace,sessionsHeight);
 await page.setViewportSize({width:390,height:844});
 await assertAssignmentModal(householdDialog,workspace);
 await page.setViewportSize({width:820,height:1180});
 await page.keyboard.press('Escape');
 await householdDialog.waitFor({state:'detached'});
 await page.waitForFunction(node=>document.activeElement===node,await manageHouseholds.elementHandle());
 await manageHouseholds.press('Enter');
 const protectedRow=householdDialog.getByRole('checkbox',{name:/Example parent/});
 assert.ok(await protectedRow.isDisabled());
 assert.ok(await protectedRow.isChecked());
 const selectAllHouseholds=householdDialog.getByRole('checkbox',{name:'Select all',exact:true});
 await selectAllHouseholds.check();
 await selectAllHouseholds.uncheck();
 assert.ok(await protectedRow.isChecked());
 await householdDialog.getByRole('checkbox',{name:/Example hill family/}).check();
 assert.ok(await householdDialog.getByText('Guest exceptions',{exact:true}).isVisible());
 if(process.env.SESSION_PREVIEW&&type.name()==='chromium')await householdDialog.screenshot({path:process.env.SESSION_PREVIEW+'/session-manage-households.png'});
 await householdDialog.getByRole('button',{name:'Save',exact:true}).click();
 await householdDialog.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.__sessionHouseholds.p_add),['33333333-3333-4333-8333-333333333333']);
 assert.deepEqual(await page.evaluate(()=>window.__sessionHouseholds.p_remove),['22222222-2222-4222-8222-222222222222']);
 await page.locator('#settingsToggle').click();
 await page.locator('[data-settings-tab="administrators"]').click();
 const admin=page.locator('#adminList .admin-member').first();
 await admin.getByRole('button',{name:/^Edit access/}).click();
 const adminEditor=page.locator('#adminList .permission-editor');
 await adminEditor.getByLabel('Display name',{exact:true}).fill('Updated example admin');
 if(process.env.ADMIN_NAME_PREVIEW&&type.name()==='chromium')await admin.screenshot({path:process.env.ADMIN_NAME_PREVIEW+'/administrator-name-edit.png'});
 await adminEditor.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.inline-confirmation [data-inline-confirm]').click();
 await admin.getByText('Updated example admin',{exact:true}).waitFor();
 assert.ok(await admin.getByText('test-admin@example.invalid',{exact:true}).isVisible());
 await page.locator('#mainSectionToggle').click();await selectWorkTab(page,'other');assert.equal(await page.locator('.other-line').count(),1);assert.equal(await page.locator('.other-line input').first().isDisabled(),true);assert.equal(await page.locator('.other-line-summary input').count(),0,'plain text summaries');
 await page.locator('.other-category > summary').first().getByRole('button',{name:'Add item',exact:true}).click();const added=page.locator('.other-line[data-new-item="true"]');await added.locator('input').first().fill('Bring tablecloths');await added.locator('textarea').fill('Remember linen');await added.locator('input').nth(1).fill('Another helper');await added.getByRole('button',{name:/^Save$/}).click();await page.waitForFunction(()=>window.__savedOther&&document.querySelectorAll('.other-line')[1].querySelector('input').disabled);assert.equal(await page.evaluate(()=>window.__savedOther.p_values.notes),'Remember linen');
 if(process.env.PREVIEW_OUTPUT)await page.locator('[data-panel="other"]').screenshot({path:process.env.PREVIEW_OUTPUT+'/other-draft.png'});
 await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)){console.error(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('[data-panel="other"], [data-panel="other"] .panel, #otherRows,.other-category,.other-category-body,.other-line,.other-add-controls,#otherNewCategory')].map(n=>({class:n.className,id:n.id,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right,scroll:n.scrollWidth,min:getComputedStyle(n).minWidth,overflow:getComputedStyle(n).overflowX}))})));}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'Other lines fit within mobile category scroll');
 assert.deepEqual(errors,[]);await page.close();
 const guest=await browser.newPage();
 const guestMock=mock+`\nconst publicRpc=client.rpc;client.rpc=async(name,args)=>name.startsWith('get_public_event')?{data:{event:{event_name:'Example',default_language:'en',timezone:'UTC'},content:{},sessions:[]}}:publicRpc(name,args);let mine=0;const items=[{id:'dish',name_en:'Cake',description_en:'Bring chilled',recipe_text:${JSON.stringify(recipeText)},quantity_needed:2,claimed_total:0}];client.functions={invoke:async(name,request)=>{const a=request.body.action,p=request.body.params||request.body.args||{};if(a==='get_invitation_v2')return {data:{household:{name:'Example household',language:'en',rsvp_state:'open'},guests:[{id:'g',first_name:'Example'}],invitations:[]}};if(a==='get_household_food')return {data:{items,claims:mine?[{food_item_id:'dish',quantity:mine}]:[]}};if(a==='set_household_food_claim'){window.__pick=request.body;mine=1;items[0].claimed_total=1;return {data:null};}return {data:null};}};`;
 await guest.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:guestMock}));await guest.goto('http://127.0.0.1:'+server.address().port+'/?ABCDEFGH');await guest.locator('#foodCard:not(.hidden)').waitFor();
 assert.equal(await guest.locator('#foodList input[type=number]').count(),1);assert.equal(await guest.locator('#foodList input[type=number]').inputValue(),'1');assert.equal(await guest.locator('#foodList input[type=number]').getAttribute('max'),'2');assert.match(await guest.locator('.food-availability').textContent(),/Needed: 2.*Still available: 2/);await guest.locator('.guest-food-information > summary').click();assert.ok((await guest.locator('.guest-food-note').textContent()).includes('Bring chilled'));await guest.getByRole('button',{name:'Recipe',exact:true}).click();assert.equal(await guest.locator('.recipe-content li').count(),2);await guest.evaluate(()=>{window.print=()=>{window.__recipePrint=document.querySelector('.recipe-print-view').textContent;window.dispatchEvent(new Event('afterprint'));};});await guest.getByRole('button',{name:'Print',exact:true}).click();assert.match(await guest.evaluate(()=>window.__recipePrint),/^CakeMelt:360g dark chocolate300g butterStir well$/);if(process.env.PREVIEW_OUTPUT)await guest.locator('#foodCard').screenshot({path:process.env.PREVIEW_OUTPUT+'/food-guest-draft.png'});await guest.getByRole("region").getByRole('button',{name:'Close',exact:true}).click();await guest.locator('.guest-food-choice>button').click();await guest.waitForFunction(()=>window.__pick);const pick=await guest.evaluate(()=>window.__pick);assert.equal((pick.params||pick.args||pick).p_quantity,1);await guest.close();
 console.log('PASS '+type.name()+': compact food, private/public comments, scoped translations, task sheet and guest quantity controls with one-unit default.');
}finally{await browser.close();}}
server.listen(0,'127.0.0.1',async()=>{try{await run(chromium);if(process.env.RSVP_TEST_BROWSER!=='chromium')await run(webkit);}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});

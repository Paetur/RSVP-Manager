// Actual UI with synthetic APIs, backups and decisions only.
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createFoodHarness}=require("./helpers/food-browser-harness.cjs");
const {reopenDatabaseAfterRecovery}=require("./helpers/admin-toolbar.cjs");
const {server,mock,extra}=createFoodHarness("inline-restore");
const seed=`
window.__replacementCalls=JSON.parse(sessionStorage.getItem('syntheticReplacementCalls')||'[]');
fixtures.event_settings[0].is_published=false;
fixtures.event_locations=[{id:'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',name:'Sample venue',timezone:'UTC',sort_order:0}];
fixtures.food_items[0].recipe_text='Ingredients:\\nPotatoes and herbs.\\nRoast until golden.';
const recoveryFile={format:'rsvp-application-backup',version:2,checksum:'synthetic',payload:{installation_id:'synthetic-origin',selection:{mode:'backup',sections:['venues','households','food','other','wording'],include_logs:true},tables:{'public.event_settings':[{event_name:'Sample recovery'}]}}};
window.__recoveryFile=recoveryFile;
const inlineRpc=client.rpc;client.rpc=async(name,args)=>{
 if(['admin_preview_event_replacement','admin_prepare_event_replacement','admin_replace_event_data','admin_preview_wipe','admin_prepare_wipe','admin_wipe_restore','admin_restore_backup'].includes(name)){
  window.__replacementCalls.push({name,args});
  sessionStorage.setItem('syntheticReplacementCalls',JSON.stringify(window.__replacementCalls));
 }
 if(name==='admin_preview_wipe'&&window.__holdWipePreview)
   await new Promise(resolve=>window.__releaseWipePreview=resolve);
 if(['admin_preview_event_replacement','admin_preview_wipe'].includes(name))return {data:{can_restore:!(name==='admin_preview_wipe'&&window.__denyWipe),reason:window.__denyWipe?'Synthetic wipe validation refused':'',counts:{'public.households':3},current_counts:{'public.households':4},event_name:'Sample recovery',destination_state:'checked-state'}};
 if(name==='admin_prepare_wipe'&&window.__failSafety)return {error:{message:'Synthetic safety download failed'}};
 if(['admin_prepare_event_replacement','admin_prepare_wipe'].includes(name))return {data:{token:'safety-token',safety_backup:recoveryFile}};
 if(name==='admin_wipe_restore')return {data:{restored:true}};
 if(name==='admin_replace_event_data'){if(window.__replaceFail){window.__replaceFail=false;return {error:{message:'Destination changed; validate the backup again'}};}return {data:{event_data_replaced:true}};}
 return inlineRpc(name,args);
};`;
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));const base=process.env.RSVP_TEST_BASE_URL||"http://127.0.0.1:"+server.address().port;
 const output=process.env.RSVP_INLINE_ARTIFACTS||path.join(process.cwd(),"artifacts","inline-restore");fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch();try{
  for(const width of [320,390,1160]){
   const p=await browser.newPage({viewport:{width,height:1000}}),errors=[],native=[];
   p.on("pageerror",e=>errors.push(e.message));p.on("dialog",d=>{native.push(d.message());d.dismiss()});
   await p.addInitScript(()=>localStorage.setItem("rsvp-interface-language","en"));
   await p.route("**/supabase.min.js",r=>r.fulfill({contentType:"text/javascript",body:mock+"\n"+extra+"\n"+seed}));
   await p.route("**/js/config.js?*",r=>r.fulfill({contentType:"text/javascript",body:'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};'}));
   await p.route("**/admin/",async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace(/ integrity="[^"]+"/g,"")})});
   await p.goto(base+"/admin/");await p.waitForFunction(()=>document.querySelectorAll("#statsGrid .stat-card").length===4);
   await p.locator('[data-tab="food"]').click();
   await p.evaluate(()=>{window.__decision=null;window.RSVP_INLINE.confirm('Delete the synthetic record?',{action:'Delete',trigger:document.getElementById('addFoodType')}).then(v=>window.__decision=v)});
   const decision=p.locator('.inline-confirmation');await decision.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await p.evaluate(()=>window.__decision),false);
   await p.locator('#addFoodType').click();const units=p.locator('.inline-editor-panel').last();await units.waitFor();
   assert.equal(await units.evaluate(n=>n.tagName),'SECTION');assert.equal(await units.evaluate(n=>!!n.closest('[data-panel="food"]')),true,'units stay within Food');
   await units.getByRole('button',{name:'Close',exact:true}).click();
   await p.locator('#settingsToggle').click();await p.locator('[data-settings-tab="placeholders"]').click();
   assert.equal(await p.locator('#placeholderReference').getByText('{rsvp_deadline}',{exact:true}).isVisible(),true);assert.equal(await p.locator('#placeholderReference').getByText('{organizer_email}',{exact:true}).isVisible(),true);
   await p.locator('[data-settings-tab="backups"]').click();
   await p.locator('#backupFile').setInputFiles({name:'sample.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await p.evaluate(()=>window.__recoveryFile)))});
   await p.locator('#backupRestoreDestination').selectOption('replace');await p.locator('#previewBackup').click();
   await p.locator('#backupPreview').getByText('4 → 3',{exact:false}).waitFor();
   const replace=p.locator('#restoreBackupButton');assert.equal(await replace.isDisabled(),true);
   assert.equal(await p.locator('#restoreBackupConfirmation').count(),0,'restore requires no typed confirmation');
   assert.equal(await replace.isDisabled(),true,'safety step required');
   const download=p.waitForEvent('download');await p.locator('#prepareReplacementSafety').click();await download;
   assert.equal(await replace.isEnabled(),true);await replace.click();
   assert.equal(await decision.getByText('Are you really sure. This can NOT be undone',{exact:true}).isVisible(),true);
   await decision.getByRole('button',{name:'No',exact:true}).click();
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').length),0,'No does not restore');
   assert.equal(await replace.isEnabled(),true,'No retains validation and safety receipt');
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','No stays in Database');
   await p.evaluate(()=>window.__replaceFail=true);await replace.click();
   await decision.getByRole('button',{name:'Yes',exact:true}).click();
   await p.locator('#backupPreview').getByText('Destination changed; validate the backup again',{exact:true}).waitFor();assert.equal(await replace.isDisabled(),true,'failed/stale replacement invalidates receipt');
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','a failed replacement stays in Database');
   await p.locator('#previewBackup').click();const retry=p.waitForEvent('download');await p.locator('#prepareReplacementSafety').click();await retry;
   await replace.click();await decision.getByRole('button',{name:'Yes',exact:true}).click();
   await reopenDatabaseAfterRecovery(p);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').length),2);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.some(x=>x.name==='admin_restore_backup')),false,'replace uses its dedicated endpoint');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').at(-1).args.p_confirmation),'REPLACE Sample recovery');
   const wipeMode=p.locator('#backupRestoreMode input[value="wipe"]'), safety=p.locator('#prepareReplacementSafety');
   await wipeMode.check();
   assert.equal(await safety.isDisabled(),true,'a Full backup file is required');
   assert.equal(await p.locator('#previewBackup').isVisible(),false);
   assert.equal(await replace.isVisible(),false,'Wipe and restore starts hidden');
   await p.locator('#backupFile').setInputFiles({name:'sample.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await p.evaluate(()=>window.__recoveryFile)))});
   await p.locator('#prepareReplacementSafety:enabled').waitFor();
   assert.equal(await wipeMode.isChecked(),true,'choosing a Full file keeps Wipe selected');
   assert.equal(await p.locator('#backupRestoreLogsHelp').isVisible(),false);

   await p.evaluate(()=>{window.__holdWipePreview=true;window.__denyWipe=true;});
   await safety.click();
   await p.waitForFunction(()=>typeof window.__releaseWipePreview==='function');
   await p.locator('#backupRestoreMode input[value="backup"]').check();await wipeMode.check();
   await p.evaluate(()=>{window.__holdWipePreview=false;window.__releaseWipePreview();});
   await p.locator('#prepareReplacementSafety:enabled').waitFor();
   assert.equal(await p.locator('#backupPreview').innerText(),'','a mode change discards pending validation');
   assert.equal(await replace.isVisible(),false);

   await safety.click();
   await p.locator('#backupPreview').getByText('Synthetic wipe validation refused',{exact:false}).waitFor();
   assert.equal(await replace.isVisible(),false);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_prepare_wipe').length),0);

   await p.evaluate(()=>{window.__denyWipe=false;window.__failSafety=true;});
   await safety.click();
   await p.locator('#replacementSafetyStatus').getByText('Synthetic safety download failed',{exact:true}).waitFor();
   assert.equal(await replace.isVisible(),false,'failed safety preparation keeps final action hidden');
   await p.evaluate(()=>{window.__failSafety=false;});
   const wipeSafety=p.waitForEvent('download');await safety.click();await wipeSafety;
   await p.locator('#backupPreview').getByText('4 → 3',{exact:false}).waitFor();
   await replace.waitFor({state:'visible'});
   const preparation=await p.evaluate(()=>window.__replacementCalls.slice(-2));
   assert.deepEqual(preparation.map(x=>x.name),['admin_preview_wipe','admin_prepare_wipe']);
   assert.equal(preparation[1].args.p_expected_state,'checked-state');
   await replace.click();await decision.getByRole('button',{name:'No',exact:true}).click();
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_wipe_restore').length),0);
   assert.equal(await replace.isEnabled(),true);
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','No stays in Database for Wipe restore');
   await replace.click();await decision.getByRole('button',{name:'Yes',exact:true}).click();
   await reopenDatabaseAfterRecovery(p);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.find(x=>x.name==='admin_wipe_restore').args.p_confirmation),'WIPE Sample recovery');
   assert.equal(await p.locator('#backupRestoreMode input[value="backup"]').isChecked(),true,'Full is the default restore mode after reload');
   assert.equal(await p.locator('#backupRestoreDestination').inputValue(),'clean');
   assert.equal(await p.locator('#prepareReplacementSafety').isVisible(),false);
   assert.equal(await p.locator('dialog').count(),0,'no modal dialog elements');
   for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await p.screenshot({path:path.join(output,`${width}-${theme}-backups.png`),fullPage:true})}
   assert.deepEqual(errors,[]);assert.deepEqual(native,[]);await p.close();
  }
  console.log('PASS inline Cancel and record ownership, scoped placeholder reference, separate replacement endpoint/safety download/Yes/No confirmation without typing/stale retry and Wipe restore, default Main and Settings tabs after successful recovery, retained clean restore and phone/theme fit without native popups.');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});

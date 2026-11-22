// Actual UI with synthetic APIs, backups and decisions only.
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createFoodHarness}=require("./helpers/food-browser-harness.cjs");
const {reopenDatabaseAfterRecovery,selectDatabaseTab}=require("./helpers/admin-toolbar.cjs");
const {server,mock,extra}=createFoodHarness("inline-restore");
const seed=`
window.__replacementCalls=JSON.parse(sessionStorage.getItem('syntheticReplacementCalls')||'[]');
fixtures.event_settings[0].is_published=false;
fixtures.event_locations=[{id:'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',name:'Sample venue',timezone:'UTC',sort_order:0}];
fixtures.food_items[0].recipe_text='Ingredients:\\nPotatoes and herbs.\\nRoast until golden.';
const recoveryFile={format:'rsvp-application-backup',version:3,checksum:'synthetic',payload:{installation_id:'synthetic-origin',selection:{mode:'backup',sections:['venues','households','food','other','wording'],include_logs:true},tables:{'public.event_settings':[{event_name:'Sample recovery'}]}}};
window.__recoveryFile=recoveryFile;
const planningFile={...recoveryFile,checksum:'synthetic-planning',payload:{...recoveryFile.payload,
 installation_id:'synthetic-source',selection:{mode:'template',sections:['households','language_text','drafts'],include_logs:false},
 tables:{'public.event_settings':[{event_name:'Sample planning'}]}}};
window.__planningFile=planningFile;
const inlineRpc=client.rpc;client.rpc=async(name,args)=>{
 if(['admin_preview_event_replacement','admin_prepare_event_replacement','admin_replace_event_data','admin_preview_wipe','admin_prepare_wipe','admin_wipe_restore','admin_restore_backup','admin_preview_planning_restart','admin_prepare_planning_restart','admin_restart_planning'].includes(name)){
  window.__replacementCalls.push({name,args});
  sessionStorage.setItem('syntheticReplacementCalls',JSON.stringify(window.__replacementCalls));
 }
 if(name==='admin_preview_wipe'&&window.__holdWipePreview)
   await new Promise(resolve=>window.__releaseWipePreview=resolve);
 if(name==='admin_prepare_wipe'&&window.__holdWipeSafety)
   await new Promise(resolve=>window.__releaseWipeSafety=resolve);
 if(['admin_preview_event_replacement','admin_preview_wipe'].includes(name))return {data:{can_restore:!(name==='admin_preview_wipe'&&window.__denyWipe),reason:window.__denyWipe?'Synthetic wipe validation refused':'',counts:{'public.households':3},current_counts:{'public.households':4},event_name:'Sample recovery',destination_state:'checked-state'}};
 if(name==='admin_prepare_wipe'&&window.__staleWipeSafety)return {error:{message:'Destination changed; validate the backup again'}};
 if(name==='admin_prepare_wipe'&&window.__failSafety)return {error:{message:'Synthetic safety download failed'}};
 if(['admin_prepare_event_replacement','admin_prepare_wipe'].includes(name))return {data:{token:'safety-token',safety_backup:recoveryFile}};
 if(name==='admin_preview_planning_restart')return {data:{can_restore:true,counts:{'public.households':3,'public.invitation_send_queue':0,'app_private.invitation_code_registry':0},
  current_counts:{'public.households':4,'public.invitation_send_queue':1,'app_private.invitation_code_registry':2},
  selection:{mode:'template',sections:['households','language_text'],include_logs:false},
  preserved_tables:['app_private.invitation_code_registry'],event_name:'Sample planning',destination_state:'planning-state'}};
 if(name==='admin_prepare_planning_restart')return {data:{token:'planning-safety-token',safety_backup:recoveryFile}};
 if(name==='admin_restart_planning')return {data:{restored:true}};
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
   let receivedDownloads=0;
   p.on('download',()=>receivedDownloads++);
   await p.addInitScript(()=>localStorage.setItem("rsvp-interface-language","en"));
   await p.route("**/supabase.min.js",r=>r.fulfill({contentType:"text/javascript",body:mock+"\n"+extra+"\n"+seed}));
   await p.route("**/js/config.js?*",r=>r.fulfill({contentType:"text/javascript",body:'window.RSVP_CONFIG={supabaseUrl:"http://127.0.0.1:54321",supabaseKey:"sb_publishable_synthetic"};'}));
   await p.route("**/admin/",async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace(/ integrity="[^"]+"/g,"")})});
   await p.goto(base+"/admin/");await p.waitForFunction(()=>document.querySelector("#inviteOverviewCounts .invite-stat-row"));
   await p.locator('[data-tab="food"]').click();
   await p.evaluate(()=>{window.__decision=null;window.RSVP_INLINE.confirm('Delete the synthetic record?',{action:'Delete',trigger:document.getElementById('addFoodType')}).then(v=>window.__decision=v)});
   const decision=p.locator('.inline-confirmation');await decision.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await p.evaluate(()=>window.__decision),false);
   await p.locator('#addFoodType').click();const units=p.locator('.inline-editor-panel').last();await units.waitFor();
   assert.equal(await units.evaluate(n=>n.tagName),'SECTION');assert.equal(await units.evaluate(n=>!!n.closest('[data-panel="food"]')),true,'units stay within Food');
   await units.getByRole('button',{name:'Close',exact:true}).click();
   await p.locator('#settingsToggle').click();await p.locator('[data-settings-tab="placeholders"]').click();
   assert.equal(await p.locator('#placeholderReference').getByText('{rsvp_deadline}',{exact:true}).isVisible(),true);assert.equal(await p.locator('#placeholderReference').getByText('{organizer_email}',{exact:true}).isVisible(),true);
   await p.locator('[data-settings-tab="backups"]').click();
   const backupTab=p.locator('#databaseTabBackup'), restoreTab=p.locator('#databaseTabRestore');
   assert.equal(await backupTab.getAttribute('aria-selected'),'true','Database opens on Backup');
   assert.equal(await p.locator('#databaseRestorePanel').isVisible(),false);
   await backupTab.focus();await p.keyboard.press('ArrowRight');
   assert.equal(await restoreTab.getAttribute('aria-selected'),'true','the right arrow opens Restore');
   assert.equal(await restoreTab.evaluate(tab=>tab===document.activeElement),true);
   const choices=p.locator('#backupRestoreDestination'), action=p.locator('#restoreBackupAction'),
     summary=p.locator('#backupPreview'), file=p.locator('#backupFile');
   const select=(value)=>choices.locator('input[value="'+value+'"]');
   const stage=(name)=>action.and(p.getByRole('button',{name,exact:true}));
   const upload=async(name,fixture)=>file.setInputFiles({
    name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await p.evaluate(key=>window[key],fixture))),
   });
   const choose=(name)=>decision.getByRole('button',{name,exact:true}).click();
   const downloadSafety=async()=>{
    const download=p.waitForEvent('download');
    await stage('Download safety backup').click();
    return download;
   };
   assert.equal(await p.locator('#backupRestoreMode').count(),0);
   assert.equal(await action.count(),1,'restore uses one action throughout');
   assert.equal(await stage('Validate backup').isDisabled(),true,'a file is required');
   await upload('sample.json','__recoveryFile');
   await select('replace').check();
   await stage('Validate backup').click();
   await summary.getByText('4 → 3',{exact:false}).waitFor();
   assert.equal(await stage('Replace event data').count(),0,'final action is hidden until a safety download');
   assert.equal(await p.locator('#restoreBackupConfirmation').count(),0,'restore requires no typed confirmation');
   await downloadSafety();
   await selectDatabaseTab(p,'backup');
   await selectDatabaseTab(p,'restore');
   assert.equal(await stage('Replace event data').isEnabled(),true,'switching tabs retains the file and safety receipt');
   await stage('Replace event data').click();
   assert.equal(await decision.getByText('Are you really sure. This can NOT be undone',{exact:true}).isVisible(),true);
   await choose('No');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').length),0,'No does not restore');
   assert.equal(await stage('Replace event data').isEnabled(),true,'No retains validation and safety receipt');
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','No stays in Database');
   await p.evaluate(()=>window.__replaceFail=true);
   await stage('Replace event data').click();
   await choose('Yes');
   await summary.getByText('Destination changed; validate the backup again',{exact:true}).waitFor();
   assert.equal(await stage('Validate backup').isEnabled(),true,'failed/stale replacement resets the action');
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','a failed replacement stays in Database');
   await stage('Validate backup').click();
   await downloadSafety();
   await stage('Replace event data').click();
   await choose('Yes');
   await reopenDatabaseAfterRecovery(p,'restore');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').length),2);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.some(x=>x.name==='admin_restore_backup')),false,'replace uses its dedicated endpoint');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').at(-1).args.p_confirmation),'REPLACE Sample recovery');

   await select('wipe').check();
   assert.equal(await stage('Validate backup').isDisabled(),true,'a Full backup file is required');
   await upload('sample.json','__recoveryFile');
   await stage('Validate backup').waitFor();
   assert.equal(await select('wipe').isChecked(),true,'choosing a Full file keeps Wipe selected');
   await p.evaluate(()=>{window.__holdWipePreview=true;window.__denyWipe=true;});
   await stage('Validate backup').click();
   await p.waitForFunction(()=>typeof window.__releaseWipePreview==='function');
   await select('clean').check();
   await select('wipe').check();
   await p.evaluate(()=>{window.__holdWipePreview=false;window.__releaseWipePreview();});
   await p.locator('#restoreBackupAction:enabled').waitFor();
   assert.equal(await summary.innerText(),'','a destination change discards pending validation');
   assert.equal(await stage('Validate backup').isEnabled(),true);

   await stage('Validate backup').click();
   await summary.getByText('Synthetic wipe validation refused',{exact:false}).waitFor();
   assert.equal(await stage('Validate backup').isEnabled(),true);
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_prepare_wipe').length),0);
   await p.evaluate(()=>{window.__denyWipe=false;window.__staleWipeSafety=true;});
   await stage('Validate backup').click();
   await stage('Download safety backup').click();
   await summary.getByText('Destination changed; validate the backup again',{exact:true}).waitFor();
   assert.equal(await stage('Validate backup').isEnabled(),true,'stale destination state requires fresh validation');
   await p.evaluate(()=>{window.__staleWipeSafety=false;window.__failSafety=true;});
   await stage('Validate backup').click();
   await stage('Download safety backup').click();
   await p.locator('#replacementSafetyStatus').getByText('Synthetic safety download failed',{exact:true}).waitFor();
   assert.equal(await stage('Download safety backup').isEnabled(),true,'failed safety preparation never exposes the final action');
   const downloadsBeforeSwitch=receivedDownloads;
   await p.evaluate(()=>{window.__failSafety=false;window.__holdWipeSafety=true;});
   await stage('Download safety backup').click();
   await p.waitForFunction(()=>typeof window.__releaseWipeSafety==='function');
   await select('clean').check();
   await select('wipe').check();
   await p.evaluate(()=>{window.__holdWipeSafety=false;window.__releaseWipeSafety();});
   await p.locator('#restoreBackupAction:enabled').waitFor();
   assert.equal(receivedDownloads,downloadsBeforeSwitch,'obsolete safety responses do not download a file');
   await stage('Validate backup').click();
   await downloadSafety();
   await summary.getByText('4 → 3',{exact:false}).waitFor();
   const preparation=await p.evaluate(()=>window.__replacementCalls.slice(-2));
   assert.deepEqual(preparation.map(x=>x.name),['admin_preview_wipe','admin_prepare_wipe']);
   assert.equal(preparation.at(-1).args.p_expected_state,'checked-state');
   await stage('Wipe and restore').click();
   await choose('No');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_wipe_restore').length),0);
   assert.equal(await stage('Wipe and restore').isEnabled(),true);
   assert.equal(await p.locator('[data-settings-tab="backups"]').getAttribute('aria-selected'),'true','No stays in Database for Wipe restore');
   await stage('Wipe and restore').click();
   await choose('Yes');
   await reopenDatabaseAfterRecovery(p,'restore');
   assert.equal(await p.evaluate(()=>window.__replacementCalls.find(x=>x.name==='admin_wipe_restore').args.p_confirmation),'WIPE Sample recovery');
   assert.equal(await select('clean').isChecked(),true,'Clean database is the destination after reload');
   assert.equal(await stage('Validate backup').isDisabled(),true,'a fresh file is required after reload');

   if(width===390){
    await select('restart').check();
    await upload('full.json','__recoveryFile');
    await p.locator('#backupFileType').and(p.getByText(/full backup/i)).waitFor();
    assert.equal(await select('restart').isDisabled(),true);
    assert.equal(await select('restart').isChecked(),true,'incompatible input does not silently change the destination');
    assert.equal(await stage('Validate backup').isDisabled(),true,'restart requires a Partial file');
    await upload('planning.json','__planningFile');
    await p.locator('#backupFileType').and(p.getByText(/partial backup/i)).waitFor();
    assert.equal(await select('replace').isDisabled(),true);
    assert.equal(await select('wipe').isDisabled(),true);
    await stage('Validate backup').click();
    await p.locator('#backupRestoreContents').getByText('Cleared planning sections: Venues & sessions, Food, Other, Invitation templates, Picture album',{exact:true}).waitFor();
    await summary.getByText('public.invitation_send_queue: 1 → 0',{exact:true}).waitFor();
    await summary.getByText('app_private.invitation_code_registry: 2 · Preserved',{exact:true}).waitFor();
    assert.equal(await stage('Restart planning from backup').count(),0,'restart requires a protected Full safety download');
    const saved=fs.readFileSync(await (await downloadSafety()).path());
    const envelope=JSON.parse(saved);
    assert.equal(envelope.payload.selection.mode,'backup');
    assert.equal(envelope.payload.selection.include_logs,true);
    await stage('Restart planning from backup').click();
    await choose('No');
    assert.equal(await p.evaluate(()=>window.__replacementCalls.some(x=>x.name==='admin_restart_planning')),false);
    await stage('Restart planning from backup').click();
    await choose('Yes');
    await reopenDatabaseAfterRecovery(p,'restore');
    const planningCalls=await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name.includes('planning')));
    assert.deepEqual(planningCalls.map(x=>x.name),['admin_preview_planning_restart','admin_prepare_planning_restart','admin_restart_planning']);
    assert.equal(planningCalls[1].args.p_expected_state,'planning-state');
    assert.equal(planningCalls[2].args.p_confirmation,'RESTART Sample planning');
    assert.equal(planningCalls[2].args.p_safety_token,'planning-safety-token');
    assert.equal(planningCalls[2].args.p_backup.checksum,'synthetic-planning');

    await file.setInputFiles({name:'full-safety.json',mimeType:'application/json',buffer:saved});
    await p.locator('#backupFileType').and(p.getByText(/full backup/i)).waitFor();
    await select('replace').check();
    await stage('Validate backup').click();
    await summary.getByText('4 → 3',{exact:false}).waitFor();
    await downloadSafety();
    await stage('Replace event data').click();
    await choose('Yes');
    await reopenDatabaseAfterRecovery(p,'restore');
    assert.equal(await p.evaluate(()=>window.__replacementCalls.filter(x=>x.name==='admin_replace_event_data').at(-1).args.p_backup.checksum),'synthetic');
   }
   assert.equal(await p.locator('dialog').count(),0,'no modal dialog elements');
   for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await p.screenshot({path:path.join(output,`${width}-${theme}-backups.png`),fullPage:true})}
   assert.deepEqual(errors,[]);assert.deepEqual(native,[]);await p.close();
  }
  console.log('PASS inline Cancel and record ownership, scoped placeholder reference, guarded Replace and Wipe, Restart planning and Full safety recovery, default Main and Settings tabs after successful recovery, retained clean restore and phone/theme fit without native popups.');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});

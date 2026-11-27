// Opt-in rehearsal for an empty disposable stack. Uses real Auth and Edge requests.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

function privateOrigin(value){
  const url=new URL(value);
  const local=/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9.-]+\.local)$/i.test(url.hostname);
  if(!local||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash){
    throw Error('Use an exact private test origin for both the site and Supabase API.');
  }
  return url.origin;
}

async function main(){
  const {RSVP_REHEARSAL_SITE,RSVP_REHEARSAL_API,RSVP_REHEARSAL_EMAIL,RSVP_REHEARSAL_PASSWORD,RSVP_REHEARSAL_DISPOSABLE}=process.env;
  if(RSVP_REHEARSAL_DISPOSABLE!=='yes'||![RSVP_REHEARSAL_SITE,RSVP_REHEARSAL_API,RSVP_REHEARSAL_EMAIL,RSVP_REHEARSAL_PASSWORD].every(Boolean)){
    throw Error('Set the RSVP_REHEARSAL_* variables and confirm an empty disposable stack with RSVP_REHEARSAL_DISPOSABLE=yes.');
  }
  const site=privateOrigin(RSVP_REHEARSAL_SITE),api=privateOrigin(RSVP_REHEARSAL_API);
  const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
  const context=await browser.newContext({viewport:{width:820,height:1180},hasTouch:true});
  const guestContext=await browser.newContext({viewport:{width:820,height:1180},hasTouch:true});
  for(const ctx of [context,guestContext]){
    await ctx.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
    await ctx.route('**/*',route=>{
      const origin=new URL(route.request().url()).origin;
      return [site,api,'https://cdn.jsdelivr.net'].includes(origin)?route.continue():route.abort();
    });
  }
  const admin=await context.newPage(),guest=await guestContext.newPage();
  guest.on('dialog',dialog=>dialog.accept());
  const rpc=(name,args={})=>admin.evaluate(async({name,args})=>{
    const {data,error}=await window.RSVP.adminRpc(name,args);
    if(error)throw Error(`${name}: ${error.message}`);
    return data;
  },{name,args});
  const settings=values=>admin.evaluate(async values=>{
    const {data,error}=await window.RSVP.getClient().from('event_settings').update(values).eq('id',1).select('is_published').single();
    if(error)throw Error(error.message);
    return data.is_published;
  },values);
  let publicationAttempted=false;
  try{
    await admin.goto(site+'/admin/');
    const configuredApi=await admin.evaluate(()=>window.RSVP.normalizeUrl(window.RSVP.config().supabaseUrl));
    assert.equal(configuredApi,api,'The site must use the explicitly selected disposable API');
    await admin.locator('#loginEmail').fill(RSVP_REHEARSAL_EMAIL);
    await admin.locator('#loginPassword').fill(RSVP_REHEARSAL_PASSWORD).catch(()=>{throw Error('Could not enter the test administrator password.');});
    await admin.locator('#loginForm button[type="submit"]').click();
    await admin.locator('#adminApp:not(.hidden)').waitFor();
    const baseline=await rpc('admin_load_data');
    assert.equal(baseline.settings.is_published,false);
    for(const collection of ['households','guests','locations','sessions','food','submissions','queue','deliveries']){
      assert.deepEqual(baseline[collection],[],collection+' must be empty');
    }
    const planningGroupId=baseline.settings.planning_config.groups[0].id;
    const venue=await rpc('admin_save_venue',{p_id:null,p_values:{name:'Rehearsal hall',timezone:'UTC'}});
    const session=await rpc('admin_save_session',{p_id:null,p_values:{name:'Rehearsal dinner',session_key:'rehearsal',location_id:venue}});
    const household=await rpc('admin_save_household',{p_id:null,p_values:{household_name:'Rehearsal household',planning_group_id:planningGroupId,language:'en'}});
    const person=await rpc('admin_save_guest_details',{p_guest_id:null,p_household_id:household,p_values:{first_name:'Example',last_name:'Guest',email:'rehearsal@example.invalid',preferred_contact_method:'email'}});
    await rpc('admin_set_household_primary_guest',{p_household_id:household,p_guest_id:person});
    await rpc('admin_set_food_access',{p_household_id:household,p_enabled:true,p_expected:false,p_reason:'Disposable rehearsal'});
    await rpc('admin_save_session_assignments',{p_household_id:household,p_assignments:[{session_id:session,is_invited:true}]});
    await admin.evaluate(async()=>{
      const {error}=await window.RSVP.getClient().from('food_items').insert({name_en:'Rehearsal cake',quantity_needed:2,active:true});
      if(error)throw Error(error.message);
    });
    assert.equal((await rpc('admin_load_data')).households[0].invite_code,null);
    await guest.goto(site+'/');
    await guest.getByText('This event has not been published yet.',{exact:true}).waitFor();

    publicationAttempted=true;
    assert.equal(await settings({event_name:'Disposable rehearsal',event_date:new Date().toISOString().slice(0,10),website_url:site,is_published:true}),true);
    const code=(await rpc('admin_load_data')).households[0].invite_code;
    assert.match(code,/^[A-HJ-NP-Z2-9]{8}$/);
    const invite=site+'/?='+encodeURIComponent(code);
    const queue=await rpc('admin_save_delivery',{
      p_id:null,p_household_id:household,p_expected_revision:null,
      p_values:{channel:'email',message_subject:'Disposable rehearsal',message_body:invite,status:'ready'}
    });
    assert.equal(await rpc('admin_authorize_device_send',{p_queue_id:queue}),true);
    await rpc('admin_record_delivery_sent',{p_queue_id:queue,p_expected_revision:1,p_note:'Simulated handoff in disposable rehearsal'});
    assert.equal((await rpc('admin_load_data')).queue.find(row=>row.id===queue).status,'sent');

    const openInvite=async()=>{
      await guest.goto(invite);
      await guest.getByRole('heading',{name:'Rehearsal household'}).waitFor();
    };
    await openInvite();
    await guest.getByRole('heading',{name:'Rehearsal dinner'}).waitFor();
    await guest.locator('input[value="attending"]').check();
    await guest.locator('#saveRsvp').click();
    assert.equal((await rpc('admin_load_data')).submissions.length,0);
    await guest.locator('#confirmRsvp').click();
    await guest.locator('input[value="attending"]:disabled').waitFor();
    await rpc('admin_correct_rsvp',{p_guest_id:person,p_session_id:session,p_status:'declined',p_reason:'Disposable correction'});
    await openInvite();
    assert.equal(await guest.locator('input[value="declined"]').isChecked(),true);
    assert.equal(await guest.locator('input[value="attending"]').isDisabled(),true);
    assert.equal(await guest.locator('#saveRsvp').isVisible(),false);
    assert.equal((await rpc('admin_load_data')).submissions.length,1);
    await rpc('admin_correct_rsvp',{p_guest_id:person,p_session_id:session,p_status:'attending',p_reason:null});
    await openInvite();
    await guest.getByText('Rehearsal cake',{exact:true}).click();
    await guest.getByRole('button',{name:'Pick item'}).click();
    await guest.getByRole('button',{name:'Remove selection'}).waitFor();
    await guest.locator('#confirmFood').click();
    await guest.locator('#foodHint').filter({hasText:/^Thank you! Your food selection is confirmed\.$/}).waitFor();
    assert.equal((await rpc('admin_load_data')).claims[0].quantity,1);
    assert.equal(await settings({is_published:false}),false);
    publicationAttempted=false;
    await guest.goto(invite);
    await guest.getByText('This event has not been published yet.',{exact:true}).waitFor();
    console.log('PASS: real administrator sign-in, publication, delivery tracking, guest RSVP, locked correction, food, and unpublication on a disposable stack.');
  }finally{
    try{
      if(publicationAttempted){
        try{await settings({is_published:false});}
        catch(error){throw Error('Could not unpublish the disposable event. Close it in Event settings. '+error.message);}
      }
    }finally{await browser.close();}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

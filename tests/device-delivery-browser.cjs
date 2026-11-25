const {selectWorkTab}=require('./helpers/language-ui.cjs');
const {selectOverviewTab}=require('./helpers/admin-toolbar.cjs');
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
async function run(type){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const seed=mock+`\nfixtures.event_settings[0].is_published=true;const h=fixtures.households.find(h=>!h.archived_at&&h.invite_code);window.__deliveryHousehold=h;fixtures.invitation_send_queue=['email','sms','whatsapp'].map((channel,i)=>({id:'device-'+i,household_id:h.id,channel,status:'ready',revision:1,created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_value:channel==='email'?'test@example.invalid':'+298 123456'},message_subject:'Invitation',message_body:'Hey Føroyskt & Deutsch?'}));fixtures.invitation_send_queue.push({...fixtures.invitation_send_queue[0],id:'sent-original',status:'sent'},{...fixtures.invitation_send_queue[0],id:'stale',invitation_code_snapshot:'RETIRED'},{...fixtures.invitation_send_queue[2],id:'device-current',created_at:'2026-11-02T12:00:00Z',updated_at:'2026-11-02T12:00:00Z'});`;
  const hierarchy=`
    for(const [id,name,order,service,language,code] of [['tree-a','Zulu first',1,'sms','de','KLMNPQRS'],['tree-b','Alpha second',2,'whatsapp','en','NPQRSTUV']]){
      const guestId='guest-'+id;
      fixtures.households.push({...h,id,household_name:name,parent_id:h.id,sort_order:order,primary_guest_id:guestId,language,invite_code:code});
      fixtures.guests.push({id:guestId,household_id:id,first_name:name,last_name:'Sample',courtesy_title:'Dr.',relation:'Cousin',mobile:'+1202555011'+order,preferred_contact_method:service,
        invitation_salutation:id==='tree-b'?{pattern:'{Relation}'}:null});
    }
    fixtures.households.push({...h,id:'template-email',household_name:'Example email household',primary_guest_id:'guest-email',language:'en',invite_code:'QRSTUVWX'});
    fixtures.guests.push({id:'guest-email',household_id:'template-email',first_name:'Email recipient',relation:'Parent',email:'test@example.invalid',preferred_contact_method:'email',
      invitation_salutation:{pattern:'{nickname}',nickname:'Mom'}},
      {id:'guest-not-contact',household_id:'template-email',first_name:'Unselected guest',invitation_salutation:{pattern:'{nickname}',nickname:'Skip me'}},
      {id:'guest-alternate',household_id:h.id,first_name:'Other recipient',relation:'Aunt',invitation_salutation:{pattern:'{nickname}',nickname:'Auntie'}});
    fixtures.household_contacts.push({id:'alternate-contact',household_id:'tree-b',guest_id:'guest-alternate',contact_name:'Other recipient',contact_type:'phone',contact_value:'+12025550118'},
      {id:'standalone-contact',household_id:'tree-b',contact_name:'Jordan Example',contact_type:'phone',contact_value:'+12025550119'});
  `;
  const templates=`
    h.language='en';h.household_name='Example household';fixtures.event_settings[0].default_language='en';fixtures.event_settings[0].fallback_language='de';
    const templateRows=[{language_code:'en',name:'WhatsApp invitation',channel:'whatsapp',body:'Dear {contact_salutation} {invitation_link}'},{language_code:'de',name:'SMS invitation',channel:'sms',body:'Dear {contact_salutation} {invitation_link}'}];
    const beforeTemplateRpc=client.rpc;
    client.rpc=async(name,args)=>{
      const result=await beforeTemplateRpc(name,args);
      if(name==='admin_load_data')result.data.invitationTemplates=templateRows.map((t,i)=>({id:'template-'+i,revision:'revision-'+i,name:t.name,channels:[t.channel],language_tags:[t.language_code],versions:{[t.language_code]:t}})).concat({id:'email',revision:'email-revision',name:'Email invitation',channels:['email'],language_tags:['en'],versions:{en:{subject:'Invitation for {household_name}',body:'Dear {contact_salutation}\\n{invitation_link}'}}});
      return result;
    };
  `;
  await page.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:seed+hierarchy+templates}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
  await page.waitForFunction(()=>document.querySelectorAll('#inviteRows [data-invite-household]').length>0);
  await selectWorkTab(page,'invites');
  await page.locator('#inviteRows details.tree-disclosure').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
  const rows=await page.locator('#inviteRows [data-invite-household]').evaluateAll(nodes=>nodes.map(n=>n.dataset.inviteHousehold));
  assert.ok(rows.indexOf('tree-a')<rows.indexOf('tree-b'),'saved sibling order wins over alphabetic order');
  assert.equal(await page.locator('#inviteRows .hierarchy-section').count(),0,'Invites defaults to a flat delivery overview');
  assert.ok(await page.locator('[data-invite-household="tree-a"] .invite-overview-delivery').isVisible(),'overview shows delivery status');
  const householdId=await page.evaluate(()=>window.__deliveryHousehold.id);
  const household = id => page.locator('[data-invite-household="'+id+'"]');
  const before = await page.evaluate(()=>JSON.stringify(fixtures.invitation_send_queue));
  const action = page.locator('#bulkInvitesHost');
  assert.equal(await page.evaluate(()=>window.__calls.some(c=>c.name==='admin_save_delivery')),false,'opening Invites does not create a delivery');
  await selectOverviewTab(page,'invitation');
  await page.locator('[data-invite-filter="needs-draft"]').click();
  await page.locator('[data-bulk-select-all]').check();
  await action.getByRole('button',{name:'Make draft(s)',exact:true}).click();
  await page.locator('#bulkInviteStatus').getByText('3 drafts created',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_save_delivery'&&c.args.p_values.status==='ready').length),0);
  await page.locator('[data-invite-filter="needs-draft"]').click();
  await page.locator('[data-invite-filter="review"]').click();
  await page.locator('[data-bulk-select-all]').check();
  await action.getByRole('button',{name:'Make invitation(s)',exact:true}).click();
  await page.locator('#bulkInviteStatus').getByText('3 invitations marked ready.',{exact:true}).waitFor();
  await page.locator('[data-invite-filter="review"]').click();
  const generated = await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_save_delivery'));
  const draftWrites=generated.filter(c=>c.args.p_values.status==='draft');
  const readyWrites=generated.filter(c=>c.args.p_values.status==='ready');
  assert.equal(generated.length,6,'three matching drafts are created and prepared');
  assert.equal(draftWrites.length,3);
  assert.ok(draftWrites.every(c=>c.args.p_id===null&&c.args.p_values.only_if_missing===true&&c.args.p_values.template_revision),'draft creation carries the selected template revision');
  assert.ok(draftWrites.every(c=>c.args.p_values.contact_id===null),'salutation formatting does not override the delivery recipient');
  assert.equal(readyWrites.length,3);
  assert.ok(readyWrites.every(c=>c.args.p_id&&c.args.p_expected_revision===1&&c.args.p_values.expected_invitation_code),'ready preparation guards the created draft and invitation code');
  assert.equal(await page.evaluate(()=>JSON.stringify(fixtures.invitation_send_queue.filter(q=>q.id.startsWith('device-')||['sent-original','stale'].includes(q.id)))),before,'generation preserves existing delivery snapshots');
  const email=await page.evaluate(()=>fixtures.invitation_send_queue.find(q=>q.household_id==='template-email'&&q.status==='ready'));
  assert.equal(email.template_id,'email');
  assert.equal(email.message_subject,'Invitation for Example email household');
  assert.match(email.message_body,/^Dear Mom\nhttp:/);
  const sms=await page.evaluate(()=>fixtures.invitation_send_queue.find(q=>q.household_id==='tree-a'&&q.status==='ready'));
  assert.equal(sms.template_id,'template-1');assert.match(sms.message_body,/^Dear Dr\. Zulu first Sample http:/);
  const whatsapp=await page.evaluate(()=>fixtures.invitation_send_queue.find(q=>q.household_id==='tree-b'&&q.status==='ready'));
  assert.equal(whatsapp.template_id,'template-0');assert.match(whatsapp.message_body,/^Dear Cousin http:/);
  async function openDelivery(id) {
   const row=household(id);
   if(!await row.evaluate(node=>node.open))await row.locator(':scope > summary .invite-compact-name').click();
   await row.locator('.invite-household-invitation').evaluate(node=>node.open=true);
   await row.locator('[data-invite-delivery-submenu="current"]').evaluate(node=>node.open=true);
   const section=page.locator('#invite-delivery-'+id);await section.evaluate(node=>node.open=true);
   await section.locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
   return section;
  }
  const delivery=await openDelivery('template-email');
  const currentEmail=household('template-email').locator('.current-invitation');
  assert.equal(await delivery.locator('[data-delivery-id="'+email.id+'"]').count(),0);
  await currentEmail.locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
  const draft=currentEmail.locator('[data-form-key="delivery:'+email.id+'"]');
  const channel=draft.getByLabel('Delivery channel');
  const draftBody=draft.getByLabel('Message text',{exact:true});
  assert.equal(await draftBody.inputValue(), email.message_body);
  await draftBody.fill('Hand-edited text');
  await channel.selectOption('sms');
  assert.equal(await draftBody.inputValue(),'Hand-edited text');
  const whatsappRow=household('tree-b');
  await whatsappRow.evaluate(node=>node.open=true);
  await whatsappRow.locator('.invite-household-invitation').evaluate(node=>node.open=true);
  await whatsappRow.locator('[data-invite-delivery-submenu="current"]').evaluate(node=>node.open=true);
  const currentWhatsApp=whatsappRow.locator('.current-invitation');
  await currentWhatsApp.locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
  const whatsappEditor=currentWhatsApp.locator('[data-form-key="delivery:'+whatsapp.id+'"]');
  const customBody=whatsappEditor.getByLabel('Message text',{exact:true});
  assert.equal(await customBody.inputValue(),whatsapp.message_body,'the saved greeting is loaded as text');
  await customBody.fill('Dear {contact_salutation}');
  const recipient=whatsappEditor.getByLabel('Delivery recipient',{exact:true});
  await recipient.selectOption('alternate-contact');
  assert.equal(await whatsappEditor.locator('.delivery-draft-preview .delivery-message').textContent(),'Dear Auntie');
  assert.equal(await whatsappEditor.getByText('Recipient: +12025550118',{exact:true}).isVisible(),true);
  await recipient.selectOption('standalone-contact');
  assert.equal(await whatsappEditor.locator('.delivery-draft-preview .delivery-message').textContent(),'Dear Jordan Example');
  assert.equal(await whatsappEditor.getByText('Recipient: +12025550119',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(id=>fixtures.invitation_send_queue.find(q=>q.id===id).message_body,whatsapp.id),whatsapp.message_body,
    'previewing a different contact does not change the saved greeting');
  await whatsappRow.evaluate(node=>node.open=false);
  const history=await openDelivery(householdId);
  const current=household(householdId).locator('[data-invite-delivery-submenu="current"]');
  const primary=current.locator("[data-primary-delivery]");
  assert.equal(await primary.getAttribute("data-delivery-id"), "device-current");
  await primary.locator(":scope > summary").click();
  assert.equal(await current.locator("a[href]").count(),0,"the current preview has no device compose links");
  assert.equal(await current.locator(".invitation-send-form").count(),0,"the current preview has no sent confirmation form");
  assert.equal(await primary.getByRole("button",{name:"Change to Draft",exact:true}).isVisible(),true);
  assert.equal(await history.locator("button, a, form").count(),0,"historical deliveries have no edit or handoff controls");
  await selectWorkTab(page,'households');
  const profile=page.locator('#householdRows [data-tree-key="household:'+householdId+'"]');
  await profile.evaluate(node=>{for(const parent of [node,...Array.from(document.querySelectorAll('#householdRows details')).filter(parent=>parent.contains(node))])parent.open=true;});
  const deliveryProfile=profile.locator(':scope > .household-expanded > .feature-section').filter({has:page.locator('.invitation-delivery-sections')});
  await deliveryProfile.evaluate(node=>node.open=true);
  await deliveryProfile.locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
  const record=id=>deliveryProfile.locator('[data-delivery-id="'+id+'"]');
  assert.ok((await record('device-0').getByRole('link',{name:'Open email',exact:true}).getAttribute('href')).startsWith('mailto:'));
  assert.equal(await record('device-1').getByRole('link',{name:'Open Messages',exact:true}).getAttribute('href'),'sms:+298123456');
  assert.ok((await record('device-2').getByRole('link',{name:'Open WhatsApp',exact:true}).getAttribute('href')).startsWith('https://wa.me/298123456?text='));
  assert.equal(await record('stale').getByRole('link').count(),0);
  await record('device-0').getByRole('link',{name:'Open email',exact:true}).evaluate(n=>{n.addEventListener('click',e=>e.preventDefault());n.click();});
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_record_delivery_sent').length),0);
  await selectWorkTab(page,'invites');
  await openDelivery(householdId);
  const original=current.locator('[data-delivery-id="sent-original"]');
  await original.locator(':scope > summary').click();
  const reminder=original.locator('details').filter({has:page.locator('summary',{hasText:'Prepare reminder'})});
  await reminder.locator(':scope > summary').click();
  assert.ok((await reminder.locator('textarea').first().inputValue()).includes(await page.evaluate(()=>window.__deliveryHousehold.invite_code)));
  const deliveryWrites = await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_save_delivery').length);
  await reminder.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.waitForFunction(before=>window.__calls.filter(c=>c.name==='admin_save_delivery').length>before, deliveryWrites);
  const call=await page.evaluate(()=>window.__calls.findLast(c=>c.name==='admin_save_delivery'));
  assert.equal(call.args.p_id,null);assert.equal(call.args.p_values.status,'draft');
  assert.equal(await page.evaluate(()=>fixtures.invitation_send_queue.find(q=>q.id==='sent-original').status),'sent');
  await page.locator('[data-invite-household="'+householdId+'"] > summary .invite-compact-name').click();
  assert.equal(await page.locator('#invite-delivery-'+householdId).isVisible(),false);
  assert.ok(await page.locator('#inviteRows [data-invite-household]').count());
  assert.deepEqual(errors,[]);console.log(type.name()+': invitation templates and contact salutations, iPad compose links, stale-code blocking, explicit sending and separate reminder draft passed.');
 }finally{await browser.close();}
}
server.listen(0,'127.0.0.1',async()=>{try{await run(chromium);if(process.env.RSVP_TEST_BROWSER!=='chromium')await run(webkit);}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});

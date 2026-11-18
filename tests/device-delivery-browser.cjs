const {selectWorkTab}=require('./helpers/language-ui.cjs');
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
  const seed=mock+`\nfixtures.event_settings[0].is_published=true;const h=fixtures.households.find(h=>!h.archived_at&&h.invite_code);window.__deliveryHousehold=h;fixtures.invitation_send_queue=['email','sms','whatsapp'].map((channel,i)=>({id:'device-'+i,household_id:h.id,channel,status:'ready',revision:1,created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_value:channel==='email'?'test@example.invalid':'+298 123456'},message_subject:'Invitation',message_body:'Hey Føroyskt & Deutsch?'}));fixtures.invitation_send_queue.push({...fixtures.invitation_send_queue[0],id:'sent-original',status:'sent'},{...fixtures.invitation_send_queue[0],id:'stale',invitation_code_snapshot:'RETIRED'});`;
  const hierarchy=`\nfor(const [id,name,order,service] of [['tree-a','Zulu first',1,'sms'],['tree-b','Alpha second',2,'whatsapp']]){const guestId='guest-'+id;fixtures.households.push({...h,id,household_name:name,parent_id:h.id,sort_order:order,primary_guest_id:guestId});fixtures.guests.push({id:guestId,household_id:id,first_name:name,preferred_contact_method:service});}`;
  const templates=`
    h.language='en';h.household_name='Example household';fixtures.event_settings[0].default_language='en';fixtures.event_settings[0].fallback_language='de';
    const templateRows=[{language_code:'en',name:'WhatsApp invitation',channel:'whatsapp',body:'WhatsApp message {invitation_link}'},{language_code:'de',name:'SMS invitation',channel:'sms',body:'SMS message {invitation_link}'}];
    const beforeTemplateRpc=client.rpc;
    client.rpc=async(name,args)=>{
      const result=await beforeTemplateRpc(name,args);
      if(name==='admin_load_data')result.data.invitationTemplates=templateRows.map((t,i)=>({id:String(i),name:t.name,channels:[t.channel],versions:{[t.language_code]:t}})).concat({id:'email',name:'Email invitation',channels:['email'],versions:{en:{subject:'Invitation for {household_name}',body:'Hello {household_name}\\n{invitation_link}'}}});
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
  const chooser = page.getByRole('dialog', { name: 'Choose template', exact: true });
  async function chooseTemplate(id, name, channel) {
   await household(id).locator('.invite-create').click();
   await chooser.getByRole('button', { name, exact: true }).click();
   await page.waitForFunction(({id, channel}) => fixtures.invitation_send_queue.some(q=>q.household_id===id&&q.channel===channel&&q.status==='draft'), {id, channel});
   return page.evaluate(({id, channel}) => fixtures.invitation_send_queue.find(q=>q.household_id===id&&q.channel===channel&&q.status==='draft'), {id, channel});
  }
  const email = await chooseTemplate(householdId, 'Email invitation', 'email');
  assert.equal(email.message_subject, 'Invitation for Example household');
  assert.match(email.message_body, /^Hello Example household\nhttp:/);
  const sms = await chooseTemplate('tree-a', 'SMS invitation', 'sms');
  assert.match(sms.message_body, /^SMS message http:/);
  const whatsapp = await chooseTemplate('tree-b', 'WhatsApp invitation', 'whatsapp');
  assert.match(whatsapp.message_body, /^WhatsApp message http:/);
  await household(householdId).locator('.invite-share').click();
  const delivery=page.locator('#invite-delivery-'+householdId);
  await delivery.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
  const draft=delivery.locator('[data-form-key="delivery:'+email.id+'"]');
  const channel=draft.getByLabel('Delivery channel');
  const draftBody=draft.getByLabel('Message text',{exact:true});
  assert.equal(await draftBody.inputValue(), email.message_body);
  await draftBody.fill('Hand-edited text');
  await channel.selectOption('sms');
  assert.equal(await draftBody.inputValue(),'Hand-edited text');
  const record=id=>page.locator('#inviteRows [data-delivery-id="'+id+'"]');
  assert.ok((await record('device-0').getByRole('link',{name:'Open email',exact:true}).getAttribute('href')).startsWith('mailto:'));
  assert.equal(await record('device-1').getByRole('link',{name:'Open Messages',exact:true}).getAttribute('href'),'sms:+298123456');
  assert.ok((await record('device-2').getByRole('link',{name:'Open WhatsApp',exact:true}).getAttribute('href')).startsWith('https://wa.me/298123456?text='));
  assert.equal(await record('stale').getByRole('link').count(),0);
  await record('device-0').getByRole('link',{name:'Open email',exact:true}).evaluate(n=>{n.addEventListener('click',e=>e.preventDefault());n.click();});
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_record_delivery_sent').length),0);
  assert.equal(await record('device-0').locator('textarea').first().inputValue(),'Hey Føroyskt & Deutsch?');
  const reminder=record('sent-original').locator('details').filter({has:page.locator('summary',{hasText:'Prepare reminder'})});
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
  assert.deepEqual(errors,[]);console.log(type.name()+': invitation templates, iPad compose links, stale-code blocking, explicit sending and separate reminder draft passed.');
 }finally{await browser.close();}
}
server.listen(0,'127.0.0.1',async()=>{try{await run(chromium);if(process.env.RSVP_TEST_BROWSER!=='chromium')await run(webkit);}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});

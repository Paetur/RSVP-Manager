// Action layout uses public assets and synthetic records only.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createPublicFoodHarness, routeSyntheticSdk } = require("./helpers/public-browser-site.cjs");
const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
const { server, mock, extra, cleanup } = createPublicFoodHarness("invites-actions-layout");
const seed = `fixtures.event_settings[0].food_enabled=true;fixtures.event_settings[0].food_stage='interest';`;

async function refresh(page) {
 await refreshFixture(page);
 await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
}

async function geometry(page, count) {
 const row = page.locator("#inviteRows .invite-household > summary").first();
 const actions = row.locator(":scope > .invite-row-actions");
 assert.equal(await actions.locator(":scope > *").count(), count);
 const result = await actions.evaluate(node => {
  const strip=node.getBoundingClientRect(),row=node.parentElement.getBoundingClientRect();
  const boxes=[...node.children].map(child=>child.getBoundingClientRect());
  const heading=document.querySelector('.invite-overview-heading > :last-child');
  return {
   oneLine:boxes.every(box=>Math.abs(box.top-boxes[0].top)<1),
   touch:boxes.every(box=>box.width>=43.5&&box.height>=43.5),
   contained:boxes.every(box=>box.left>=strip.left-1&&box.right<=strip.right+1&&box.left>=row.left-1&&box.right<=row.right+1),
   separated:boxes.every((box,index)=>!index||box.left>=boxes[index-1].right+3),
   aligned:!heading||!heading.getClientRects().length||Math.abs(heading.getBoundingClientRect().left-strip.left)<1,
   pageFits:document.documentElement.scrollWidth<=innerWidth+1,
  };
 });
 assert.equal(result.oneLine,true,'all action controls remain in one row');
 assert.equal(result.touch,true,'action controls retain 44px touch size');
 assert.equal(result.contained,true,'buttons stay inside action strip and household row');
 assert.equal(result.separated,true,'action controls do not overlap');
 assert.equal(result.aligned,true,'Actions heading follows the same optional-column grid');
 assert.equal(result.pageFits,true,'optional columns do not create page overflow');
}

(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch();
 try {
  for(const width of [1024,1100,1160,1440,390,320]){
   const page=await browser.newPage({viewport:{width,height:1050},hasTouch:width<700}),errors=[];
   page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('rsvp-interface-language','en');});
   await routeSyntheticSdk(page,mock+'\n'+extra+'\n'+seed);
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
   await page.waitForFunction(()=>document.querySelectorAll('#statsGrid .stat-card').length===4);
   const fields=page.locator('#inviteShownFieldsHost .invite-shown-fields');
   const food=fields.getByLabel('Food',{exact:true});
   await food.uncheck();await geometry(page,3);
   await food.check();await geometry(page,3);
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food interest',{exact:true}).count(),1);
   for(const label of ['Recipient / channel','Invitation','RSVP']){
    const field=fields.getByLabel(label,{exact:true});
    await field.uncheck();await geometry(page,3);
    await field.check();await geometry(page,3);
   }
   await page.evaluate(()=>{fixtures.event_settings[0].food_stage='selection';});
   await refresh(page);await geometry(page,3);
   assert.equal(await page.locator('#inviteRows .invite-overview-heading').getByText('Food items',{exact:true}).count(),1);
   await food.uncheck();await geometry(page,3);await food.check();await geometry(page,3);
   await page.evaluate(()=>{
    fixtures.event_settings[0].is_published=true;
    const h=fixtures.households.find(h=>h.id===h2);
    fixtures.invitation_send_queue=[{id:'action-layout-draft',household_id:h.id,channel:'manual',status:'draft',revision:1,created_at:'2026-11-16T12:00:00Z',updated_at:'2026-11-16T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_name:'Example'},message_body:'Synthetic invitation'}];
   });
   await refresh(page);await geometry(page,2);
   const row=page.locator('#inviteRows .invite-household > summary').first();
   assert.equal(await row.locator('.invite-preview,.invite-edit-household').count(),0,'published presentation retains eye/edit gates');
   assert.equal(await row.locator('.invite-share').count(),1);
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS Invites actions: Food shown/hidden and interest/selection stages, optional columns, publication gates, aligned single-row 44px controls, no overflow at320/390/1024/1100/1160/1440.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});

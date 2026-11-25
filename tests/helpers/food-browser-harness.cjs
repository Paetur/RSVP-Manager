// Actual UI with synthetic APIs. No real account, database or invitation is contacted.
const { mock } = require("./admin-fixture.cjs"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = process.cwd();

const extra = `
fixtures.event_settings[0].default_language='en';fixtures.event_settings[0].fallback_language='en';fixtures.event_languages=['en','fo','de'].map((language_code,sort_order)=>({language_code,display_name:language_code,enabled:true,sort_order}));
fixtures.food_categories=[{id:cat1,name:'Snacks',sort_order:1},{id:cat2,name:'Drinks',sort_order:2}];
const gid='44444444-4444-4444-8444-444444444444';
fixtures.food_items=[{id:'55555555-1111-4111-8111-111111111111',name_en:'Chips',category:'Snacks',quantity_needed:5,active:true,quantity_type:'Piece(s)',food_group_id:gid},{id:'55555555-2222-4222-8222-222222222222',name_en:'Nuts',category:'Snacks',quantity_needed:5,active:true,quantity_type:'Piece(s)',food_group_id:gid},{id:'55555555-3333-4333-8333-333333333333',name_en:'Coffee',category:'Drinks',quantity_needed:5,active:true,quantity_type:'Piece(s)'},{id:'55555555-4444-4444-8444-444444444444',name_en:'Juice',category:'Drinks',quantity_needed:5,active:true,quantity_type:'Piece(s)'}];fixtures.food_claims=[];
window.__groups=[{id:gid,name:'Chips & nuts',translations:{de:'Chips & Nüsse'},category:'Snacks',updated_at:'2026-11-11T09:00:00Z',item_ids:fixtures.food_items.slice(0,2).map(i=>i.id)}];
window.__invite={household:{id:h2,name:'Example household',language:'en',rsvp_state:'open',can_add_guests:true},guests:[{id:'66666666-6666-4666-8666-666666666666',first_name:'Alex',last_name:'Example'}],invitations:[{guest_id:'66666666-6666-4666-8666-666666666666',session_id:s1,requires_rsvp:true}]};
const earlier=client.rpc;client.rpc=async(name,args)=>{if(name==='get_public_event_v2')return {data:{event:{event_name:'Synthetic celebration',event_date:'2027-02-20',timezone:'Europe/Berlin',default_language:'de'},content:{},sessions:[{id:s1,name:'Celebration',location_id:cat1,starts_at:'2027-02-20T09:30:00Z',ends_at:'2027-02-20T18:00:00Z'}],locations:[{id:cat1,name:'Calvary Chapel HD',timezone:'Europe/Berlin',map_url:'https://maps.example.invalid/',address:'Example street'}],translations:[{content_key:'food-category:'+cat1+':name',language_code:'de',content_value:'Knabbereien'}]}};
if(name==='admin_load_data'){const r=await earlier(name,args);r.data.foodGroups=window.__groups;return r;}
if(name==='admin_save_food_group'){window.__groupSave=args;const id=args.p_id||crypto.randomUUID();for(const item of fixtures.food_items)if(args.p_item_ids.includes(item.id))item.food_group_id=id;window.__groups.push({id,name:args.p_name,translations:args.p_translations,category:args.p_category,item_ids:args.p_item_ids,updated_at:new Date().toISOString()});return {data:id};}
return earlier(name,args);};
client.functions={invoke:async(name,request)=>{const {action,args}=request.body;if(action==='get_invitation_v2')return {data:window.__invite};
if(action==='get_household_food')return {data:{items:fixtures.food_items.map(i=>({...i,claimed_total:fixtures.food_claims.filter(c=>c.food_item_id===i.id).reduce((n,c)=>n+c.quantity,0)})),claims:fixtures.food_claims,groups:window.__groups,categories:fixtures.food_categories,confirmed:!!window.__foodConfirmed}};
if(action==='add_household_guest'){window.__addRequests=window.__addRequests||[];window.__addRequests.push(args);if(!window.__invite.guests.some(g=>g.id===args.p_guest_id)){window.__invite.guests.push({id:args.p_guest_id,first_name:args.p_first_name,last_name:args.p_last_name,is_child:args.p_is_child});window.__invite.invitations.push({guest_id:args.p_guest_id,session_id:s1,requires_rsvp:true});}if(window.__failAdd){window.__failAdd=false;return {error:{message:'Synthetic lost response'}};}return {data:window.__invite};}
if(action==='set_household_food_group'){window.__groupRequests=window.__groupRequests||[];window.__groupRequests.push(args);if(window.__failGroup){window.__failGroup=false;return {error:{message:'Synthetic shortage'}};}const group=window.__groups.find(g=>g.id===args.p_group_id);fixtures.food_claims=fixtures.food_claims.filter(c=>!group.item_ids.includes(c.food_item_id));if(args.p_quantity)for(const id of group.item_ids)fixtures.food_claims.push({food_item_id:id,quantity:1});return {data:null};}
if(action==='confirm_household_food'){window.__foodConfirmed=true;return {data:null};}return {data:null};}};
`;

const stageExtra = `fixtures.event_settings[0].food_stage='interest';window.__foodAnswer=null;const originalGuest=client.functions.invoke;client.functions.invoke=async(name,request)=>{const {action,args}=request.body;if(action==='get_household_food'){if(fixtures.event_settings[0].food_stage==='interest')return {data:{stage:'interest',interest:window.__foodAnswer,items:[],groups:[],categories:[],claims:[],confirmed:false}};const r=await originalGuest(name,request);r.data.stage='selection';r.data.interest=window.__foodAnswer;return r;}if(action==='set_household_food_interest'){window.__interestRequests=(window.__interestRequests||0)+1;if(window.__failInterest){window.__failInterest=false;return {error:{message:'Synthetic save failure'}};}if(window.__foodAnswer!=null&&window.__foodAnswer!==args.p_interest)return {error:{message:'Food answer already confirmed'}};if(window.__foodAnswer==null){window.__foodAnswer=args.p_interest;window.__interestWrites=(window.__interestWrites||0)+1;}return client.functions.invoke(name,{body:{action:'get_household_food',args:{p_code:args.p_code}}});}return originalGuest(name,request);};
const stageRpc=client.rpc;client.rpc=async(name,args)=>{
  if(name==='admin_save_features'){window.__stageWrites=(window.__stageWrites||0)+1;fixtures.event_settings[0].food_stage=args.p_stage;fixtures.event_settings[0].food_enabled=args.p_food;fixtures.event_settings[0].other_enabled=args.p_other;fixtures.event_settings[0].food_introduction=args.p_introduction;return {data:null};}
  if(name==='admin_set_food_stage'){
    (window.__openStageCalls ||= []).push(args);
    const settings=fixtures.event_settings[0];
    if(args.p_expected_stage!==settings.food_stage) return {error:{message:'Food stage changed; refresh before saving'}};
    settings.food_stage=args.p_stage;
    return {data:null};
  }
  const result=await stageRpc(name,args);
  if(name==='get_public_event_v2'&&result.data?.event)result.data.event.food_introduction={de:'Deutsche Erklärung',en:'English explanation',fo:'Føroysk frágreiðing'};
  return result;
};`;

// Each suite owns its server and artifact directory; fixtures are synthetic only.
function createFoodHarness(artifactName = "food-interest", options = {}) {
  const siteRoot = options.root || root;
  const out = options.out || path.join(root, "artifacts", artifactName);
  const server = http.createServer((req, res) => {
    let name = new URL(req.url, "http://localhost").pathname;
    if (name.endsWith("/")) name += "index.html";
    const p = path.resolve(siteRoot, "." + name);
    if (!p.startsWith(siteRoot + path.sep) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "content-type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[path.extname(p)] || "text/plain",
    );
    res.end(
      path.extname(p) === ".html"
        ? fs.readFileSync(p, "utf8").replace(/ integrity="[^"]+"/g, "")
        : fs.readFileSync(p),
    );
  });
  return { root: siteRoot, out, server, mock, extra, stageExtra };
}
module.exports = { createFoodHarness };

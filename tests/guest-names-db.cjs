const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDatabase,signIn}=require('./helpers/alpha-database.cjs');
const { withRecordRevision } = require("./helpers/alpha-database.cjs");
(async()=>{
 const window={};vm.runInNewContext(fs.readFileSync('js/guest-names.js','utf8'),{window});
 const last=window.RSVP_GUEST_NAMES.lastName,guest={first_name:'Alex',last_name:'Example'},invitation={household:{last_name:'Example'},guests:[guest,{last_name:'Example'}]};
 assert.equal(last(guest,invitation,{}),'Example');assert.equal(last(guest,invitation,{show_repeated_surname:false}),'');
 invitation.guests.push({last_name:'Other'});assert.equal(last(guest,invitation,{show_repeated_surname:false}),'Example');invitation.guests.pop();invitation.guests.push({last_name:''});assert.equal(last(guest,invitation,{show_repeated_surname:false}),'Example');
 invitation.guests.pop();invitation.household.last_name='';assert.equal(last(guest,invitation,{show_repeated_surname:false}),'Example');
 const db=await createDatabase();try{
 await signIn(db);const q=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
 const group=await q("SELECT planning_config->'groups'->0->>'id' v FROM public.event_settings WHERE id=1");
 const values={household_name:'Example household',last_name:' Example ',language:'en',planning_group_id:group};
 const id=await q('SELECT public.admin_save_household(NULL,$1) v',[values]);
 assert.equal(await q('SELECT last_name v FROM public.households WHERE id=$1',[id]),'Example');
 await db.query('SELECT public.admin_save_household($1,$2)',[id, await withRecordRevision(db, "households", id, {...values,last_name:'Changed'})]);assert.equal(await q('SELECT last_name v FROM public.households WHERE id=$1',[id]),'Changed');
 await assert.rejects(db.query('SELECT public.admin_save_household($1,$2)',[id,{...values,last_name:'x'.repeat(141)}]),/too long/);
 await db.exec('RESET ROLE');await db.query("INSERT INTO public.guests(household_id,first_name,last_name) VALUES($1,'Alex','Changed')",[id]);
 const data=await q('SELECT app_private.guest_invitation(h) v FROM public.households h WHERE id=$1',[id]);assert.equal(data.household.last_name,'Changed');
 await db.exec('SET ROLE authenticated');
 const save=(values,expected)=>db.query("SELECT public.admin_save_guest_interface('wide',$1,$2)",[values,expected]);
 const expected={guest_title_visibility:{},show_repeated_surname:true};
 const current={guest_title_visibility:{en:true,de:false,fo:true},show_repeated_surname:false};
 await save(current,expected);
 await assert.rejects(()=>save({show_repeated_surname:true},expected),/changed/);
 await assert.rejects(db.exec('UPDATE public.event_settings SET show_repeated_surname=false WHERE id=1'),/preferences editor/);
 const backup=await q('SELECT public.admin_export_backup() v');
 assert.equal(backup.payload.tables['public.households'][0].last_name,'Changed');
 assert.deepEqual(backup.payload.tables['public.event_settings'][0].guest_interface_modes.wide,current);
 assert.equal(backup.payload.tables['public.event_settings'][0].show_repeated_surname,true,'preserve the legacy fallback');
 await db.exec(`RESET ROLE;UPDATE public.admins SET access_permissions=jsonb_set(app_private.permission_preset('view'),'{sections,settings}','"edit"'::jsonb)||'{"preset":"custom"}'::jsonb;SET ROLE authenticated`);
 await assert.rejects(()=>save({guest_title_visibility:{}},current),/permission/);
 await save({show_repeated_surname:true},current);
 await db.exec("RESET ROLE;UPDATE public.admins SET access_permissions=app_private.permission_preset('view');SET ROLE authenticated");
 await assert.rejects(()=>save({show_repeated_surname:false},expected),/permission/);
 console.log('PASS surname defaults/unanimous/mixed/missing cases; household create/edit/validation/guest projection/backup; atomic name preferences, stale and direct-write/permission guards.');
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});

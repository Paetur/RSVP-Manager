const assert=require('node:assert/strict');
const {createDatabase,signIn}=require('./helpers/alpha-database.cjs');
(async()=>{const db=await createDatabase();try{
 await signIn(db);const q=async(sql,args=[]) => (await db.query(sql,args)).rows[0].v;
 const group=await q("SELECT planning_config->'groups'->0->>'id' v FROM public.event_settings WHERE id=1");
 const id=await q('SELECT public.admin_save_household(NULL,$1) v',[{household_name:'Alex & Sam',last_name:'Rivers',planning_group_id:group,language:'en'}]);
 await db.exec('RESET ROLE');await db.query("INSERT INTO public.guests(household_id,first_name,last_name) VALUES($1,'Alex','Rivers')",[id]);await db.exec('SET ROLE authenticated');
 const draft=await q('SELECT public.admin_save_delivery(NULL,$1,$2,NULL) v',[id,{channel:'manual',status:'draft',message_body:'Hello Alex & Sam Rivers'}]);
 const data=await q('SELECT public.admin_load_data() v');const row=data.queue.find(x=>x.id===draft);
 assert.equal(row.recipient_snapshot.contact_name,'Alex & Sam Rivers');assert.equal(row.recipient_snapshot.contact_value,'Alex & Sam Rivers');
 const logs=await q("SELECT public.admin_query_logs('Rivers') v");assert.ok(logs.entries.length);assert.ok(logs.entries.some(entry=>entry.household_name==='Alex & Sam Rivers'));
 const backup=await q('SELECT public.admin_export_backup() v');assert.equal(backup.payload.tables['public.households'][0].household_name,'Alex & Sam');assert.equal(backup.payload.tables['public.households'][0].last_name,'Rivers');
 console.log('PASS combined new delivery fallback recipients and surname log search; raw household fields remain separate in backups.');
}finally{await db.close()}})().catch(error=>{console.error(error.message);process.exitCode=1});

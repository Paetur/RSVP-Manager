// Synthetic in-memory SQL only. Never connects to the VM or a hosted project.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;`);
 await db.exec(fs.readFileSync('supabase/install.sql','utf8'));
 const v=async(q,args=[])=>(await db.query(q,args)).rows[0].v;
 assert.equal(await v('SELECT food_stage v FROM public.event_settings WHERE id=1'),'interest');

 const households=[],codes=[],sessions=[],venues=[];
 await db.query('UPDATE public.event_settings SET guest_background=$1 WHERE id=1',[{image:'data:image/jpeg;base64,YQ==',crop:{x:0,y:0,width:1,height:1,sourceWidth:1,sourceHeight:1}}]);
 for(let i=0;i<2;i++){
  const h=await v("INSERT INTO public.households(household_name,planning_group_id,language) VALUES($1,'general','en') RETURNING id v",['Private household '+i]);households.push(h);
  await db.query("INSERT INTO public.guests(household_id,first_name) VALUES($1,'Guest')",[h]);codes.push(await v('SELECT invite_code v FROM public.households WHERE id=$1',[h]));
  const venue=await v('INSERT INTO public.event_locations(name) VALUES($1) RETURNING id v',['Private venue '+i]);venues.push(venue);
  const session=await v('INSERT INTO public.event_sessions(session_key,name,location_id) VALUES($1,$2,$3) RETURNING id v',['private-'+i,'Private session '+i,venue]);sessions.push(session);
  await db.query('INSERT INTO public.household_session_defaults(household_id,session_id,is_invited) VALUES($1,$2,true)',[h,session]);
 }
 for(let i=0;i<households.length;i++)codes[i]=await v('SELECT invite_code v FROM public.households WHERE id=$1',[households[i]]);
 await db.query("UPDATE public.guests SET first_name='Zoe',sort_order=9 WHERE household_id=$1",[households[0]]);
 for(const [first_name,is_child,sort_order] of [['Charlie',true,0],['Ben',true,4],['Alice',false,2]])await db.query('INSERT INTO public.guests(household_id,first_name,is_child,sort_order,created_at) VALUES($1,$2,$3,$4,$5)',[households[0],first_name,is_child,sort_order,'2020-01-01T00:00:00Z']);
 assert.equal(await v('SELECT public.get_invitation_v2($1) v',[codes[0]]),null);
 await db.exec('UPDATE public.event_settings SET is_published=true WHERE id=1');for(let i=0;i<households.length;i++)codes[i]=await v('SELECT invite_code v FROM public.households WHERE id=$1',[households[i]]);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);for(const rpc of ['get_public_event','get_public_event_v2'])assert.equal(await v('SELECT public.'+rpc+'() v'),null);await assert.rejects(()=>db.query('SELECT public.get_invitation_v2($1)',[codes[0]]),/permission denied/);if(role==='anon')await assert.rejects(()=>db.query('SELECT * FROM public.event_locations'),/permission denied/);else assert.equal((await db.query('SELECT * FROM public.event_locations')).rows.length,0);await db.exec('RESET ROLE');}
 assert.equal(await v("SELECT public.get_invitation_v2('AAAAAAAA') v"),null);assert.equal(await v("SELECT public.get_invitation_v2(NULL) v"),null);
 await db.exec('SET ROLE service_role');for(let i=0;i<2;i++){const result=await v('SELECT public.get_invitation_v2($1) v',[codes[i]]);if(i===0){assert.deepEqual(result.guests.map(g=>g.first_name),['Alice','Zoe','Charlie','Ben']);assert.deepEqual(result.guests.map(g=>g.sort_order),[2,9,0,4]);}assert.equal(result.eventData.event.guest_background.image,'data:image/jpeg;base64,YQ==');assert.deepEqual(result.eventData.sessions.map(s=>s.id),[sessions[i]]);assert.deepEqual(result.eventData.locations.map(l=>l.id),[venues[i]]);assert.equal(JSON.stringify(result).includes('Private venue '+(1-i)),false);}await db.exec('RESET ROLE');
 await db.query('UPDATE public.households SET archived_at=now() WHERE id=$1',[households[0]]);assert.equal(await v('SELECT public.get_invitation_v2($1) v',[codes[0]]),null);
 console.log('PASS private event: published/unpublished anonymous endpoints, invalid/missing codes, direct RPC/table bypass, household-scoped sessions/venues and archived invitations.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

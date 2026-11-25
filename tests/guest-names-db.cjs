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
 await assert.rejects(() => save({ guest_show_titles: 'false' }, { guest_show_titles: null }), /Invalid guest interface choice/);
 await save({ guest_show_titles: false }, { guest_show_titles: null });
 await assert.rejects(() => save({ guest_show_titles: true }, { guest_show_titles: null }), /changed/);
 const titlesOff = (await q('SELECT public.admin_export_backup() v')).payload.tables['public.event_settings'][0].guest_interface_modes;
 assert.deepEqual(titlesOff.wide, { ...current, guest_show_titles: false }, 'disabling titles keeps the individual language choices');
 assert.equal(titlesOff.phone?.guest_show_titles, undefined, 'title visibility is saved per device layout');
 await save({ guest_show_titles: true }, { guest_show_titles: false });
 await db.exec(`RESET ROLE;UPDATE public.admins SET access_permissions=jsonb_set(app_private.permission_preset('view'),'{sections,settings}','"edit"'::jsonb)||'{"preset":"custom"}'::jsonb;SET ROLE authenticated`);
 await assert.rejects(()=>save({guest_title_visibility:{}},current),/permission/);
 await assert.rejects(() => save({ guest_show_titles: false }, { guest_show_titles: true }), /permission/);
 await save({show_repeated_surname:true},current);
 await db.exec("RESET ROLE;UPDATE public.admins SET access_permissions=app_private.permission_preset('view');SET ROLE authenticated");
 await assert.rejects(()=>save({show_repeated_surname:false},expected),/permission/);

 await db.exec("RESET ROLE;UPDATE public.admins SET access_permissions=app_private.permission_preset('full');SET ROLE authenticated");
 const salutationHousehold = await q('SELECT public.admin_save_household(NULL,$1) v', [{ ...values, household_name: 'Synthetic salutation' }]);
 const salutation = { pattern: '{Nickname}', nickname: 'Mom', show_titles: false, show_repeated_surname: true };
 const linkedSalutation = { pattern: '{relation} {firstname}' };
 const person = (name, relation) => ({
   first_name: name, courtesy_title: 'Ms.', relation, email: name.toLowerCase() + '@example.invalid', preferred_contact_method: 'email',
 });
 const editPrimary = person('Primary', 'Parent');
 const saveGuest = (guestId, householdId, form) => q('SELECT public.admin_save_guest_details($1,$2,$3) v', [guestId, householdId, form]);
 const primary = await saveGuest(null, salutationHousehold, { ...editPrimary, invitation_salutation: salutation });
 const savedSalutation = guestId => q('SELECT invitation_salutation v FROM public.guests WHERE id=$1', [guestId]);
 const savePrimary = form => saveGuest(primary, salutationHousehold, { ...editPrimary, ...form });
 assert.deepEqual(await savedSalutation(primary), salutation);
 for (const invalid of [
   [], 'Mom', { pattern: 'No placeholder' }, { pattern: '{unrecognized}' },
   { pattern: '{relation}\n{firstname}' }, { pattern: '{relation}' + 'x'.repeat(200) },
   { nickname: '{firstname}' }, { nickname: 'x'.repeat(101) }, { nickname: 'A\nB' },
   { nickname: null }, { relation: 'Household-only field' }, { show_titles: 'false' }, { show_repeated_surname: null }, { extra: true },
 ]) {
   await assert.rejects(savePrimary({ invitation_salutation: invalid }), /Invalid invitation salutation/);
 }
 await savePrimary({ notes: 'Compatibility edit with no salutation key' });
 assert.deepEqual(await savedSalutation(primary), salutation, 'old editors preserve the saved block');
 await savePrimary({ invitation_salutation: null });
 assert.equal(await savedSalutation(primary), null, 'reset uses the default');
 await savePrimary({ invitation_salutation: { pattern: '{FiRsTnAmE}', nickname: '  ' } });
 assert.deepEqual(await savedSalutation(primary), { pattern: '{FiRsTnAmE}' }, 'blank nickname is omitted');
 await savePrimary({ invitation_salutation: { ...salutation, nickname: ' Mom ' } });
 assert.deepEqual(await savedSalutation(primary), salutation, 'nickname is trimmed');

 const linked = await saveGuest(null, id, { ...person('Linked', 'Sibling'), invitation_salutation: linkedSalutation });
 const unrelated = await saveGuest(null, salutationHousehold, { ...person('Unrelated', 'Private relation'), invitation_salutation: { nickname: 'Private nickname' } });
 assert.equal(await savedSalutation((await q('SELECT id v FROM public.guests WHERE household_id=$1 AND first_name=$2', [id, 'Alex']))), null);
 await db.query('SELECT public.admin_set_household_primary_guest($1,$2)', [salutationHousehold, primary]);
 await db.query('SELECT public.admin_save_contact(NULL,$1,$2)', [salutationHousehold, {
   contact_type: 'email', contact_value: 'linked@example.invalid', guest_id: linked,
 }]);
 const preview = await q('SELECT public.admin_guest_preview($1,false) v', [salutationHousehold]);
 assert.equal(JSON.stringify(preview).includes('invitation_salutation'), false, 'guest preview payload omits private salutations');
 assert.equal(JSON.stringify(preview).includes('"relation"'), false, 'guest preview payload omits private relations');
 assert.deepEqual(preview.invitation.guests.find(g => g.id === primary).name_display_overrides, { show_titles: false, show_repeated_surname: true });
 assert.deepEqual(preview.invitation.guests.find(g => g.id === unrelated).name_display_overrides, {}, 'a nickname is never a guest display override');

 const template = await q('SELECT public.admin_save_invitation_template(NULL,$1) v', [{
   name: 'Synthetic greeting', channels: ['sms'], versions: { en: {
     options: ['subject', 'message', 'shortMessage'], subject: 'Hello {contact_salutation}',
     body: 'Dear {contact_salutation}, {invitation_link}', short_body: '{contact_salutation}: {invitation_link}',
   } },
 }]);
 assert.ok(template);
 await assert.rejects(db.query("SELECT public.admin_save_food_interest_reply('{\"en\":\"{contact_salutation}\"}','{}','[]')"), /Invalid food interest reply placeholder/);

 await db.exec('RESET ROLE');
 const restricted = await q("SELECT app_private.permission_preset('custom') v");
 restricted.sections.invites = 'view';
 const setAccess = async access => {
   await db.exec('RESET ROLE');
   await db.query('UPDATE public.admins SET access_permissions=$1', [access]);
   await db.exec('SET ROLE authenticated');
 };
 await setAccess(restricted);
 const load = () => q('SELECT public.admin_load_data(true) v');
 const inviteData = await load();
 assert.equal(Object.hasOwn(inviteData.households.find(h => h.id === salutationHousehold), 'invitation_salutation'), false);
 assert.deepEqual(inviteData.settings.guest_interface_modes, { wide: { ...current, show_repeated_surname: true, guest_show_titles: true } });
 assert.deepEqual(inviteData.settings.guest_title_visibility, {}, 'Invites can render the guest title fallback when Settings is unavailable');
 const visibleGuest = guestId => inviteData.guests.find(g => g.id === guestId);
 assert.deepEqual([visibleGuest(primary).courtesy_title, visibleGuest(primary).relation, visibleGuest(primary).invitation_salutation], ['Ms.', 'Parent', salutation]);
 assert.deepEqual([visibleGuest(linked).courtesy_title, visibleGuest(linked).relation, visibleGuest(linked).invitation_salutation], ['Ms.', 'Sibling', linkedSalutation]);
 assert.equal(Object.hasOwn(visibleGuest(unrelated), 'relation'), false);
 assert.equal(Object.hasOwn(visibleGuest(unrelated), 'invitation_salutation'), false);
 await assert.rejects(savePrimary({ invitation_salutation: null }), /permission/i);
 restricted.sections.invites = 'none'; restricted.sections.food = 'view';
 await setAccess(restricted);
 const foodData = await load();
 assert.equal(Object.hasOwn(foodData.guests.find(g => g.id === primary), 'relation'), false);
 assert.equal(Object.hasOwn(foodData.guests.find(g => g.id === primary), 'invitation_salutation'), false);
 assert.equal(Object.hasOwn(foodData.settings, 'guest_interface_modes'), false);
 assert.deepEqual(foodData.settings.guest_title_visibility, {});

 await db.exec("RESET ROLE;UPDATE public.admins SET access_permissions=app_private.permission_preset('full');SET ROLE authenticated");
 for (const partial of [false, true]) {
   const file = await q(partial
     ? "SELECT public.admin_export_backup('template',ARRAY['households'],false) v" : 'SELECT public.admin_export_backup() v');
   assert.equal(Object.hasOwn(file.payload.tables['public.households'].find(h => h.id === salutationHousehold), 'invitation_salutation'), false);
   assert.deepEqual(file.payload.tables['public.guests'].find(g => g.id === primary).invitation_salutation, salutation);
   const destination = await createDatabase();
   try {
     await signIn(destination);
     const [{ v: restoreInfo }] = (await destination.query('SELECT public.admin_preview_backup($1) v', [file])).rows;
     assert.equal(restoreInfo.can_restore, true, restoreInfo.reason);
     await destination.query('SELECT public.admin_restore_backup($1,$2,$3,$4,false)', [file, 'RESTORE ' + restoreInfo.event_name,
       partial ? 'template' : 'backup', file.payload.selection.sections]);
     const [{ v: restored }] = (await destination.query('SELECT invitation_salutation v FROM public.guests WHERE id=$1', [primary])).rows;
     assert.deepEqual(restored, salutation);
     const [{ v: restoredTitleMode }] = (await destination.query("SELECT guest_interface_modes->'wide'->'guest_show_titles' v FROM public.event_settings WHERE id=1")).rows;
     assert.equal(restoredTitleMode, true);
   } finally { await destination.close(); }
 }
 console.log('PASS surname defaults/unanimous/mixed/missing cases; household create/edit/validation/guest projection/backup; atomic name preferences, stale and direct-write/permission guards.');
 console.log('PASS guest invitation salutation creation, validation and reset, scoped delivery tokens and recipient data, and Full and Partial backup/restore.');
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});

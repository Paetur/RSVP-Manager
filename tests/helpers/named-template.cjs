// Save through the current named-template API in disposable database tests.
async function saveTemplate(db, { language='en', channel='whatsapp', subject='', body='{invitation_link}', image=null, name='Synthetic invitation' } = {}) {
 const loaded=(await db.query('SELECT public.admin_load_data() v')).rows[0].v;
 const current=loaded.invitationTemplates.find(t=>t.name===name);
 return db.query('SELECT public.admin_save_invitation_template($1,$2,$3)',[current?.id||null,{ name,channels:[channel],versions:{...current?.versions,[language]:{subject,body,message_image:image}} },current||null]);
}
module.exports={saveTemplate};

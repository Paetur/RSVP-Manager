// Synthetic records in disposable PostgreSQL only. Never reads installation config.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createDatabase, signIn } = require('./alpha-database.cjs');
const admin = '11111111-1111-4111-8111-111111111111';
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const phones = ['+19995550101', '+19995550102'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function createShortcutFixture({ count = 11 } = {}) {
  const db = await createDatabase();
  try {
    const q = (sql, args = []) => db.query(sql, args);
    const value = async (sql, args = []) => (await q(sql, args)).rows[0].v;
    const owner = () => db.exec('RESET ROLE');
    const asAdmin = () => db.exec('SET ROLE authenticated');
    const asService = () => db.exec('SET ROLE service_role');
    await signIn(db);
    // Every delivery fixture opts into the otherwise-disabled experiment.
    await value('SELECT public.admin_set_shortcuts_enabled(true,false) v');
    const households = [], contacts = [], deliveries = [];
    for (let i = 0; i < count; i++) {
      const id = await value('SELECT public.admin_save_household(null,$1) v', [{ household_name: `Synthetic Shortcuts ${i + 1}`, planning_group_id: 'general', language: 'en' }]);
      await q('SELECT public.admin_create_guest($1,$2)', [id, { first_name: `Example ${i + 1}`, mobile: phones[i % 2], preferred_contact_method: 'whatsapp' }]);
      contacts.push(await value('SELECT public.admin_save_contact(null,$1,$2) v', [id, { contact_name: `Example ${i + 1}`, contact_type: 'phone', contact_value: phones[i % 2], is_primary: true, preferred_method: 'whatsapp' }]));
      households.push(id);
    }
    await q('UPDATE public.event_settings SET is_published=true WHERE id=1');
    const image = { image: 'data:image/jpeg;base64,' + fs.readFileSync('tests/fixtures/shortcut-test.jpg').toString('base64'), name: 'synthetic-celebration.jpg', crop: { x: 0, y: 0, width: 640, height: 400, sourceWidth: 640, sourceHeight: 400 } };
    for (let i = 0; i < count; i++) {
      const code = await value('SELECT invite_code v FROM public.households WHERE id=$1', [households[i]]);
      const id = await value('SELECT public.admin_save_delivery(null,$1,$2,null) v', [households[i], { contact_id: contacts[i], channel: 'whatsapp', status: 'ready', message_body: `Synthetic invitation ${i + 1}\nhttps://example.invalid/?=${code}`, message_image: i < 6 || i % 2 === 0 ? image : null }]);
      deliveries.push({ queue_id: id, expected_revision: 1 });
    }
    async function configureTests() {
      await owner();
      await q('UPDATE app_private.shortcut_runtime SET test_enabled=true,test_household_ids=$1,test_phones=$2 WHERE singleton', [households.slice(0, 6), phones]);
      await asAdmin();
    }
    async function createBatch(items = deliveries.slice(0, 1), mode = 'live', retry = false) {
      await asAdmin();
      return value('SELECT public.admin_create_shortcut_batch($1,$2,$3) v', [items, mode, retry]);
    }
    async function dispatch(batch, action, payload = {}) {
      await asService();
      return value('SELECT public.dispatch_shortcut_batch($1,$2,$3,$4) v', [batch.batch_id, hash(batch.capability), action, payload]);
    }
    return { db, q, value, owner, asAdmin, asService, households, deliveries, image, phones, admin, session, configureTests, createBatch, dispatch };
  } catch (error) { await db.close(); throw error; }
}
module.exports = { createShortcutFixture, hash };

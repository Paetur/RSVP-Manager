// Fresh and upgraded installations must share a field contract, regardless of column ordinals.
const assert = require("node:assert/strict"), fs = require("node:fs");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const fresh = await createDatabase(), upgraded = await createDatabase({ install: false });
  try {
    let sql = fs.readFileSync("supabase/install.sql", "utf8");
    for (const [table, names] of [
      ["public.event_settings", ["guest_title_visibility", "show_repeated_surname", "invitation_picture_album"]],
      ["public.message_templates", ["message_image"]],
      ["public.invitation_send_queue", ["message_image"]],
    ]) {
      const start = sql.indexOf("CREATE TABLE " + table + " ("), end = sql.indexOf("\n);", start);
      let block = sql.slice(start, end), moved = "";
      for (const name of names) {
        const line = block.match(new RegExp("^    " + name + " [^\\n]+\\n", "m"));
        assert.ok(line, table + "." + name); moved += line[0]; block = block.replace(line[0], "");
      }
      const at = block.indexOf("    CONSTRAINT ");
      assert.ok(at > 0); block = block.slice(0, at) + moved + block.slice(at);
      sql = sql.slice(0, start) + block + sql.slice(end);
    }
    await upgraded.exec(sql);
    const value = async (db, query, args = []) => (await db.query(query, args)).rows[0].v;
    for (const table of ["public.event_settings", "public.message_templates", "public.invitation_send_queue"]) {
      assert.notDeepEqual(await value(fresh, "SELECT array_agg(attname ORDER BY attnum) v FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped", [table]), await value(upgraded, "SELECT array_agg(attname ORDER BY attnum) v FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped", [table]));
      assert.deepEqual(await value(fresh, "SELECT app_private.backup_columns($1) v", [table]), await value(upgraded, "SELECT app_private.backup_columns($1) v", [table]));
    }
    await signIn(fresh); await signIn(upgraded);
    const group = await value(fresh, "SELECT planning_config->'groups'->0->>'id' v FROM public.event_settings WHERE id=1");
    const id = await value(fresh, "SELECT public.admin_save_household(NULL,$1) v", [{ household_name: "Synthetic", last_name: "Family", planning_group_id: group, language: "en" }]);
    await fresh.exec("RESET ROLE"); await fresh.query("INSERT INTO public.guests(household_id,first_name,last_name) VALUES($1,'Alex','Family')", [id]); await fresh.exec("SET ROLE authenticated");
    const backup = await value(fresh, "SELECT public.admin_export_backup() v");
    const preview = await value(upgraded, "SELECT public.admin_preview_backup($1) v", [backup]); assert.equal(preview.can_restore, true, preview.reason);
    const result = await value(upgraded, "SELECT public.admin_restore_backup($1,$2) v", [backup, "RESTORE " + preview.event_name]); assert.equal(result.restored, true);
    assert.equal(await value(upgraded, "SELECT last_name v FROM public.households WHERE id=$1", [id]), "Family");
    const malformed = JSON.parse(JSON.stringify(backup)); malformed.payload.columns["public.guests"][0].type = "invalid";
    await upgraded.exec("RESET ROLE"); const bad = await value(upgraded, "SELECT app_private.seal_backup($1) v", [malformed.payload]); await assert.rejects(upgraded.query("SELECT app_private.validate_backup($1)", [bad]), /Schema mismatch/);
    await upgraded.exec("SET ROLE authenticated"); await assert.rejects(upgraded.query("SELECT public.admin_preview_event_replacement($1)", [backup]), /this installation/);
    console.log("PASS canonical backup fields across different physical column orders, cross-layout Full recovery, exact type validation and unchanged replacement-origin guard.");
  } finally { await fresh.close(); await upgraded.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

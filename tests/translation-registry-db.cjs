// Current registry storage and permissions; no upgrade paths or live projects.
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
(async () => {
  const db = await createDatabase();
  const v = async (s, a = []) => (await db.query(s, a)).rows[0].v;
  try {
    const help =
      "Date filters use the event timezone. Entries show your local time. Expand an entry for its UTC time and details. Household and guest archive, restore and deletion are logged.";
    const aliases = JSON.parse(fs.readFileSync("locales/aliases.json", "utf8"));
    assert.deepEqual(
      await v("SELECT app_private.translation_keys() v"),
      aliases,
    );
    assert.ok(aliases[help]);
    assert.ok(aliases.Link);
    assert.equal(
      await v(
        "SELECT has_function_privilege('anon','app_private.translation_keys()','execute') v",
      ),
      false,
    );
    await signIn(db);
    for (const [source, language, text] of [
      [help, "fo", "Núverandi hjálp"],
      ["Link", "de", "Verknüpfung"],
    ]) {
      await db.query("SELECT public.admin_save_translation($1,$2,$3)", [
        "ui:" + source,
        language,
        text,
      ]);
      const saved = await v(
        "SELECT to_jsonb(t) v FROM public.translation_overrides t WHERE source_text=$1 AND language_code=$2",
        [source, language],
      );
      assert.equal(saved.translation_key, aliases[source]);
      assert.equal(saved.value, text);
    }
    const backup = await v("SELECT public.admin_export_backup() v");
    assert.equal(
      backup.payload.tables["public.translation_overrides"].length,
      2,
    );
    assert.equal(
      (await v("SELECT public.admin_preview_backup($1) v", [backup]))
        .can_restore,
      false,
      "restore refuses a populated source database",
    );
    assert.equal(
      await v("SELECT is_published v FROM public.event_settings"),
      false,
    );
    await db.exec(
      "RESET ROLE;UPDATE public.admins SET access_permissions=app_private.permission_preset('view');SET ROLE authenticated",
    );
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_translation('ui:Link','fo','Blocked')",
        ),
      /permission/i,
    );
    await db.exec("RESET ROLE;SET ROLE anon");
    await assert.rejects(
      () =>
        db.query(
          "SELECT public.admin_save_translation('ui:Link','fo','Blocked')",
        ),
      /permission/i,
    );
    await assert.rejects(
      () => db.query("SELECT * FROM public.translation_overrides"),
      /permission/i,
    );
    assert.equal(await v("SELECT public.get_public_event() v"), null);
    console.log(
      "PASS current registry, canonical log-help/Link overrides, backup inclusion and permission denials.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

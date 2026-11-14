// Fresh installation, transaction rollback and replay protection in disposable databases.
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { createDatabase } = require("./helpers/alpha-database.cjs");
const sql = fs.readFileSync("supabase/install.sql", "utf8");
(async () => {
  const db = await createDatabase();
  const v = async (q, a = []) => (await db.query(q, a)).rows[0].v;
  try {
    const tables = (
      await db.query(
        "SELECT n.nspname schema,c.relname name,c.relrowsecurity rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app_private') AND c.relkind='r' ORDER BY 1,2",
      )
    ).rows;
    assert.equal(tables.filter((t) => t.schema === "public").length, 42);
    assert.equal(tables.filter((t) => t.schema === "app_private").length, 5);
    assert.ok(tables.filter((t) => t.schema === "public").every((t) => t.rls));
    for (const name of [
      "stuff_to_bring",
      "things_to_do",
      "legacy_stuff_to_bring",
      "restored_activity_logs",
    ])
      assert.ok(!tables.some((t) => t.name === name));
    const otherColumns = (
      await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('other_categories','other_items')",
      )
    ).rows.map((r) => r.column_name);
    for (const name of [
      "source_id",
      "source_kind",
      "legacy_key",
      "due_date",
      "quantity",
    ])
      assert.ok(!otherColumns.includes(name));
    assert.equal(
      await v("SELECT is_published v FROM public.event_settings"),
      false,
    );
    assert.equal(await v("SELECT count(*)::int v FROM public.households"), 0);
    assert.equal(await v("SELECT count(*)::int v FROM public.guests"), 0);
    const payload = await v("SELECT app_private.backup_payload() v");
    assert.equal(
      payload.schema_version,
      JSON.parse(
        fs.readFileSync(fs.existsSync("version.json") ? "version.json" : "release/manifest.json"),
      ).backupSchema,
    );
    assert.equal(Object.keys(payload.tables).length, 40);
    // Studio may append automatic RLS statements for every CREATE TABLE. All targets must still exist.
    const created = [
      ...sql.matchAll(/^CREATE TABLE ((?:public|app_private)\.[a-z_]+) \(/gm),
    ].map((m) => m[1]);
    assert.equal(created.length, 47);
    await db.exec(
      created
        .map((name) => "ALTER TABLE " + name + " ENABLE ROW LEVEL SECURITY;")
        .join("\n"),
    );
    await db.exec(
      "UPDATE public.event_settings SET event_name='Keep synthetic event'",
    );
    await assert.rejects(() => db.exec(sql), /empty application schema/);
    await db.exec("ROLLBACK");
    assert.equal(
      await v("SELECT event_name v FROM public.event_settings"),
      "Keep synthetic event",
    );
    await db.exec("SET ROLE anon");
    assert.equal(await v("SELECT public.get_public_event() v"), null);
    assert.equal(await v("SELECT public.get_public_event_v2() v"), null);
    await assert.rejects(
      () => db.query("SELECT * FROM public.guests"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("UPDATE public.event_settings SET is_published=true"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
  const aborted = await createDatabase({ install: false });
  try {
    const injected = sql.replace(
      /COMMIT;\s*$/,
      () =>
        "DO $$ BEGIN RAISE EXCEPTION 'synthetic install failure'; END $$; COMMIT;",
    );
    assert.notEqual(injected, sql);
    await assert.rejects(
      () => aborted.exec(injected),
      /synthetic install failure/,
    );
    await aborted.exec("ROLLBACK");
    assert.equal(
      (
        await aborted.query(
          "SELECT count(*)::int n FROM pg_tables WHERE schemaname IN ('public','app_private')",
        )
      ).rows[0].n,
      0,
    );
    await aborted.exec(
      "CREATE TABLE public.unrelated(value text);INSERT INTO public.unrelated VALUES('keep')",
    );
    await assert.rejects(() => aborted.exec(sql), /empty application schema/);
    await aborted.exec("ROLLBACK");
    assert.equal(
      (await aborted.query("SELECT value FROM public.unrelated")).rows[0].value,
      "keep",
    );
  } finally {
    await aborted.close();
  }
  console.log(
    "PASS fresh alpha baseline: complete current schema, RLS, backup contract, empty unpublished defaults, Studio RLS additions, atomic rollback and installed-data guard.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

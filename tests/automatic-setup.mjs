// Real installer/schema/Auth-client workflow against disposable SQL and synthetic HTTP.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  Installation,
  installationAssets,
} from "../setup-service/installation.ts";
import { credentials, Management } from "../setup-service/management.ts";
const require = createRequire(import.meta.url),
  { fixture } = require("./helpers/setup-management-fixture.cjs");
const assets = installationAssets(process.cwd());
const password = "Correct setup password 123!";
async function connection(f) {
  const install = new Installation(f.config, assets, f.fetcher);
  await install.connect();
  return install;
}
async function finish(install) {
  for (const name of ["secrets", "functions", "configuration", "verification"])
    await install.run(name);
}
const f = await fixture();
try {
  for (const change of [
    { projectUrl: "https://attacker.example.invalid" },
    { publicKey: f.config.serviceKey },
    { serviceKey: f.config.publicKey },
    { projectRef: "differentprojectrefxx" },
    { siteUrl: "https://user:password@event.example.invalid/" },
  ])
    assert.throws(() => credentials({ ...f.config, ...change }));
  const bad = new Installation(
    { ...f.config, accessToken: "sbp_invalid_synthetic_access_token" },
    assets,
    f.fetcher,
  );
  await assert.rejects(() => bad.connect(), /access token/i);
  f.state.fail = { path: "/functions", method: "GET", status: 403 };
  await assert.rejects(() => connection(f), /permission/i);
  let install = await connection(f);
  assert.equal(install.publicState().steps.database, false);
  await assert.rejects(() => install.run("functions"), /preceding/);
  f.state.failSql = true;
  await assert.rejects(() => install.run("database"));
  assert.equal(
    (
      await f.db.query(
        "SELECT to_regclass('public.event_settings') AS table_name",
      )
    ).rows[0].table_name,
    null,
    "failed transaction leaves no application schema",
  );
  await install.run("database");
  assert.equal(install.publicState().steps.database, true);
  const backupOrigin = (await f.db.query("SELECT installation_id FROM app_private.backup_origin WHERE singleton")).rows[0].installation_id;
  assert.ok(backupOrigin);
  await install.run("database");
  assert.equal((await f.db.query("SELECT installation_id FROM app_private.backup_origin WHERE singleton")).rows[0].installation_id, backupOrigin, "retry preserves the backup installation identity");
  assert.equal(
    (await f.db.query("SELECT is_published FROM public.event_settings")).rows[0]
      .is_published,
    false,
  );
  f.state.loseCreate = true;
  await assert.rejects(() =>
    install.run("administrator", { email: "owner@example.invalid", password }),
  );
  assert.equal(f.state.created, 1, "Auth can commit before a lost response");
  install = await connection(f);
  await install.run("administrator", {
    email: "owner@example.invalid",
    password,
  });
  assert.equal(f.state.created, 1, "retry reuses Auth user");
  assert.equal(
    (await f.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0]
      .n,
    1,
  );
  assert.deepEqual(f.state.createdBodies[0], {
    email: "owner@example.invalid",
    password,
    email_confirm: true,
  });
  const auth = (await f.db.query("SELECT email_confirmed_at FROM auth.users"))
    .rows[0];
  assert(auth.email_confirmed_at);
  const admin = (
    await f.db.query(
      "SELECT access_state,access_permissions FROM public.admins",
    )
  ).rows[0];
  assert.equal(admin.access_state, "active");
  assert.equal(admin.access_permissions.preset, "full");
  const createdBeforeReplay = f.state.created;
  await install.run("administrator", { email: "other@example.invalid", password });
  assert.equal(f.state.created, createdBeforeReplay, "completed first-admin step never creates or claims another Auth account");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0].n, 1);
  await assert.rejects(
    () =>
      install.run("secrets", {
        optional: [
          { name: "RSVP_ACCIDENTAL_TOKEN", value: f.config.accessToken },
        ],
      }),
    /Optional secrets/,
  );
  f.state.fail = { path: "/secrets", method: "POST", status: 403 };
  await assert.rejects(() => install.run("secrets"), /permission/);
  await install.run("secrets", {
    optional: [{ name: "RSVP_OPTIONAL_TEST", value: "optional secret value" }],
  });
  assert.equal(f.secrets.get("UNRELATED_SECRET"), "keep-this-value");
  assert(
    !JSON.stringify(install.publicState()).includes("optional secret value"),
  );
  f.state.fail = { path: "/functions/deploy", method: "POST", status: 500 };
  await assert.rejects(
    () => install.run("functions"),
    (error) =>
      !error.message.includes(f.config.serviceKey) &&
      !error.message.includes(f.config.accessToken),
  );
  install = await connection(f);
  assert.equal(install.publicState().steps.administrator, true);
  assert.equal(install.publicState().steps.secrets, true);
  f.functions.set("unrelated", {
    slug: "unrelated",
    name: "Keep",
    status: "ACTIVE",
    verify_jwt: true,
  });
  f.functions.set("guest-gateway", {
    slug: "guest-gateway",
    name: "Keep custom name",
    status: "ACTIVE",
    verify_jwt: true,
  });
  await assert.rejects(() => install.run("functions"), /JWT/);
  assert.equal(f.functions.get("guest-gateway").verify_jwt, true);
  f.functions.get("guest-gateway").verify_jwt = false;
  await install.run("functions");
  assert.equal(f.functions.get("guest-gateway").name, "Keep custom name");
  assert.equal(f.functions.get("unrelated").verify_jwt, true);
  await install.run("configuration");
  assert(f.authConfig.uri_allow_list.includes("https://keep.example.invalid/"));
  assert(
    f.authConfig.uri_allow_list.includes("/wedding/admin/?admin-invitation=1"),
  );
  assert(!f.restConfig.db_schema.includes("app_private"));
  await assert.rejects(
    () => install.rows("SELECT app_private.permission_preset('full') AS preset", [], true),
    (error) => error.code === "management" && error.status === 502,
    "Management's read-only role cannot execute the private permission helper",
  );
  assert.match(f.state.lastSqlError, /permission denied for function permission_preset/);
  const helperAccess = (await f.db.query(
    "SELECT has_function_privilege('anon','app_private.permission_preset(text)','EXECUTE') AS anon,has_function_privilege('authenticated','app_private.permission_preset(text)','EXECUTE') AS authenticated,has_function_privilege('service_role','app_private.permission_preset(text)','EXECUTE') AS service_role",
  )).rows[0];
  assert.deepEqual(helperAccess, { anon: false, authenticated: false, service_role: false });
  f.secrets.delete("RSVP_SITE_ORIGIN");
  await assert.rejects(() => install.run("verification"), /secret/);
  assert.equal(
    (
      await f.db.query(
        "SELECT initialized_at FROM app_private.installation_state",
      )
    ).rows[0].initialized_at,
    null,
  );
  await install.run("secrets");
  await install.run("verification");
  assert.equal(install.publicState().initialized, true);
  await install.run("verification");
  const saved = JSON.stringify(
    (
      await f.db.query(
        "SELECT to_jsonb(s) AS state FROM app_private.installation_state s",
      )
    ).rows,
  );
  assert(!saved.includes(password));
  assert(!saved.includes(f.config.serviceKey));
  assert(!saved.includes(f.config.accessToken));
  await f.db.exec("SET ROLE anon");
  const publicStatus = (
    await f.db.query("SELECT public.get_setup_status() AS state")
  ).rows[0].state;
  assert.deepEqual(Object.keys(publicStatus).sort(), [
    "initialized",
    "schema_version",
    "setup_locked",
  ]);
  assert.equal(publicStatus.initialized, true);
  assert.equal(publicStatus.setup_locked, true);
  await assert.rejects(
    () => f.db.query("SELECT * FROM app_private.installation_state"),
    /permission/,
  );
  await f.db.exec("RESET ROLE");
  const before = f.calls.filter(
    (c) => c.method !== "GET" && !c.path.endsWith("/database/query"),
  ).length;
  const existing = await connection(f);
  assert.equal(existing.publicState().initialized, true);
  for (const step of ["database", "administrator", "secrets", "functions", "configuration", "verification"])
    await existing.run(step, { email: "another@example.invalid", password });
  assert.equal(
    f.calls.filter(
      (c) => c.method !== "GET" && !c.path.endsWith("/database/query"),
    ).length,
    before,
    "initialized target is not reconfigured",
  );
  const exposed = JSON.stringify(existing.publicState());
  for (const secret of [f.config.serviceKey, f.config.accessToken, password])
    assert(!exposed.includes(secret));
  existing.forget();
  assert.equal(existing.config.accessToken, "");
  assert.equal(existing.config.serviceKey, "");
} finally {
  await f.db.close();
}

// Missing-object repair preserves rows and refuses incompatible table structure atomically.
const partial = await fixture({ installed: true });
try {
  await partial.db.query(
    "UPDATE public.event_settings SET event_name='Keep this event'",
  );
  const shortcutRuntime = (await partial.db.query(
    "UPDATE app_private.shortcut_runtime SET enabled=true WHERE singleton RETURNING generation,enabled",
  )).rows[0];
  await partial.db.exec(
    `DROP FUNCTION public.get_setup_status();
     DROP FUNCTION public.guest_gateway_allow_request(text,text,text);
     DROP POLICY section_update ON public.venue_translations;
     DROP TRIGGER IF EXISTS food_claim_audit ON public.food_claims;
     DROP TRIGGER guest_overview_visit ON public.households;
     DROP TRIGGER track_admin_change ON public.households;
     DROP TRIGGER commit_admin_change ON app_private.admin_change_pending;
     ALTER TABLE public.invitation_send_queue DROP COLUMN handed_to_shortcuts_at;
     ALTER TABLE public.households DROP CONSTRAINT households_visit_order, DROP COLUMN visit_count;
     DELETE FROM app_private.admin_change_clock WHERE singleton;
     DELETE FROM app_private.guest_visit_scope WHERE singleton;`,
  );
  const install = await connection(partial);
  await install.run("database");
  assert.equal(
    (await partial.db.query("SELECT event_name FROM public.event_settings"))
      .rows[0].event_name,
    "Keep this event",
  );
  assert.equal(
    (await partial.db.query(assets.plan.verifySQL)).rows[0].valid,
    true,
  );
  assert.deepEqual((await partial.db.query(
    "SELECT generation,enabled FROM app_private.shortcut_runtime WHERE singleton",
  )).rows[0], shortcutRuntime, "repair preserves the configured Shortcuts singleton");
  assert.ok((await partial.db.query(
    "SELECT generation FROM app_private.guest_visit_scope WHERE singleton",
  )).rows[0]?.generation, "repair seeds the missing guest visit singleton");
  assert.ok((await partial.db.query(
    "SELECT revisions->>'reset' AS revision FROM app_private.admin_change_clock WHERE singleton",
  )).rows[0]?.revision, "repair seeds the administrator change clock");
  assert.equal((await partial.db.query(`
    SELECT count(*)::int AS count FROM pg_trigger
    WHERE (tgrelid='public.households'::regclass AND tgname IN ('guest_overview_visit','track_admin_change'))
       OR (tgrelid='app_private.admin_change_pending'::regclass AND tgname='commit_admin_change' AND tginitdeferred)
  `)).rows[0].count, 3, "repair restores the guest and administrator change triggers");
  const gateway = (await partial.db.query(`
    SELECT public.guest_gateway_allow_request(repeat('a',64),'ABCDEFGH','acknowledge_household_visit') AS visits_allowed,
           has_function_privilege('anon','public.guest_gateway_allow_request(text,text,text)','EXECUTE') AS anon,
           has_function_privilege('authenticated','public.guest_gateway_allow_request(text,text,text)','EXECUTE') AS authenticated,
           has_function_privilege('service_role','public.guest_gateway_allow_request(text,text,text)','EXECUTE') AS service_role
  `)).rows[0];
  assert.deepEqual(gateway, { visits_allowed: true, anon: false, authenticated: false, service_role: true });
} finally {
  await partial.db.close();
}
const incompatible = await fixture({ installed: true });
try {
  await incompatible.db.exec(
    "ALTER TABLE public.other_items RENAME COLUMN assigned_to TO missing_assignment",
  );
  const install = await connection(incompatible);
  await assert.rejects(() => install.run("database"));
  assert.equal(
    (
      await incompatible.db.query(
        "SELECT count(*)::int AS n FROM app_private.installation_state",
      )
    ).rows[0].n,
    0,
  );
  await incompatible.db.exec(`
    ALTER TABLE public.other_items RENAME COLUMN missing_assignment TO assigned_to;
    ALTER TABLE public.invitation_send_queue ALTER COLUMN shortcuts_error TYPE boolean USING NULL;
  `);
  await assert.rejects(() => install.run("database"));
  assert.match(incompatible.state.lastSqlError, /Existing schema objects are incompatible/);
  await incompatible.db.exec(`
    ALTER TABLE public.invitation_send_queue ALTER COLUMN shortcuts_error TYPE text USING NULL;
    CREATE OR REPLACE FUNCTION public.guest_gateway_allow_request(p_ip_hash text,p_code text,p_action text)
    RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$ SELECT false $$;
  `);
  await assert.rejects(() => install.run("database"));
  assert.match(incompatible.state.lastSqlError, /Existing schema objects are incompatible/);
  assert.equal((await incompatible.db.query(
    "SELECT public.guest_gateway_allow_request(repeat('a',64),'ABCDEFGH','acknowledge_household_visit') AS visits_allowed",
  )).rows[0].visits_allowed, false, "repair leaves an incompatible existing function intact");
  assert.equal((await incompatible.db.query(
    "SELECT count(*)::int AS n FROM app_private.installation_state",
  )).rows[0].n, 0, "incompatible alpha.8 objects cannot claim the installation");
} finally {
  await incompatible.db.close();
}

// Anonymous setup availability never depends only on an active-admin/completion combination.
for (const checkpoint of ["empty", "suspended-administrator", "completed-marker", "published-event"]) {
  const locked = await fixture({ installed: true });
  try {
    if (checkpoint === "suspended-administrator")
      await locked.db.exec("INSERT INTO auth.users(id,email) VALUES('11111111-1111-4111-8111-111111111111','checkpoint@example.invalid');INSERT INTO public.admins(user_id,name,access_state) VALUES('11111111-1111-4111-8111-111111111111','Checkpoint','suspended')");
    if (checkpoint === "completed-marker")
      await locked.db.query(
        "INSERT INTO app_private.installation_state(installation_id,schema_version,release_version,installer_hash,site_url,initialized_at) VALUES('11111111-1111-4111-8111-111111111111',$1,$2,$3,'https://setup.example.invalid/',now())",
        [assets.schema, assets.version, assets.digest]);
    if (checkpoint === "published-event")
      await locked.db.exec("UPDATE public.event_settings SET is_published=true WHERE id=1");
    await locked.db.exec("SET ROLE anon");
    const status = (await locked.db.query("SELECT public.get_setup_status() AS value")).rows[0].value;
    assert.deepEqual(Object.keys(status).sort(), ["initialized", "schema_version", "setup_locked"]);
    assert.equal(status.setup_locked, checkpoint !== "empty", checkpoint);
    assert.equal(status.initialized, false, "setup lock is independent of active/full initialized state");
    await assert.rejects(() => locked.db.query("SELECT first_admin_id,admin_email FROM app_private.installation_state"), /permission/);
    await locked.db.exec("RESET ROLE");
  } finally { await locked.db.close(); }
}
console.log(
  "PASS automated setup: fresh SQL, invalid credentials/permissions, atomic failure/retry, Auth Admin creation and lost-response reuse, closed first-admin replay, protected full administrator, secrets and functions retry/config preservation, partial repair, incompatible-schema refusal, all-step initialized reopen, minimal anonymous setup locks for inactive admin/completed marker/publication, login and secret-free state.",
);

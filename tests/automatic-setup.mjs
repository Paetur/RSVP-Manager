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
  await install.run("database");
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
  await assert.rejects(() =>
    install.run("administrator", { email: "other@example.invalid", password }),
  );
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
  ]);
  assert.equal(publicStatus.initialized, true);
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
  await existing.run("database");
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
  await partial.db.exec(
    "DROP FUNCTION public.get_setup_status();DROP POLICY section_update ON public.venue_translations;DROP TRIGGER IF EXISTS food_claim_audit ON public.food_claims",
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
} finally {
  await incompatible.db.close();
}
console.log(
  "PASS automated setup: fresh SQL, invalid credentials/permissions, atomic failure/retry, Auth Admin creation and lost-response reuse, protected full administrator, secrets and functions retry/config preservation, partial repair, incompatible-schema refusal, completion guards, login and secret-free state.",
);

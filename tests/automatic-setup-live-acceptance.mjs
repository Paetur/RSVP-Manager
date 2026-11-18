// Exercise the live acceptance driver using only disposable SQL and fabricated HTTP.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { acceptAutomaticSetup } from "../tools/accept-automatic-setup.mjs";
import { Installation, installationAssets, steps } from "../setup-service/installation.ts";
const require = createRequire(import.meta.url);
const { fixture } = require("./helpers/setup-management-fixture.cjs");
const assets = installationAssets(process.cwd());
const administrator = { email: "acceptance@example.invalid", password: "Synthetic acceptance password 123!" };
const input = f => ({ credentials: { ...f.config }, administrator: { ...administrator } });
const options = (f, extra = {}) => ({
  root: process.cwd(), acceptedProjectRef: f.config.projectRef, fetcher: f.fetcher,
  attempts: 3, delayMs: 0, timeoutMs: 120000, ...extra
});
const writes = calls => calls.filter(call =>
  call.method !== "GET" && !call.path.endsWith("/database/query"));

const fresh = await fixture();
try {
  fresh.state.activationDelays = 1;
  fresh.state.runtimeDelays = 1;
  const logs = [];
  const result = await acceptAutomaticSetup(input(fresh), options(fresh, { log: entry => logs.push(entry) }));
  assert.equal(result.accepted, true);
  assert.equal(result.administratorLogin, true);
  assert.equal(result.publicConfigurationOnly, true);
  assert.equal(result.initializedReopenWithoutWrites, true);
  assert.equal(result.eventPublished, false);
  assert.equal(result.projectReset, false);
  assert.equal(result.steps.find(step => step.step === "functions").attempts, 2);
  assert.equal(result.steps.find(step => step.step === "verification").attempts, 2);
  assert.equal(fresh.state.created, 1);
  assert.equal((await fresh.db.query("SELECT count(*)::int AS n FROM public.admins")).rows[0].n, 1);
  const exposed = JSON.stringify({ result, logs });
  for (const secret of [fresh.config.serviceKey, fresh.config.accessToken, administrator.password, administrator.email])
    assert(!exposed.includes(secret), "evidence never contains credentials or administrator identity");
  assert(logs.some(entry => entry.step === "functions" && entry.status === "retrying"));
  const before = writes(fresh.calls).length;
  await assert.rejects(() => acceptAutomaticSetup(input(fresh), options(fresh)), error => error.code === "empty_project");
  assert.equal(writes(fresh.calls).length, before, "completed target is refused without mutation");
} finally { await fresh.db.close(); }

for (const mode of ["public-table", "auth-user", "storage-object", "edge-function", "wrong-project"]) {
  const f = await fixture();
  try {
    if (mode === "public-table") await f.db.exec("CREATE TABLE public.operator_data(value text);INSERT INTO public.operator_data VALUES('preserve')");
    if (mode === "auth-user") await f.db.exec("INSERT INTO auth.users(id,email) VALUES('11111111-1111-4111-8111-111111111111','existing@example.invalid')");
    if (mode === "storage-object") await f.db.exec("CREATE SCHEMA storage;CREATE TABLE storage.objects(id integer);INSERT INTO storage.objects VALUES(1)");
    if (mode === "edge-function") f.functions.set("operator-function", { slug: "operator-function", status: "ACTIVE", verify_jwt: true });
    const opts = options(f, mode === "wrong-project" ? { acceptedProjectRef: "zzzzzzzzzzzzzzzzzzzz" } : {});
    await assert.rejects(() => acceptAutomaticSetup(input(f), opts), error =>
      error.code === (mode === "wrong-project" ? "target" : "empty_project"));
    assert.equal(writes(f.calls).length, 0, mode + " refuses before changes");
    assert.equal(f.state.created, 0);
    assert.equal((await f.db.query("SELECT to_regclass('public.event_settings') AS name")).rows[0].name, null);
  } finally { await f.db.close(); }
}

const permission = await fixture();
try {
  permission.state.fail = { path: "/secrets", method: "POST", status: 403 };
  await assert.rejects(() => acceptAutomaticSetup(input(permission), options(permission)), error => error.status === 403);
  assert.equal(permission.calls.filter(call => call.path.endsWith("/secrets") && call.method === "POST").length, 1, "permission failure is not retried");
  const resume = new Installation(permission.config, assets, permission.fetcher);
  await resume.connect();
  assert.equal(resume.publicState().steps.administrator, true);
  for (const step of steps.slice(2)) await resume.run(step);
  assert.equal(resume.publicState().initialized, true, "operator can resume preserved project with companion");
  assert.equal(permission.state.created, 1, "resuming does not duplicate Auth account");
  resume.forget();
} finally { await permission.db.close(); }
console.log("PASS automatic setup acceptance driver: exact empty-project opt-in; public/Auth/storage/function refusal without writes; bounded activation/runtime retries; real-client admin login; public-only status/config; closed reopen; sanitized evidence; permission stop and preserved resume. Synthetic fixtures only.");

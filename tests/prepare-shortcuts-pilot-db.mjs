// The real pilot driver through supported RPCs in disposable PGlite, followed
// by the actual browser helper's fixture validator. No network/Auth service.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { executePilot } from "../tools/prepare-shortcuts-pilot.mjs";
const require = createRequire(import.meta.url);
const { createDatabase, signIn } = require("./helpers/alpha-database.cjs");
const db = await createDatabase();
const projectRef = "abcdefghijklmnopqrst", projectUrl = "https://" + projectRef + ".supabase.co", siteUrl = "https://site.example.invalid/";
// Syntax-only transport fixture; signIn establishes the disposable DB session.
const token = Buffer.from('{"alg":"none"}').toString("base64url") + "." + Buffer.from(JSON.stringify({
  role: "authenticated", sub: "11111111-1111-4111-8111-111111111111", session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  iss: projectUrl + "/auth/v1", exp: 4000000000,
})).toString("base64url") + ".synthetic";
const phones = ["+19995550101", "+19995550102"], publicKey = "sb_publishable_synthetic_fixture_only";
const input = { projectUrl, publicKey, accessToken: token, testPhones: phones, siteUrl, mode: "dry_run" };
const rpcStatements = {
  admin_load_data: ["SELECT public.admin_load_data() v", []],
  admin_save_household: ["SELECT public.admin_save_household($1,$2) v", ["p_id", "p_values"]],
  admin_save_guest_details: ["SELECT public.admin_save_guest_details($1,$2,$3) v", ["p_guest_id", "p_household_id", "p_values"]],
  admin_save_contact: ["SELECT public.admin_save_contact($1,$2,$3) v", ["p_id", "p_household_id", "p_values"]],
  admin_set_household_primary_guest: ["SELECT public.admin_set_household_primary_guest($1,$2) v", ["p_household_id", "p_guest_id"]],
  admin_save_delivery: ["SELECT public.admin_save_delivery($1,$2,$3,$4) v", ["p_id", "p_household_id", "p_values", "p_expected_revision"]],
  admin_create_shortcut_batch: ["SELECT public.admin_create_shortcut_batch($1,$2,$3) v", ["p_items", "p_mode", "p_retry"]],
};
let state = null;
const artifacts = [], calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Disposable driver acceptance must not contact a network"); };
try {
  await signIn(db);
  await db.exec("RESET ROLE");
  await db.query("UPDATE public.event_settings SET event_name=$1,is_published=false WHERE id=1", ["SYNTHETIC SHORTCUTS TEST"]);
  await db.exec("SET ROLE authenticated");
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, projectUrl); assert.equal(options.redirect, "error");
    assert.equal(options.headers.apikey, publicKey); assert.equal(options.headers.Authorization, "Bearer " + token);
    const name = parsed.pathname.split("/").at(-1), statement = rpcStatements[name];
    assert(statement, "only explicitly allowlisted administrator RPCs run");
    const values = JSON.parse(options.body); calls.push(name);
    const result = (await db.query(statement[0], statement[1].map(key => values[key]))).rows[0].v;
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const execute = (phase, mode) => executePilot({ phase, input: { ...input, mode }, expectedProjectRef: projectRef, state,
    fetchImpl, imageBytes: new Uint8Array(fs.readFileSync("tests/fixtures/shortcut-test.jpg")),
    saveState: value => { state = JSON.parse(JSON.stringify(value)); }, writeArtifact: value => artifacts.push(value) });
  assert.equal((await execute("seed", "dry_run")).state, "seeded");
  assert.equal(state.households.length, 6);
  await db.exec("RESET ROLE");
  await db.query("UPDATE app_private.shortcut_runtime SET test_enabled=true,test_household_ids=$1,test_phones=$2 WHERE singleton", [state.households.map(item => item.id), phones]);
  await db.exec("UPDATE public.event_settings SET is_published=true WHERE id=1; SET ROLE authenticated");
  assert.equal((await execute("batch", "dry_run")).state, "batch_created");
  assert.equal((await execute("batch", "live_test")).state, "batch_created");
  const data = (await db.query("SELECT public.admin_load_data() v")).rows[0].v;
  assert.equal(data.queue.length, 12);
  assert.equal(new Set(data.queue.map(row => row.id)).size, 12);
  for (const item of state.households) {
    const household = data.households.find(row => row.id === item.id), contact = data.contacts.find(row => row.id === item.contact_id);
    assert.equal(household.primary_guest_id, item.guest_id);
    assert.equal(contact.guest_id, item.guest_id);
    assert.notEqual(contact.is_household_primary, true, "supported primary guest/contact selection remains exclusive");
  }
  const stubs = new Map();
  const element = key => {
    if (!stubs.has(key)) stubs.set(key, { value: "", disabled: false, checked: false,
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {} });
    return stubs.get(key);
  };
  const window = { RSVP_CONFIG: { supabaseUrl: projectUrl, supabaseKey: publicKey }, indexedDB: {}, addEventListener() {} };
  const context = vm.createContext({ window, document: { getElementById: element }, URL, location: new URL(siteUrl),
    fetch: globalThis.fetch, Uint8Array, TextDecoder, atob: value => Buffer.from(value, "base64").toString("binary") });
  vm.runInContext(fs.readFileSync("js/shortcuts-test-page.js", "utf8"), context);
  const verifyReady = window.RSVPShortcutsTestPage.verifyReady;
  assert.equal(typeof verifyReady, "function");
  for (const mode of ["dry_run", "live_test"]) {
    const reviewed = verifyReady(data, mode, siteUrl);
    assert.equal(reviewed.length, 6); assert.equal(new Set(reviewed.map(row => row.phone)).size, 2);
    assert.equal(new Set(reviewed.map(row => row.body)).size, 6);
    assert(reviewed.every(row => row.body.includes(mode) && row.body.includes(row.household)));
    assert.deepEqual([...new Set(reviewed.map(row => row.queue_id))].sort(), artifacts.find(item => item.mode === mode) ?
      state.runs.find(run => run.mode === mode).queue_ids.slice().sort() : []);
  }
  const invalid = structuredClone(data); invalid.contacts[0].is_household_primary = true;
  assert.throws(() => verifyReady(invalid, "dry_run", siteUrl), "unsupported dual primary selection is rejected");
  assert.equal(data.deliveries.length, 0, "no manual Sent operation");
  assert.equal(calls.filter(name => name === "admin_set_household_primary_guest").length, 6);
  assert.equal(calls.filter(name => name === "admin_create_shortcut_batch").length, 2);
  process.stdout.write("PASS disposable pilot-driver DB integration: supported guest/contact/primary RPCs, six synthetic households, twelve fresh mode snapshots, two batches and actual browser fixture validator; no network, live Auth, Sent or provider calls.\n");
} finally { globalThis.fetch = originalFetch; await db.close(); }

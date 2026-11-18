// Entirely synthetic injected-fetch acceptance. Never contacts a project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executePilot, validateInput, validatePrivatePath, writePrivate, readPrivate } from "../tools/prepare-shortcuts-pilot.mjs";
const clone = value => JSON.parse(JSON.stringify(value));
const uuid = value => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
const projectRef = "abcdefghijklmnopqrst", projectUrl = "https://" + projectRef + ".supabase.co";
// Unsigned fixture strings exist only in this no-network mock test.
const jwt = claims => Buffer.from('{"alg":"none"}').toString("base64url") + "." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".synthetic";
const token = jwt({ role: "authenticated", sub: uuid(900), session_id: uuid(901), iss: projectUrl + "/auth/v1", exp: 4000000000 });
const publicKey = "sb_publishable_synthetic_fixture_only";
const phones = ["+19995550101", "+19995550102"];
const config = () => ({ projectUrl, publicKey, accessToken: token, testPhones: [...phones], siteUrl: "https://site.example.invalid/pilot/", mode: "dry_run" });
const jpeg = Uint8Array.from([255, 216, 1, 2, 3, 255, 217]);
let checks = 0;
async function test(name, callback) { await callback(); checks++; process.stdout.write("PASS " + name + "\n"); }
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

function fixture() {
  let next = 1, saved = null;
  const calls = [], states = [], artifacts = [];
  const data = { settings: { event_name: "SYNTHETIC SHORTCUTS TEST", is_published: false },
    households: [], guests: [], contacts: [], queue: [], deliveries: [], submissions: [], responses: [], claims: [] };
  const http = async (url, options) => {
    assert.equal(new URL(url).origin, projectUrl);
    assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.equal(options.headers.apikey, publicKey);
    assert.equal(options.headers.Authorization, "Bearer " + token);
    const name = url.slice(url.lastIndexOf("/") + 1), values = JSON.parse(options.body);
    calls.push({ name, values: clone(values) });
    let result;
    if (name === "admin_load_data") result = clone(data);
    else if (name === "admin_save_household") {
      assert.equal(values.p_id, null);
      result = uuid(next++);
      data.households.push({ id: result, ...values.p_values, archived_at: null, invite_code: "AAAAAAA" + "ABCDEFGH"[data.households.length] });
    } else if (name === "admin_save_guest_details") {
      assert.equal(values.p_guest_id, null);
      result = uuid(next++); data.guests.push({ id: result, household_id: values.p_household_id, ...values.p_values, last_name: null, phone: null, email: null, is_child: false, archived_at: null });
    } else if (name === "admin_save_contact") {
      assert.equal(values.p_id, null);
      result = uuid(next++); data.contacts.push({ id: result, household_id: values.p_household_id, ...values.p_values, is_household_primary: null, archived_at: null });
    } else if (name === "admin_set_household_primary_guest") {
      data.households.find(item => item.id === values.p_household_id).primary_guest_id = values.p_guest_id;
      for (const contact of data.contacts.filter(item => item.household_id === values.p_household_id)) contact.is_household_primary = null;
      result = null;
    } else if (name === "admin_save_delivery") {
      assert.equal(values.p_id, null); assert.equal(values.p_expected_revision, null);
      result = uuid(next++);
      const household = data.households.find(item => item.id === values.p_household_id);
      const contact = data.contacts.find(item => item.id === values.p_values.contact_id);
      data.queue.push({ id: result, household_id: values.p_household_id, ...values.p_values, revision: 1,
        recipient_snapshot: { contact_value: contact.contact_value }, invitation_code_snapshot: household.invite_code });
    } else if (name === "admin_create_shortcut_batch") {
      assert.equal(values.p_retry, false); assert.equal(values.p_items.length, 6);
      result = { batch_id: uuid(next++), capability: "synthetic_batch_capability_" + "x".repeat(40),
        mode: values.p_mode, expires_at: "2099-01-01T00:00:00Z", count: 6 };
    } else assert.fail("Unexpected RPC: " + name);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  async function execute(phase, extra = {}) {
    return executePilot({ phase, input: config(), expectedProjectRef: projectRef, state: saved, fetchImpl: http, imageBytes: jpeg,
      saveState: value => { saved = clone(value); states.push(clone(value)); },
      writeArtifact: value => artifacts.push(clone(value)), newId: () => uuid(next++), ...extra });
  }
  return { data, calls, states, artifacts, http, execute, state: () => clone(saved) };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Tests must not contact a network"); };
try {
  await test("seed creates only six synthetic households, guests and contacts with durable operation markers", async () => {
    const f = fixture(); const report = await f.execute("seed");
    assert.equal(report.household_count, 6); assert.equal(f.data.settings.is_published, false);
    assert.equal(f.calls.filter(call => call.name === "admin_save_household").length, 6);
    assert.equal(f.calls.filter(call => call.name === "admin_save_guest_details").length, 6);
    assert.equal(f.calls.filter(call => call.name === "admin_save_contact").length, 6);
    assert.equal(f.calls.filter(call => call.name === "admin_set_household_primary_guest").length, 6);
    assert.equal(f.state().pending_operation, null);
    assert(f.states.some(state => state.pending_operation === "household:0"));
    for (const state of f.states) {
      const text = JSON.stringify(state);
      for (const secret of [token, publicKey, ...phones]) assert.equal(text.includes(secret), false);
    }
    assert.equal(f.artifacts.length, 0, "seed state is the artifact, never a batch capability");
    const before = f.calls.length; assert.equal((await f.execute("seed")).state, "already_seeded");
    assert.equal(f.calls.length, before + 1, "exact seeded installation reopen is read-only");
  });
  await test("dry-run and live-test batches get fresh six Ready delivery snapshots with stable household links", async () => {
    const f = fixture(); await f.execute("seed"); f.data.settings.is_published = true;
    const first = await f.execute("batch");
    const second = await f.execute("batch", { input: { ...config(), mode: "live_test" } });
    assert.equal(first.delivery_count, 6); assert.equal(second.delivery_count, 6);
    assert.equal(new Set([...first.queue_ids, ...second.queue_ids]).size, 12);
    for (let index = 0; index < 6; index++) {
      assert.equal(f.data.queue[index].invitation_code_snapshot, f.data.queue[index + 6].invitation_code_snapshot);
      assert(f.data.queue[index].message_body.includes("dry_run"));
      assert(f.data.queue[index + 6].message_body.includes("live_test"));
      assert.equal(f.data.queue[index].message_body.split("\n").at(-1), f.data.queue[index + 6].message_body.split("\n").at(-1));
      assert.equal(f.data.queue[index].message_subject, "SYNTHETIC SHORTCUTS TEST / dry_run");
      assert.equal(f.data.queue[index].message_image.image, "data:image/jpeg;base64," + Buffer.from(jpeg).toString("base64"));
      assert.equal(f.data.queue[index].recipient_snapshot.contact_value, phones[index % 2]);
    }
    assert.equal(f.artifacts[0].mode, "dry_run"); assert.equal(f.artifacts[1].mode, "live_test");
    assert.deepEqual(f.artifacts[1].expected_recipients, phones);
    assert.equal(f.artifacts[1].api_base, projectUrl + "/functions/v1/invitation-shortcuts");
    assert.equal(JSON.stringify(f.state()).includes("capability"), false);
    for (const report of [first, second]) {
      const text = JSON.stringify(report);
      for (const secret of [...phones, token, publicKey, projectRef, "https://", "capability"]) assert.equal(text.includes(secret), false);
    }
    assert.deepEqual([...new Set(f.calls.map(call => call.name))].sort(), ["admin_create_shortcut_batch", "admin_load_data", "admin_save_contact", "admin_save_delivery", "admin_save_guest_details", "admin_save_household", "admin_set_household_primary_guest"]);
  });
  await test("batch refuses unpublished event without resetting or publishing it", async () => {
    const f = fixture(); await f.execute("seed"); const before = f.calls.length;
    await rejects(f.execute("batch"), "event_unpublished");
    assert.equal(f.calls.length, before + 1); assert.equal(f.data.queue.length, 0); assert.equal(f.data.settings.is_published, false);
  });
  await test("an existing mode is renewed elsewhere, never duplicated into another queue set", async () => {
    const f = fixture(); await f.execute("seed"); f.data.settings.is_published = true; await f.execute("batch");
    const before = f.calls.length;
    await rejects(f.execute("batch"), "mode_already_prepared");
    assert.equal(f.calls.length, before + 1); assert.equal(f.data.queue.length, 6);
  });
  await test("occupied installation or missing synthetic sentinel fails before mutation", async () => {
    const f = fixture(); f.data.households.push({ id: uuid(700) });
    await rejects(f.execute("seed"), "installation_not_empty"); assert.equal(f.calls.length, 1);
    const g = fixture(); g.data.settings.event_name = "Existing event";
    await rejects(g.execute("seed"), "unsafe_preflight"); assert.equal(g.calls.length, 1);
  });
  await test("extra household, changed recipient or changed identity blocks further batches", async () => {
    for (const mutate of [f => f.data.households.push({ id: uuid(700) }), f => { f.data.contacts[0].contact_value = "+19995550103"; },
      f => { f.data.guests[0].first_name = "Changed"; }, f => { f.data.households[0].archived_at = "2099-01-01"; }]) {
      const f = fixture(); await f.execute("seed"); f.data.settings.is_published = true; mutate(f);
      const before = f.calls.length; await rejects(f.execute("batch"), "unsafe_preflight"); assert.equal(f.calls.length, before + 1);
    }
  });
  await test("explicit project binding and credential classes reject secrets, wrong issuers and unexpected input", async () => {
    for (const mutate of [input => { input.projectUrl = "https://wrong.example.invalid"; }, input => { input.projectUrl += "/rest"; },
      input => { input.publicKey = "sb_secret_synthetic"; }, input => { input.accessToken = jwt({ role: "service_role" }); },
      input => { input.password = "forbidden"; }, input => { input.mode = "live"; }, input => { input.testPhones = [phones[0], phones[0]]; },
      input => { input.siteUrl = "https://site.example.invalid/pilot/?credential=forbidden"; }]) {
      const input = config(); mutate(input); assert.throws(() => validateInput(input, projectRef));
    }
    assert.throws(() => validateInput(config(), undefined));
    assert.throws(() => validateInput(config(), "x".repeat(20)));
    const legacy = { ...config(), publicKey: jwt({ role: "anon", ref: projectRef }) }; assert.equal(validateInput(legacy, projectRef).projectRef, projectRef);
  });
  await test("prepare-only preflight creates no records", async () => {
    const f = fixture(); const report = await f.execute("seed", { input: { ...config(), prepareOnly: true } });
    assert.equal(report.state, "prepared_only"); assert.equal(f.calls.length, 1); assert.equal(f.states.length, 0); assert.equal(f.artifacts.length, 1);
    assert.equal(f.artifacts[0].planned_households, 6);
  });
  await test("lost mutation reply leaves durable uncertainty and cannot be replayed automatically", async () => {
    const f = fixture(); let lost = false;
    const transport = async (url, init) => {
      const response = await f.http(url, init);
      if (url.endsWith("/admin_save_household") && !lost) { lost = true; throw Error("lost reply"); }
      return response;
    };
    await rejects(f.execute("seed", { fetchImpl: transport }), "transport_failed");
    assert.equal(f.data.households.length, 1); assert.equal(f.state().pending_operation, "household:0");
    await rejects(f.execute("seed"), "manual_review_required");
    assert.equal(f.calls.filter(call => call.name === "admin_save_household").length, 1);
  });
  await test("storage failure before a write prevents its RPC", async () => {
    const f = fixture();
    await assert.rejects(f.execute("seed", { saveState: () => { throw Error("synthetic store failure"); } }));
    assert.equal(f.calls.length, 1); assert.equal(f.data.households.length, 0);
  });
  await test("changed reviewed draft prevents batch creation", async () => {
    const f = fixture(); await f.execute("seed"); f.data.settings.is_published = true;
    const transport = async (url, init) => {
      if (url.endsWith("/admin_load_data") && f.data.queue.length === 6) f.data.queue[0].message_body += " changed";
      return f.http(url, init);
    };
    await rejects(f.execute("batch", { fetchImpl: transport }), "review_changed");
    assert.equal(f.calls.filter(call => call.name === "admin_create_shortcut_batch").length, 0);
  });
  await test("private files are 0600, never overwritten; repo/webroot/symlink paths are rejected", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-pilot-private-test-"));
    try {
      const filename = path.join(directory, "private.json"); writePrivate(filename, { synthetic: true });
      assert.equal(fs.statSync(filename).mode & 0o777, 0o600); assert.deepEqual(readPrivate(filename), { synthetic: true });
      assert.throws(() => writePrivate(filename, { changed: true }), error => error.code === "output_exists");
      writePrivate(filename, { changed: true }, { replace: true }); assert.deepEqual(readPrivate(filename), { changed: true });
      const symlink = path.join(directory, "link.json"); fs.symlinkSync(filename, symlink);
      assert.throws(() => readPrivate(symlink), error => error.code === "private_file_required");
      const publicDirectory = path.join(directory, "public"); fs.mkdirSync(publicDirectory, { mode: 0o700 });
      assert.throws(() => validatePrivatePath(path.join(publicDirectory, "out.json")), error => error.code === "private_path_required");
      const runtime = path.join(directory, "runtime"); fs.mkdirSync(runtime, { mode: 0o700 });
      fs.mkdirSync(path.join(runtime, "site"), { mode: 0o700 }); fs.mkdirSync(path.join(runtime, "private"), { mode: 0o700 });
      fs.writeFileSync(path.join(runtime, "private/state.json"), '{"format":"rsvp-shortcuts-local-site-1"}', { mode: 0o600 });
      assert.throws(() => validatePrivatePath(path.join(runtime, "site/private-out.json")), error => error.code === "private_path_required");
      const gitDirectory = path.join(directory, "checkout"); fs.mkdirSync(gitDirectory, { mode: 0o700 }); fs.mkdirSync(path.join(gitDirectory, ".git")); fs.writeFileSync(path.join(gitDirectory, ".git/HEAD"), "ref: refs/heads/main\n");
      assert.throws(() => validatePrivatePath(path.join(gitDirectory, "out.json")), error => error.code === "private_path_required");
      assert.throws(() => validatePrivatePath(path.resolve("tools/private-out.json")), error => error.code === "private_path_required");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  process.stdout.write("PASS " + checks + " synthetic pilot-driver checks; zero project, Auth, publication or provider calls.\n");
} finally { globalThis.fetch = originalFetch; }

// Offline contract lint for the human-authoring blueprint, not an iOS execution test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const blueprint = JSON.parse(fs.readFileSync(path.join(root, "tools/shortcut-native-blueprint.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, blueprint.protocol_schema), "utf8")).$defs;
const guide = fs.readFileSync(path.join(root, blueprint.guide), "utf8");
const allActions = sequence => sequence.flatMap(action => [action,
  ...["then", "dry_run", "live_test"].flatMap(branch => allActions(action[branch] || []))]);
const runner = blueprint.shortcuts.find(shortcut => shortcut.name === "RSVP Batch Runner");
const uploader = blueprint.shortcuts.find(shortcut => shortcut.name === "RSVP Upload Results");
assert.ok(runner && uploader, "Both named native shortcuts must be documented");
assert.equal(blueprint.artifact_kind, "native_authoring_blueprint");
assert.equal(blueprint.installable, false, "A semantic JSON checklist is not an importable Apple shortcut");
assert.equal(blueprint.native_action_ids, null, "Do not substitute guessed binary workflow IDs");
assert.equal(blueprint.device_acceptance.status, "unverified");
assert.equal(blueprint.device_acceptance.installed_copies_match_this_blueprint, "unverified");
assert.equal(blueprint.device_acceptance.native_upload_acceptance, "pending");
assert.equal(blueprint.device_acceptance.live_enabled_default, false);
assert.equal(blueprint.device_acceptance.probe_actions_configured_default, false);
assert.equal(blueprint.device_acceptance.first_live_item_accepted_default, false);
assert.equal(blueprint.configuration.save_credentials, false);
assert.equal(blueprint.configuration.api_base_source, "configured_dedicated_test_helper_supabase_function_base");
assert.deepEqual(blueprint.configuration.api_base_applies_to, [runner.name, uploader.name]);
assert.equal(blueprint.configuration.website_address_is_not_api_base, true);
assert.equal(blueprint.configuration.explicit_retry_batches_supported, false);
assert.deepEqual(blueprint.configuration.allowed_modes, ["dry_run", "live_test"]);
assert.equal(blueprint.configuration.household_count, 6);
assert.equal(blueprint.configuration.recipient_count_enforced_by_server, 2);
assert.ok(blueprint.configuration.local_action_start_window_seconds > 0 &&
  blueprint.configuration.local_action_start_window_seconds < blueprint.configuration.server_claim_lease_seconds);
assert.match(blueprint.configuration.dry_to_live, /fresh_reviewed_queue_ids_and_new_batch/);
for (const filename of [blueprint.guide, blueprint.first_device_step, blueprint.protocol_schema]) {
  assert.ok(fs.existsSync(path.join(root, filename)), "A referenced source file must exist: " + filename);
}
for (const shortcut of blueprint.shortcuts) {
  assert.ok(guide.includes(shortcut.name), "Guide names must match the native launch target");
  const actions = allActions([...(shortcut.common || []), ...(shortcut.pending || []), ...(shortcut.recovery || [])]);
  assert.equal(new Set(actions.map(action => action.id)).size, actions.length, "Action labels must be unambiguous");
  const prefix = shortcut.common;
  const pinned = prefix.findIndex(action => /pin$/.test(action.id));
  const firstHttp = prefix.findIndex(action => action.native_action === "Get Contents of URL");
  assert.ok(pinned >= 0 && pinned < firstHttp, "Pin the API base before an authorized request");
  assert.match(prefix[pinned].guard, /api_base_equals_pinned_https_base/);
  assert.match(prefix[pinned].guard, /schema_version_is_numeric_1/);
  assert.match(prefix[pinned].guard, /capability_matches_scoped_token_pattern/);
  for (const action of actions.filter(action => action.native_action === "Get Contents of URL")) {
    assert.equal(action.authorization, "in_memory_bearer");
    assert.match(action.path, /^\/batches\/\{batch_id\}(?:\/|$)/, "Requests stay under a derived pinned URL");
    if (action.method === "POST") {
      const def = action.path.endsWith("/claims") ? schema.claim : schema.result;
      assert.deepEqual([...action.json_fields].sort(), [...def.required].sort(), "POST fields match the versioned API schema");
    }
  }
}
const position = id => runner.pending.findIndex(action => action.id === id);
for (const [before, after] of [["image", "journal"], ["image_guard", "journal"], ["live_gate", "journal"],
  ["journal", "claim"], ["claim", "claim_guard"], ["claim_guard", "claimed_journal"],
  ["claim_request_started", "local_deadline"], ["local_deadline", "claim"],
  ["claimed_journal", "mode"], ["mode", "final_result"]]) {
  assert.ok(position(before) >= 0 && position(before) < position(after), before + " must precede " + after);
}
assert.equal(runner.pending[position("journal")].file, "claim");
assert.equal(runner.pending[position("journal")].before_network_claim, true);
assert.equal(runner.pending[position("image")].before_claim, true);
assert.equal(runner.pending[position("final_result")].immutable, true);
assert.match(runner.pending[position("live_gate")].guard, /probe_actions_configured_AND_\(Run_one_pending_OR_first_live_item_accepted\)/);
const mode = runner.pending[position("mode")];
assert.ok(allActions(mode.dry_run).every(action => !action.device_action), "Dry run never invokes WhatsApp");
for (const kind of ["text", "photo"]) {
  const actionBlock = mode.live_test.find(action => action.id === kind + "_needed").then;
  assert.deepEqual(actionBlock.map(action => action.id), [kind + "_now", kind + "_lease_guard", kind + "_start",
    kind + "_ready_now", kind + "_ready_guard", kind + "_action", kind + "_done"]);
  assert.equal(actionBlock[1].failure, "Stop and Output", "Expired claims cannot start an app action");
  assert.equal(actionBlock[2].native_action, "Save File", "Persist started before calling an app");
  assert.equal(actionBlock[4].failure, "Stop and Output", "Recheck lease after the durable save");
  assert.equal(actionBlock[5].native_action, null, "The actual WhatsApp intent must come from the phone");
  assert.equal(actionBlock[5].blocked_until, "probe_actions_configured_and_run_choice_gate_passed");
  assert.equal(actionBlock[6].native_action, "Save File", "Persist completion after app return");
}
assert.ok(allActions(runner.recovery).every(action => !action.device_action), "Recovery never sends");
assert.match(runner.recovery.find(action => action.id === "recover_guard").guard, /claim_and_claimed_checkpoints_exist/);
assert.equal(uploader.send_actions, false);
assert.ok(allActions(uploader.common).every(action => !action.device_action &&
  !["Open URLs", "Open App", "Share", "Run Shortcut"].includes(action.native_action)), "Upload-only cannot launch a send path");
const uploadPosition = id => uploader.common.findIndex(action => action.id === id);
assert.ok(uploadPosition("upload_post") < uploadPosition("upload_ack_guard"));
assert.ok(uploadPosition("upload_ack_guard") < uploadPosition("upload_ack"));
assert.match(uploader.common[uploadPosition("upload_ack_guard")].guard, /accepted_is_boolean_true/);
assert.match(uploader.common[uploadPosition("upload_ack_guard")].guard, /state_equals_Result.result/);
for (const guard of ["HTTP_status_200_when_exposed", "schema_version_is_numeric_1", "batch_id_equals_BatchID", "idempotent_is_boolean"])
  assert.ok(uploader.common[uploadPosition("upload_ack_guard")].guard.includes(guard), "Native acknowledgment requires " + guard);
assert.equal(uploader.common[uploadPosition("upload_post")].body, "exact_saved_result");
assert.equal(uploader.common[uploadPosition("upload_post")].expected_status, 200);
assert.equal(uploader.common[uploadPosition("upload_post")].on_transport_error, "stop_without_ack_and_retain_saved_result");
assert.equal(uploader.common[uploadPosition("upload_ack")].retain_result, true);
assert.equal(uploader.common[uploadPosition("upload_ack")].content, "accepted");
assert.match(uploader.common[uploadPosition("upload_result_guard")].guard, /single_dictionary_exact_six_required_keys_and_details_strict_schema/);
// Cross-check the native request instructions against the server's current JSON
// schema rather than permitting an uploader wrapper or new callback fields.
const upload = blueprint.upload_contract;
assert.equal(upload.method, "POST");
assert.equal(upload.path, uploader.common[uploadPosition("upload_post")].path);
assert.equal(upload.request_kind, "single_object");
assert.equal(upload.additional_properties, schema.result.additionalProperties);
assert.deepEqual([...upload.required_keys].sort(), [...schema.result.required].sort());
assert.deepEqual([...upload.details_required_keys].sort(), [...schema.result.properties.details.required].sort());
for (const field of ["error_stage", "error_code"])
  assert.deepEqual(upload.details_optional_values[field], schema.result.properties.details.properties[field].enum);
assert.equal(upload.processed_forbids_error_fields, true);
assert.equal(upload.retry, "same_saved_body_and_event_id_without_send_actions");
assert.deepEqual(upload.acknowledgment, {
  status: 200, schema_version: 1, batch_id: "launch.batch_id", accepted: true,
  idempotent_type: "boolean", state: "saved_result.result",
  native_status_unavailable: "require_error_free_action_and_complete_json_acknowledgment",
  failure_preserves_saved_result: true,
});
assert.equal(blueprint.files.native_storage, "user_selected_private_RSVPNative_Files_folder_shared_by_both_shortcuts");
assert.equal(blueprint.files.browser_journal_is_separate, true);
assert.equal(blueprint.identity.claim_id, "attempt_id");
assert.equal(blueprint.identity.event_id, "attempt_id");
assert.equal(blueprint.identity.result_policy, "one_immutable_final_result_per_attempt");
assert.deepEqual(blueprint.launch.native_clipboard_fields, ["schema_version", "api_base", "batch_id", "capability", "mode", "expected_recipients"]);
assert.deepEqual(blueprint.launch.runner_additional_required_fields, ["mode", "expected_recipients"]);
assert.deepEqual(blueprint.launch.uploader_additional_required_fields, ["mode"]);
assert.equal(blueprint.launch.recipient_storage, "runtime_memory_only");
assert.match(blueprint.launch.recipient_authority, /clipboard_is_not_sole_authority/);
assert.match(runner.common.find(action => action.id === "recipient_pair").guard, /exactly_match_device_approved_pair/);
assert.ok(position("recipient_item") < position("journal"), "Recipient mapping is checked before claim");
for (const secretField of blueprint.files.forbidden_content) {
  assert.ok(!blueprint.files.content_allowlist.includes(secretField), "Persistent state must exclude " + secretField);
}
const fileNames = new Set();
for (const batch of ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]) {
  for (let n = 1; n <= 6; n++) {
    const attempt = "cccccccc-cccc-4ccc-8ccc-" + String(n).padStart(12, "0");
    for (const kind of ["claim", "claimed", "text_started", "text_completed", "photo_started", "photo_completed", "result", "ack"]) {
      const filename = blueprint.files[kind].replace("{batch_id}", batch).replace("{attempt_id}", attempt);
      assert.ok(!filename.includes("/") && !fileNames.has(filename), "Flat checkpoint names cannot collide across batches/attempts");
      fileNames.add(filename);
    }
  }
}
for (const launch of [blueprint.launch.runner_url, blueprint.launch.upload_url]) {
  const url = new URL(launch);
  assert.equal(url.protocol, "shortcuts:");
  assert.equal(url.searchParams.get("input"), "clipboard");
  assert.ok(!url.searchParams.has("capability") && !url.searchParams.has("text"), "Launch URLs never contain a bearer");
  assert.ok(blueprint.shortcuts.some(shortcut => shortcut.name === url.searchParams.get("name")));
}
console.log("PASS native authoring blueprint: shared configured Supabase pin, strict single-result schema, full version/batch/Boolean/state acknowledgment and conditional HTTP-status guard, unchanged retry identity, separate native Files/browser journals, preclaim checkpoints and disabled live gates; reported installation is not iOS/WhatsApp acceptance.");

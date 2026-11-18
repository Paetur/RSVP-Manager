# Configure and verify the two pilot shortcuts on an iPhone

This is a native iPhone authoring guide for the six-household, two-recipient
pilot. If the shortcuts are already installed, inspect their exported action
definitions before accepting them; installation alone does not establish upload
or device acceptance. This guide does not update an installed shortcut remotely.
The on-device authoring procedure does not require a Mac. The target versions are iOS 27.2 and WhatsApp 26.45.75;
actual action availability, file persistence and WhatsApp behavior still require
the device checks below. Live sending starts with a supervised first-item gate;
the remaining-five branch stays disabled until that first item succeeds.
Start with the short [four-action phone check](ShortcutsWhatsAppProbe.md) before
assembling the full live runner. The organizer reports **Send message to
recipient** and **Send photo**. The photo action opens a contact picker; its
Image/File-variable support is unknown. Live setup remains incomplete; keep both live gates false at this inspection
stage.

[shortcut-native-blueprint.json](../tools/shortcut-native-blueprint.json) is a
machine-readable build checklist. It contains display names and protocol rules,
not undocumented Apple action identifiers. It is **not an importable .shortcut
file**. [shortcut-device-runner.js](../js/shortcut-device-runner.js) and its
acceptance helpers are reference/test programs; Shortcuts cannot execute them as native actions merely
by downloading or renaming them. This guide builds the actions inside the
Shortcuts app instead. Apple documents creating and testing native actions in
[Create a custom shortcut](https://support.apple.com/guide/shortcuts/create-a-custom-shortcut-apd84c576f8c/ios).

The isolated test helper also has a web installation panel. It opens reviewed
**iCloud share links for existing native shortcuts**; it does not generate them
from this guide or the JSON blueprint. Until those links exist, follow the native
authoring steps here. See [web installer instructions](ShortcutsTestSite.md#install-the-native-shortcuts-from-the-helper).

## Prepare the dedicated test installation and phone

The operator supplies the exact private test website and API addresses outside
Git. Keep the populated installation and its event out of this pilot. The test
installation must contain exactly six labeled synthetic households, six reviewed
WhatsApp drafts with unique invitation links, the synthetic JPEG, and the two
approved test recipients. The backend enforces that allowlist. Run the six-item
dry run first. For live test, create six fresh reviewed Ready delivery drafts
(new queue IDs) for the **same six households and existing codes/links**, then
create a new six-item live-test batch from those drafts. Do not reuse the dry-run
queue IDs: they already have processed attempts. This guide does not
cover explicit retry batches or unrestricted `live` mode.

On the iPhone:

1. Open the supplied **HTTPS test website** in Safari. Confirm the exact address
   with the operator. If this is the local HTTPS test site on port 8443, install
   only the operator-provided test CA profile and verify its identity before
   enabling full trust in Settings. Open the site again and confirm Safari
   reports no certificate error. The website origin and API base may differ:
   **pin the API base supplied by the test configuration**, not the website URL.
   Apple explains manual CA trust in
   [Trust manually installed certificate profiles](https://support.apple.com/en-us/102390).
2. In Files, create one private folder named `RSVPNative`. Select that same folder
   in every file action in both shortcuts. Prefer local device storage if the
   phone offers it. If using private iCloud Drive storage, use only this phone
   during the pilot; do not share the folder.
3. In Shortcuts create `RSVP Upload Results` and `RSVP Batch Runner`. Names must
   match exactly. Allow the required clipboard, chosen-folder and pinned-network
   access when prompted. Privacy grants are per shortcut; Apple documents them
   in [Shortcuts privacy settings](https://support.apple.com/en-gb/guide/shortcuts/apd961a4fc65/ios).
4. Before claiming any item, verify each shortcut can save a dummy file to the
   chosen folder, stop, reopen, and read the same file. For reads, search for
   **Get File from Folder** (the editor may shorten this to **Get File**), choose
   the pinned folder, use a dynamic filename and turn **Error If Not Found** off.
   Missing files must produce no value. If this option or persistence does not
   work on the phone, stop here; a send cannot proceed without durable state.

The following action names are searchable labels, not binary workflow IDs.
Use **Set Variable** to name outputs, **Get Dictionary Value** to read fields,
and **If** blocks to guard each subsequent action. A failed guard ends with
**Stop and Output**, giving a short non-secret explanation. Do not place later
send actions outside their guards. Apple documents dictionaries, loops and
file actions in [Using Dictionaries](https://support.apple.com/en-gu/guide/shortcuts/apd43b69f337/ios),
[Handling lists](https://support.apple.com/my-mm/guide/shortcuts/apd9ba41d21b/10.0/ios/27)
and [Share actions](https://support.apple.com/en-asia/guide/shortcuts/apdaf74d75a5/ios).

## Common input and HTTP actions

Build this prefix in **both** shortcuts:

1. **Text**: enter the exact HTTPS API base from the private test configuration,
   with no trailing slash; save it as `PinnedAPIBase`. This is a device setup
   value. The generic form is
   `https://backend.example.invalid/functions/v1/invitation-shortcuts`.
   For Supabase use the dedicated test project's
   `https://<test-project-ref>.supabase.co/functions/v1/invitation-shortcuts`,
   supplied by the configured helper. Set the same pin in **both** installed
   shortcuts. The helper website address, including its HTTPS port, is not the
   API base. Every manifest, claim, image and result request stays under this pin;
   a new clipboard value cannot silently change it.
2. **Get Clipboard** → `LaunchText`.
3. **Get Dictionary from Input**, input `LaunchText` → `Launch`.
4. **Get Dictionary Value** for `schema_version`, `api_base`, `batch_id`,
   `capability` and `mode`. Require version `1`, base exactly equal to `PinnedAPIBase`, a
   UUID batch ID, and a text capability matching `^[A-Za-z0-9_-]{32,256}$`.
   Version `1` must remain a JSON number. Use **Match Text** with
   `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`
   for each UUID, and mode `dry_run` or `live_test`. Reject missing/invalid values.
   Never save or display the capability or `LaunchText`.
   In **RSVP Batch Runner**, also read `expected_recipients`: require a list of
   exactly two distinct international numbers matching
   `^\+[1-9][0-9]{6,14}$`. Keep it in memory. Resolve the two approved device
   contacts to number variables at runtime as described under the live gate;
   require this list to contain both of those exact numbers, regardless of order. Clipboard numbers alone do
   not authorize a recipient: both the server allowlist and the device-approved
   mapping must match. **RSVP Upload Results** may ignore `expected_recipients`;
   it still validates launch mode, batch and base.
5. **Text**: `PinnedAPIBase/batches/BatchID`, inserting the two variables rather
   than their names → `BatchURL`.
6. **Get Contents of URL**, URL `BatchURL`, method **GET**, header
   `Authorization` = `Bearer ` followed by the capability variable → `Manifest`.
7. Require manifest version `1`, its `batch_id` equal to the launch batch ID,
   `mode` equal to the validated launch mode, `progress.total` equal to `6`, and
   **Count** of `statuses` equal to `6`. Do not require six pending invitations
   on resume: previously claimed or processed items are absent from that list.
   Keep the manifest mode as `Mode`. Reject any malformed/unknown result.

The helper copies exactly these six native input fields from the protected
runtime pilot configuration. Metadata such as `expires_at` or `count` stays out
of the native envelope. This schematic example uses labels rather than actual
recipient values:

```json
{
  "schema_version": 1,
  "api_base": "https://backend.example.invalid/functions/v1/invitation-shortcuts",
  "batch_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "capability": "SUPPLIED_AT_RUNTIME_ONLY",
  "mode": "dry_run",
  "expected_recipients": ["APPROVED_TEST_NUMBER_A", "APPROVED_TEST_NUMBER_B"]
}
```

These values are illustrative and the recipient labels must not be pasted as
numbers. The helper supplies the two actual approved international values only
in runtime memory. Copy a fresh envelope from the private test
website, then run the desired shortcut. The launch URL contains its name and
`input=clipboard`, with no capability in the URL:

```text
shortcuts://run-shortcut?name=RSVP%20Batch%20Runner&input=clipboard
shortcuts://run-shortcut?name=RSVP%20Upload%20Results&input=clipboard
```

Clipboard contents can be replaced by another app. Copy the envelope again
before each separate run, including the uploader. The capability remains only
in the running shortcut's memory. After the run, replace the clipboard with
ordinary non-secret text. Apple documents this input mechanism in its
[iOS 27 URL-scheme guide](https://support.apple.com/en-euro/guide/shortcuts/apd624386f42/10.0/ios/27).

For every HTTP action, keep the URL under the pinned base and set the same
Authorization header. For POST, expand the action, set **Request Body → JSON**,
and add the named fields below with the correct text/Boolean/dictionary types.
For an upload, bind all fields from the saved result; never construct a new
outcome or event ID during retry. HTTP or parsing errors may stop Shortcuts;
previously saved files must remain. Apple documents GET and JSON POST in
[Request your first API](https://support.apple.com/en-mt/guide/shortcuts/apd58d46713f/ios).

## File names and content

Use a flat folder; replace `B` with `BatchID` and `A` with the current attempt ID.
Set file names with **Set Name** before **Save File** when required by the
editor. Disable **Ask Where to Save**, choose `RSVPNative`, and use the exact
filename. A save must complete before the next action. Never silently overwrite
a final result. Acknowledgment files let the uploader skip successful uploads
without requiring a delete action.

For a local JSON checkpoint, use **Dictionary** with Boolean fields typed as
Boolean, then **Get Text from Input** to serialize it. Before the first live
claim, round-trip a dummy checkpoint through **Get Dictionary from Input** and
verify all Boolean values remain Booleans. Do not interpolate localized Boolean
display labels such as Yes/No into JSON text. The fixed processed-result template
below already contains literal JSON `true` values.
When reading a marker, require its exact literal content (`started`, `completed`
or `accepted`); an unexpected value stops for review. A corrupt acknowledgment
must not cause an unacknowledged result to be skipped.

| Filename | Content |
|---|---|
| `claim-B-A.json` | Version, batch/attempt/claim IDs and `stage:"claim_requested"` |
| `claimed-B-A.json` | Same IDs plus the successful claim's `required_actions` and `completed_actions` |
| `text-started-B-A.txt` | Literal `started` |
| `text-completed-B-A.txt` | Literal `completed` |
| `photo-started-B-A.txt` | Literal `started` |
| `photo-completed-B-A.txt` | Literal `completed` |
| `result-B-A.json` | Exactly one complete API result body, as shown below |
| `ack-B-A.txt` | Literal `accepted`, written only after the acknowledgment guard passes |

These checkpoints belong to the native **Files** folder. The helper's separate
browser dry run uses IndexedDB database `rsvp-shortcuts-browser-dry-run-v1`,
store `journals`, key `rsvp-shortcut-device:v1:{batch_id}`. Native Shortcuts does
not read that browser journal, and the browser does not read these Files records.
Do not put the browser's `revision`/`value` wrapper into a native result file.

Do not save the envelope, credential, expected-recipient list, recipient, message, invitation code/link,
image URL or JPEG in this state folder. Keep the fetched JPEG in a variable only.
The claim ID and final event ID both equal `A`, the existing server-issued attempt
UUID. They are correlation IDs, not authentication secrets. Each attempt has
one immutable final result; later explicit retries would use a new attempt.

## Build RSVP Upload Results first

After the common prefix:

1. **Get Dictionary Value** `statuses` from `Manifest` → **Repeat with Each**.
   Inside the loop, read the current `attempt_id` as `A` and validate its UUID.
2. **Get File from Folder** `result-B-A.json`, missing-file error off →
   `SavedResult`; read `ack-B-A.txt` the same way → `SavedAck`.
3. If an acknowledgment file exists, use **Get Text from Input** and require its
   contents to be exactly `accepted`; otherwise stop for review.
   **If** `SavedResult` has a value, then **If** `SavedAck` has no value, continue
   inside those two blocks. Otherwise this item has no upload work.
4. **Get Dictionary from Input** `SavedResult` → `Result`. Require
   `attempt_id`, `claim_id` and `event_id` each equal `A`, `channel` equal
   `whatsapp`, and `result` one of `processed`, `partial`, `failed`, `unknown`,
   `skipped`. Require exactly six top-level keys: `event_id`, `attempt_id`,
   `claim_id`, `result`, `channel`, `details`. Reject a list, an outer wrapper,
   missing keys or extra keys. `details` must be a dictionary with required JSON
   Booleans `text_action_completed` and `photo_action_completed`; the only optional
   keys are `error_stage` (`text`, `photo`, `unknown`) and `error_code`
   (`action_failed`, `image_fetch_failed`, `cancelled`, `unknown`). Reject null,
   empty or unknown error values. A `processed` result omits both error keys;
   `partial` requires at least one completed action. Do not add timestamps,
   `schema_version`, `batch_id` or local journal fields. Validate against
   `$defs.result` in [ShortcutBatches.schema.json](ShortcutBatches.schema.json),
   rather than that file's root manifest schema.
   The runner must already have checked completion of every configured action;
   the uploader never changes the saved completion flags to make a result pass.
5. **Get Contents of URL**, POST `BatchURL/results`, JSON fields `event_id`,
   `attempt_id`, `claim_id`, `result`, `channel` and `details`, each bound to its
   saved value. Send this single object, never a list or a `results` wrapper.
   Set `Authorization: Bearer <capability>` and `Content-Type: application/json`.
   Preserve the validated saved `details` dictionary. If conditional keys require
   separate editor branches, include `error_stage` and `error_code` only when
   actually present in that saved dictionary; never substitute empty text or null.
   Do not construct another outcome or event ID during retry.
6. The API success status is **HTTP 200**. If the native action exposes an HTTP
   status, require exactly 200. An action error or a non-JSON/malformed result
   stops without writing an acknowledgment. Parse the response as a dictionary
   and require numeric `schema_version:1`, `batch_id` equal to `BatchID`,
   Boolean `accepted:true`, Boolean `idempotent` (either value), and `state`
   equal to the saved `result`. The same complete JSON guard is required when
   the native action does not expose the status separately. Neither a successful
   action return nor an error-free dictionary alone is an acknowledgment.
   Save literal `accepted` to `ack-B-A.txt` only inside this success block.
   On any other response,
   **Stop and Output** `Result retained; renew authorization or review the error`.
7. End both If blocks and the Repeat. **Stop and Output** `Saved result uploads
   checked`. Keep results and acknowledgments for the pilot's review.

This shortcut contains **no WhatsApp, Share, Open URLs or Run Shortcut actions**.
It cannot resend a message. Loss of network, an expired capability, a rejected
callback, or interruption while saving an acknowledgment leaves the saved result
available for the same idempotent upload. Renew the batch through the organizer
website, copy its replacement envelope and run this shortcut again. Renewal
must keep the same batch ID; it does not reset claimed work.

All failure paths retain the exact saved result and event ID. API errors normally
contain `error` and `code`; 400/404/405/413 require payload or endpoint review,
401/403 require authorization review, and 409 requires recorded-outcome review.
429/503 can be retried later by running only this uploader. An expired or revoked
capability currently returns 403; a service-configuration 503 may omit `code`.
Do not write an acknowledgment for any error shape, and do not repeat a WhatsApp
action because a callback or acknowledgment-file write failed. A subsequent run
posts the unchanged result and accepts `idempotent:true` in the normal success
guard.

## Build RSVP Batch Runner

After the common prefix, add **Choose from Menu** with exactly these branches:
`Run one pending`, `Run remaining pending`, `Recover interrupted`. Duplicate the
pending action block into the first two menu branches. Add **Stop and Output**
after one item in the first branch, inside the loop. The second branch loops
through all currently pending items. An empty pending list finishes without
claiming or sending anything.

For each item in `Manifest.invitations`, add **Repeat with Each** and these actions:

1. Read and validate its `attempt_id` as `A`; require its `phone` to match one of
   the two already verified expected/device-approved numbers. Retain `phone`, `message` and
   `image_url` only in memory. Get `claim-B-A.json`; if it exists, stop and use
   recovery/organizer review. Do not request another claim automatically.
2. If `image_url` has a value, **Get Contents of URL**, GET
   `BatchURL/attempts/A/image`, with Authorization. Derive this URL yourself;
   never attach the credential to an arbitrary returned URL. Save the output
   variable as `InvitationJPEG`. Use **Get Images from Input** and **Count** to
   require one decodable image. For this pilot every item requires the dummy
   JPEG; if it is absent or invalid, stop **before claiming**. Do not put the
   download behind the claim or inside the WhatsApp action.
3. Add two device-only Boolean setup values, initially false:
   `ProbeActionsConfigured` and `FirstLiveItemAccepted`. In live mode,
   `Run one pending` requires `ProbeActionsConfigured = true` after inspecting
   the actual app actions and recipient mapping. `Run remaining pending`
   additionally requires `FirstLiveItemAccepted = true`, set only after the
   supervised first live household item succeeds. Otherwise stop before claim.
4. Build a **Text** JSON journal with `schema_version:1`, `batch_id:B`,
   `attempt_id:A`, `claim_id:A`, `stage:"claim_requested"`. Save it to
   `claim-B-A.json`. Only validated IDs are inserted into this text template.
5. Immediately before the claim request, **Date** set to **Current Date** →
   `ClaimRequestStarted`; **Adjust Date** by adding **4 minutes** →
   `LocalStartDeadline`. This conservative window leaves a margin inside the
   five-minute server lease. Then **Get Contents of URL**, POST `BatchURL/claims`, JSON text fields
   `attempt_id:A`, `claim_id:A` → `Claim`.
6. Require Boolean `Claim.claimed = true`, matching attempt ID and matching mode.
   Any `false`, missing field, network error or unexpected response stops this
   invocation. A repeated claim returns `false`, including the same claim ID.
   It never permits another send.
7. Save `claimed-B-A.json` with the IDs and the exact `required_actions` and
   `completed_actions` Booleans from `Claim`. Initialize `TextCompleted` and
   `PhotoCompleted` from `completed_actions`, preserving prior completions.
8. **If** `Mode = dry_run`: set completion true for each required action using
   variables/Boolean dictionary values. Do not enter an app action or share
   sheet. This simulates processing only.
9. **Otherwise** (`live_test`, already gated): if `required_actions.text` is true,
   get a fresh **Date → Current Date** and require it to be **before**
   `LocalStartDeadline`; otherwise **Stop and Output** `Start window expired;
   recover this run`. Only then save `text-started-B-A.txt`. Repeat the fresh
   Current Date/deadline check immediately after that save and before invoking
   the inspected WhatsApp text action
   with exactly `message` and the verified recipient mapping; after that action
   returns successfully, save `text-completed-B-A.txt` and set `TextCompleted`
   true. Repeat the same sequence for `required_actions.photo`, including a new
   Current Date/deadline checks before and after saving `photo-started`, the
   inspected WhatsApp photo action with `InvitationJPEG`, and
   then `photo-completed`. Never reconstruct message text, invitation links or
   captions. A photo action does not substitute for the text action.
10. Require all configured actions to be complete. Check that
    `result-B-A.json` does not already exist. Build and save this exact result
    before any callback network request, using real JSON Booleans:

    ```json
    {
      "event_id": "CURRENT_ATTEMPT_UUID",
      "attempt_id": "CURRENT_ATTEMPT_UUID",
      "claim_id": "CURRENT_ATTEMPT_UUID",
      "result": "processed",
      "channel": "whatsapp",
      "details": {
        "text_action_completed": true,
        "photo_action_completed": true
      }
    }
    ```

11. In `Run one pending`, stop now. In `Run remaining pending`, continue with the
    next pending item. At the end, output `Results saved. Copy the same batch
    envelope again and run RSVP Upload Results.` The uploader is a separate,
    explicit run; sending never depends on a callback succeeding.

A claim lease is five minutes. Downloading before claiming avoids spending that
lease on the JPEG fetch. The local four-minute start checks also prevent the
photo action from starting after a long text action. Save an action's completion
after it returns even if it took too long; do not start another app action once
the local window closes, and do not repeat the previous action. Recovery can still report a previously issued claim with
valid renewed authorization. Returning from an action is only processing
completion; it is not a reliable WhatsApp Sent/read receipt.
Keep automatic date/time enabled during the pilot. Apple documents
[Current Date variables](https://support.apple.com/en-mk/guide/shortcuts/apdd2b316022/ios)
and the native [Date / Adjust Date actions](https://support.apple.com/en-lb/guide/shortcuts/apdfb33b0e17/ios).

## Four-action WhatsApp probe and live gate

Before enabling live processing, inspect **Add Action → Apps → WhatsApp** on the
actual phone. Use each action's icon → **Show Info** to inspect its input/output
and recipient fields. Apple documents this under
[Navigate the action list](https://support.apple.com/guide/shortcuts/navigate-the-action-list-apdc33e4f4da/ios).
The organizer reports **Send message to recipient** and **Send photo** on
WhatsApp 26.45.75. The photo action opens a contact picker; image-variable input
and recipient-variable binding have not been established. The blueprint keeps
its device-action placeholders disabled and contains no guessed binary intent
identifier. Keep `ProbeActionsConfigured` and `FirstLiveItemAccepted` false until
the corresponding checks pass.

Follow the inspection-only image-input check in the
[four-action phone guide](ShortcutsWhatsAppProbe.md) without running anything.
A contact picker alone does not establish recipient-variable support.

Create a temporary four-action probe on the phone:

1. **Select Contact**: choose one of the two approved test contacts at runtime;
   name its output `ProbeRecipient`.
2. **Get File from Folder**: select the operator-supplied synthetic JPEG;
   name its output `ProbeJPEG`.
3. **Send message to recipient** (reported label): inspect whether its recipient
   can bind to `ProbeRecipient` as a variable. Use clearly labeled synthetic
   text only when the live gate is later accepted.
4. **Send photo** (reported label): inspect whether its image can bind to
   `ProbeJPEG`. Recipient selection currently opens a contact picker; binding to
   the same `ProbeRecipient` variable remains unverified.

Initially inspect/configure this probe without running it. If either action is
missing, cannot accept variables, opens a recipient picker with no reliable
mapping, does not return after cancellation, or cannot accept the fetched JPEG,
leave both live gates false and record the limitation. Do not replace it with
click-to-chat or mark it processed because a chat merely opened. WhatsApp's
[click-to-chat documentation](https://faq.whatsapp.com/5913398998672934/?locale=fi_FI)
only establishes opening a chat with prefilled text; its
[Siri documentation](https://faq.whatsapp.com/1803878309981730/?cms_platform=iphone&locale=pa_IN)
does not specify a public photo-action schema.

A deliberate probe run sends extra, clearly labeled probe messages; record those
separately from the six household invitations. If the pilot must send exactly
six invitations without extra probes, copy the inspected action blocks into the
runner and conduct the first live item under supervision as its functional
probe; do not enable the remaining-five branch until that succeeds.

For the actual runner, configure two **Contacts** actions locally with the two
approved test contacts, or use two **Select Contact** prompts at the start of
each run. For each contact, **Get Details of Contacts → Phone Numbers**; require
exactly one phone number, use **Get Text from Input**, and **Replace Text** with
regular expression `[^+0-9]` replaced by empty text to remove display separators.
Require the result to match the international-number pattern above. Keep these
as `ApprovedPhoneA` and `ApprovedPhoneB` variables, not new Text constants or
saved files, and require the two numbers to differ. The existing approved
contacts remain the user's device records; their phone values are read only at
runtime and are never copied into an exported generic source artifact.

Require the launch's two `expected_recipients` to match this same approved pair.
Use the manifest `phone` directly only if the inspected WhatsApp actions support
that variable type. If they accept Contact variables only, compare
`ManifestItem.phone` with `ApprovedPhoneA`/`ApprovedPhoneB` using **If**, choose the
matching Contact variable, and stop if neither matches. Verify each mapping on
the phone before sending. Keep these real values outside source/Git and do not
export a configured shortcut containing private contact references. Do not choose a recipient by household
name, loop index or the most recently opened WhatsApp chat.

The reviewed message must remain text and the JPEG must remain a separate image
input. Do not assume that sending text as a photo caption preserves the intended
text/link behavior. WhatsApp documents the ordinary iPhone media workflow,
including confirmation and compression, in
[Send media, contacts, or location](https://faq.whatsapp.com/453914586839706/?cms_platform=iphone&locale=en_US).

## Recover interrupted runs without sending

Build `Recover interrupted` with **Repeat with Each** over `Manifest.statuses`,
reading the claim, claimed, started, completed and result files for each attempt.
It contains no WhatsApp actions.

- If a result already exists, leave it unchanged and use the uploader.
- If no claim journal exists, leave the item unchanged.
- If the server still says `pending`, no successful claim is evidenced. Leave
  files unchanged and ask the organizer to review. A deliberate reset is allowed
  only after the organizer confirms the server remains pending and there are
  no started markers; remove that unissued journal in Files before trying again.
- If the claim journal exists but the successful-claim checkpoint is missing,
  the claim response may have been lost. Do not send or invent completion flags.
  Leave it for organizer review; an accepted claim becomes Unknown after its
  lease. A repeated claim must not be used to acquire permission again.
- If `claimed-B-A.json` exists and state is `claimed` or `unknown`, offer a
  **Choose from Menu**: `Save interrupted result` / `Leave unchanged`.

For `Save interrupted result`, reconstruct completion from the claimed file's
`completed_actions` union the durable completed marker files. A started marker
without its corresponding completed marker means that action's outcome is
uncertain, even if the recipient may have received it. Choose the final result
with **If** blocks in this order:

1. All configured actions have durable completion: `processed`, no error fields.
2. Any started action lacks completion: `unknown`.
3. At least one action completed, but not all: `partial`.
4. Otherwise: `unknown`.

For non-processed results, use only bounded values
`error_stage:"unknown"`, `error_code:"unknown"`, alongside the known Boolean
completion flags. Save one immutable `result-B-A.json` using event/claim ID `A`,
then run the uploader separately. Do not treat a manually observed chat as a
native action-return checkpoint. Retain ambiguous runs for explicit organizer
review; neither recovery nor upload repeats a WhatsApp action.

## Pilot sequence and acceptance record

1. Create one fresh **dry_run** batch of all six synthetic deliveries. Copy its
   envelope, choose `Run one pending`, and upload that result. Repeat
   `Run one pending` once more and upload. Stop/reopen Shortcuts; run remaining
   pending to save the final four results. Before uploading those four, perform
   the outage check in step 2. No WhatsApp action should open during this run.
2. To test callback recovery, disable connectivity while the newly saved results
   remain unacknowledged, and run the uploader. Re-enable connectivity, copy the same
   batch's valid/renewed envelope and run the uploader again. Run it once more;
   no send action is present and acknowledged results are skipped. Losing an
   acknowledgment after server acceptance is also safe: the identical saved
   body receives idempotent acceptance. Verify exactly six processed dry-run
   outcomes, six distinct attempt/household/link identities, and no WhatsApp
   opening/messages before starting the live test.
3. Complete the device probe/gate. Create **six fresh reviewed Ready deliveries
   with new queue IDs** for the same six synthetic households, preserving their
   existing codes/links, then create a **fresh live_test** batch from them.
   A dry run is not live delivery evidence; never reuse its queue IDs or
   processing claims as live permission. Choose `Run one
   pending`, upload, and inspect the correct recipient's actual text, unique
   link and separate JPEG.
4. Resume **the same live-test batch** with `Run remaining pending` for the other
   five. Do not create another live batch to resend the first one. If interrupted
   after an action starts, use recovery and organizer review; remaining pending
   invitations can be processed while uncertain claims stay excluded.
5. Record actual phone/WhatsApp versions, probe action names/parameter types,
   permission/confirmation prompts, six dry-run outcomes, first live outcome,
   remaining-five outcomes, callback outage/retry, and any uncertain items in
   protected runtime evidence outside Git. Confirm callbacks left organizer
   Sent, verified delivery timestamps, RSVP replies and visit counts unchanged.

The result of authoring is two shortcuts installed on this iPhone. If desired,
export a **generic, credential-free** copy from the iPhone with Share → Options →
File → Anyone, or Copy iCloud Link. Apple validates the shared file/link; no Mac
is needed. Inspect the exported contents before distributing it. The repository
blueprint is still a checklist, not that validated export. See
[Share shortcuts on iPhone](https://support.apple.com/en-gb/guide/shortcuts/apdf01f8c054/ios).

# Apple Shortcuts invitation batches — implementation and pilot

Alpha.8 includes the experimental database and API, synthetic pilot tools and organizer interface.
The feature is off by default. Native Shortcut installation and iPhone/WhatsApp acceptance are pending.
The organizer guide covers batch selection, history, retries, resume and household visits. [Organizer guide](ShortcutOrganizer.md)

Phase B now also has preparatory tools: a durable reference device runner,
an isolated local HTTPS test site, normal test-administrator sign-in and reviewed
batch preparation, plus native iPhone authoring instructions. Start with
[the phone action check](ShortcutsWhatsAppProbe.md),
[HTTPS setup](ShortcutsTestSite.md) and
[the native runner/upload-only guide](ShortcutsNativeRunner.md).
These tools do not constitute an installed or accepted native Shortcut.

The integration extends existing household delivery drafts. It does not send
WhatsApp Business API messages or change administrator account invitations.
Email, SMS, ordinary WhatsApp, postal and Manual workflows remain available.

## Experimental application setting

The installation-wide flag `app_private.shortcut_runtime.enabled` starts false. The existing authenticated `admin_load_data().settings.apple_shortcuts_enabled` exposes only its Boolean value. Settings edit permission and a live session are required for `admin_set_shortcuts_enabled(p_enabled boolean, p_expected boolean)`; the expected value rejects a stale update. The organizer edits it with the normal pencil/Save/Cancel controls in **Settings → Interface → Apple Shortcuts (experimental)**. It is separate from personal Auth account preferences.

While disabled, batch creation, renewal, new claims and image retrieval are rejected server-side. Valid scoped manifest requests return status only and an empty `invitations` array. Existing authenticated, idempotent result callbacks remain available for upload recovery; revocation remains available. Disabling never implies Sent or Verified sent. Restore/reset revokes existing capabilities and resets this flag to false. Publication, permission, reviewed-draft and HTTPS requirements still apply after enabling.

## Organizer history projection

The existing live-session `admin_load_data()` response includes `shortcutBatches`,
`shortcutItems` and `shortcutAttempts` only for administrators with Invites read
permission. Attempts expose processing facts and `claim_active`, not capability
hashes, claim IDs, result event IDs or result fingerprints. History reads do not
reset expired claims. Device authorization is returned only by the existing
protected create/renew operations and remains in browser memory.

## Evidence and delivery identity

The existing `invitation_send_queue.id` is the delivery ID. Each batch item refers
to one reviewed queue revision; `attempt_id` is a separate Shortcuts processing
run UUID. Explicit retries create a new batch/run while preserving earlier runs.
A reminder is a new delivery draft, using the household's existing invitation
code and link. Batching never creates a household invitation identity.

Batch preparation freezes the queue's household, channel, recipient, text, image
and invitation-code snapshot. Change the content by creating another draft and
reviewing it. JPEG data remains in the original queue snapshot; the batch does
not duplicate or re-encode it. The server rejects unresolved placeholders. The
existing scoped placeholder contract remains in force; `{code}` is not supported.
`{invitation_link}`, `{event_name}` and `{household_name}` are resolved during the
existing draft workflow, before Ready, and are not rendered again at retrieval.

The following queue milestones are independent of its existing status:

| Field | Meaning |
|---|---|
| `handed_to_shortcuts_at` | First successful processing claim; preparing or clicking a launch link does not set it |
| `shortcuts_processed_at` | A device reported completion of the configured processing actions |
| `shortcuts_error` | Bounded processing outcome/error code, never a provider payload or URL |
| `shortcuts_attempt_id` | Latest claimed processing run |
| `shortcuts_batch_id` | Its batch |
| `verified_sent_at` | Reserved for reliable delivery evidence; this integration never sets it |

`invitation_shortcut_batches`, `invitation_shortcut_items` and
`invitation_shortcut_attempts` retain membership, source revisions, claims,
per-action results and timestamps. They are protected by RLS and administrator
Invites read permission; writes require guarded RPCs. Existing
`invitation_deliveries` remains the source of organizer-confirmed Sent. Device
results, invitation visits and RSVP submissions do not call the Sent operation.

## HTTPS and credentials

The optional `invitation-shortcuts` Edge Function requires:

- Existing server-only Supabase connection credentials.
- `RSVP_SITE_ORIGIN`: the exact HTTPS website origin.
- `RSVP_SITE_URL`: its full installation base, including any subdirectory.
- Optionally `RSVP_SHORTCUTS_API_URL`: the externally reachable HTTPS function
  base. Its default is `SUPABASE_URL/functions/v1/invitation-shortcuts`.

It uses the existing exact-origin and bounded-body helpers. Configure
`verify_jwt = false` for this function because it accepts its own scoped device
credential as well as organizer JWTs. This does not make operations anonymous:
the handler validates the credential class, and guarded database operations
enforce authorization. The function's server key never goes to the device.
Modern server secret keys are sent to PostgREST in `apikey` only; legacy service
JWTs also use `Authorization`. Organizer calls forward the organizer JWT.

Batch creation requires a live administrator session with `sendInvites`, a
published event and 1–10 distinct Ready WhatsApp drafts with matching revisions,
active households/guests, current invitation codes, resolved text and valid
international recipients. The test modes require publication too.

Creation returns a cryptographically random 30-minute batch capability once.
Only its hash is stored. It is bound to the creator's live session, current
permissions, installation, event generation and permitted operations. A
household invitation code never authorizes a batch operation. Every device
request uses `Authorization: Bearer <batch capability>`, without credentials in
query strings or image URLs. Responses are `no-store` and `no-referrer`.

The API must be reached through HTTPS. The existing HTTP development VM is not
an iPhone HTTPS callback deployment. Source tests use synthetic HTTPS Request
objects and no external network; they do not claim TLS deployment acceptance.
The dedicated pilot additionally checks real HTTPS routing. Supabase terminates
TLS before its isolate and shortens the route to `/invitation-shortcuts/...`.
The deployed adapter restores the configured public route only when the hosted
`DENO_DEPLOYMENT_ID` is present and the gateway reports HTTPS; standalone HTTP
cannot opt into this behavior by supplying a forwarded header.

## Version 1 API

Base: `https://<backend>/functions/v1/invitation-shortcuts`.
Request/manifest definitions are in [ShortcutBatches.schema.json](ShortcutBatches.schema.json).
Additional input properties are rejected. UUID comparisons accept either case.

| Method and path | Authorization | Body / response |
|---|---|---|
| `POST /batches` | Organizer JWT | `{items:[{queue_id,expected_revision}],mode?,retry?}` → HTTP 201 with `schema_version,batch_id,capability,expires_at,mode,count` |
| `GET /batches/{batch_id}` | Batch capability | Manifest with pending invitations and all processing states/counts |
| `POST /batches/{batch_id}/claims` | Batch capability | `{attempt_id,claim_id}` → `claimed,state,attempt_id`, plus action requirements/completions on a new claim |
| `GET /batches/{batch_id}/attempts/{attempt_id}/image` | Batch capability | Original private JPEG, fixed download filename, maximum 1.4 MB |
| `POST /batches/{batch_id}/results` | Batch capability | Processing result below → `accepted,idempotent,state` |
| `POST /batches/{batch_id}/authorization` | Organizer JWT | `{action:"renew"}` returns replacement authorization; `{action:"revoke"}` closes the batch |

The database equivalents are `admin_create_shortcut_batch(jsonb,text,boolean)`,
`admin_manage_shortcut_batch(uuid,text)`, and the service-only
`dispatch_shortcut_batch(uuid,text,text,jsonb)`. Pre-authentication rate limiting
uses the service-only `shortcut_gateway_allow_request(text,text)`.

`mode` is `live` by default, or `dry_run` / `live_test`. `retry:true` explicitly
acknowledges retrying a failed, partial, skipped or uncertain earlier run; it does
not permit repeating a known processed delivery. Already claimed work is never
automatically offered as pending. Renewal rotates the credential and extends
expiry without resetting claims; the owner or a Full administrator with current
sending permission can renew/revoke. Revoke is permanent for that batch.

A manifest item contains:

```json
{
  "attempt_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "delivery_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  "household_name": "Synthetic household A",
  "phone": "+12025550101",
  "message": "Hello Synthetic household A! https://example.invalid/?=ABCDEFGH",
  "invitation_code": "ABCDEFGH",
  "invitation_link": "https://example.invalid/?=ABCDEFGH",
  "image_url": "https://backend.example.invalid/functions/v1/invitation-shortcuts/batches/cccccccc-cccc-4ccc-8ccc-ccccccccccc1/attempts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/image"
}
```

These are fictitious documentation values. Actual URLs use the configured HTTPS
function base and reviewed message. `invitation_link` is extracted unchanged
from the reviewed message; `image_url` requires the same batch credential.
No base64 image is included in the manifest. `required_actions` is authoritative
in a successful claim response, with `completed_actions` carried from an explicit
retry. Manifest `progress` gives `total,pending,claimed,processed,partial,failed,
unknown,skipped`; `statuses` identifies each run and delivery.

A result request is:

```json
{
  "event_id": "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  "attempt_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "claim_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  "result": "processed",
  "channel": "whatsapp",
  "details": {
    "text_action_completed": true,
    "photo_action_completed": true
  }
}
```

Results are `processed`, `partial`, `failed`, `skipped` or `unknown`. Error stages
are `text`, `photo`, `unknown`; error codes are `action_failed`,
`image_fetch_failed`, `cancelled`, `unknown`. Arbitrary error messages are
rejected. `processed` requires all configured actions, including the JPEG when
present, and rejects error fields. Completed actions cannot be discarded.

The same event ID and normalized result return `idempotent:true` without another
write. A conflicting result or reused event ID is rejected. A callback cannot
provide Sent/verified timestamps, another recipient or household, or its own
authoritative timestamp. An already issued claim can report its result after
organizer Sent confirmation while the batch remains authorized.

HTTP acknowledgments distinguish invalid input (400), missing/expired credentials
(401 or 403), changed/conflicting delivery state (409), rate limits (429), and
temporary service failures (503). Internal SQL/provider details are not returned.
Pre-auth global/source/token limits are separate from guest RSVP capacity; the
global limit is checked before allocating new caller buckets.

## Interruption and upcoming Shortcut actions

Each claim has a five-minute processing lease. Persist a claim ID before asking
for it; `claimed:true` permits that run once. A repeated claim returns
`claimed:false`, even with the same ID. If its first response was lost, do not
send again automatically. An expired claim becomes Unknown, never Pending.
An existing authorized claim can still upload its result after lease expiry.

The device-side implementation in Phase B must:

1. Receive the batch base/ID and short-lived authorization without putting a
   reusable credential in an HTTPS URL. Apple supports clipboard input to a
   named installed Shortcut.
2. Retrieve pending items and claim each item. Obey `claimed` and action flags.
3. Download the JPEG with the Authorization header and preserve the text/link.
4. In dry run, simulate the configured actions without opening WhatsApp.
5. In live test, perform only the configured iPhone actions for the allowlisted
   organizer-controlled recipients. Actual image/text behavior requires testing.
6. Persist the result/event ID locally before uploading it. Retain unacknowledged
   results and retry their upload without repeating WhatsApp actions. After
   credential expiry, obtain renewed authorization while retaining the outbox.

This action sequence is a contract for Phase B, not an installed or physically
tested Shortcut. A launch link or Shortcut completion is not a delivery receipt.

The reference module `js/shortcut-device-runner.js` tests those checkpoints with
injected HTTP, atomic storage and app-action adapters. Native Shortcuts does not
execute that module. Its identifier/flag-only journal and immutable callback
outbox survive simulated restarts; the reference tests also cover lost claims,
storage failures, expired authorization, callback-only retry and duplicate runs.
The technical test page uses transactional IndexedDB only for its optional
browser dry run. It refuses browser live actions.

`tools/prepare-shortcuts-pilot.mjs` is an alternative operator CLI for dedicated
test installations. It requires an explicit expected project reference, normal
administrator JWT and private stdin/runtime files; it never publishes an event
or creates an Auth session. Its supported guest/contact RPC fixtures are checked
against the same review validator as the browser helper. Keep private artifacts
outside the checkout and every public preview directory.

## Isolated synthetic workflow

`tests/helpers/shortcut-fixture.cjs` creates six clearly labeled synthetic
households and separate reviewed deliveries in a disposable database. It uses
two fictitious numbers, three invitations per number, unique codes/links/run
IDs, distinct text and one reusable [dummy JPEG](../tests/fixtures/shortcut-test.jpg).
The JPEG explicitly says SYNTHETIC CELEBRATION / NOT A REAL EVENT.

`tests/shortcut-batches-workflow.mjs` runs a simulated device through the actual
API handler and database, including image retrieval, interruption after two,
resume and duplicate callback upload. Any network call fails the test.

Synthetic modes are disabled by default. An operator must configure
`app_private.shortcut_runtime` with exactly six test household UUIDs, exactly
two distinct international phone numbers, and `test_enabled=true` in a separate
test installation, with the global experimental setting explicitly enabled. Mode creation and every device operation enforce that
allowlist. Do not seed, copy real households into, or enable these trials against
a populated installation. Configure actual test numbers outside source/Git only
when conducting the subsequent supervised iPhone trial.

## Qualified invitation visits

The existing access audit remains coalesced successful invitation loads. It is
not backfilled into new qualified counts. A published real bootstrap may issue
a five-minute, household/page-generated-session/install/generation-scoped receipt.
The page acknowledges after two animation frames when rendered and visible,
without a dwell-time threshold. Receipt retries are
idempotent; household row locking groups reloads/parallel receipts within
15 minutes. First/latest/count are stored on `households`, in UTC, independently
of RSVP state and delivery attempts. They are available for the Phase C view.

The gateway filters recognizable preview bots and prefetch/prerender hints.
Authorized preview routes never issue receipts. A verified active administrator
session on an ordinary invitation link suppresses qualified tracking too.
An administrator opening anonymously cannot be distinguished from another
guest. Visible pages and these filters provide approximate visits, not proof of
human identity or a WhatsApp read receipt. Analytics failures do not become
guest-facing errors.

## Installation and recovery

Fresh installations use the current baseline or its generated installer, with the experiment disabled. Do not replay that installer over an installed event. The current contract has 43 application backup tables; envelope format 2 and the existing 20 MB limit remain. Earlier 40-table exports are not adapted.

For existing installations, follow the [existing-installation instructions](README.md#existing-installations). Rehearse the scoped change against a disposable copy and retain a protected backup before applying it. Verify data, private images, permissions, unpublished state and the installed contract afterward.

Deploy the guest gateway and guest JavaScript with compatible backend changes. The optional Shortcuts function requires an HTTPS-configured installation.
Generated Studio entrypoints are under `supabase/studio/`; the separate
administrator invitation bundle is unchanged. Automatic setup still deploys its
existing two required functions; the optional Shortcuts function is separate.

Full/no-log backups retain durable batch history and visit totals; Partial
planning templates exclude batches and reset visits. Credentials, active leases,
visit receipts and runtime test allowlists are excluded. A successful clean,
replacement, Wipe or Partial restore rotates automation/visit generations and
revokes operational state; preview rollback preserves it. Restoring history
never restores an active ability to send. Relational actor IDs participate in
existing cross-identity restore mapping.

## Verification boundary

Run the focused acceptance without credentials or a populated database:

```sh
node tests/shortcut-batches-db.cjs
node tests/shortcut-batches-api.mjs
node tests/shortcut-batches-adapter.mjs
node tests/shortcut-batches-workflow.mjs
node tests/household-visits-db.cjs
node tests/household-visits-gateway.cjs
node tests/household-visits-browser.cjs
```

The database/API suites cover publication, 1–10/11 rejection, household-specific
snapshots and JPEGs, six-item dry run, membership/auth/expiry/revocation,
idempotence, interruption/resume, explicit partial retry, unchanged Sent/verified,
and independent visit/RSVP state. Browser checks cover visible-page tracking,
hidden/prerender deferral and preview exclusion. Existing channel/template,
guest privacy, backup/restore and installer checks cover regressions.

These source passes do not establish physical Shortcut installation, actual WhatsApp sending, native Apple/WebKit acceptance, a full security audit or release CI. Phase C is implemented behind the disabled experimental setting. Phase B has reference/helper preparation; native artifact and phone acceptance remain pending. Separate deployment and PostgreSQL evidence must identify the exact tested target.

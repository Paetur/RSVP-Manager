# Automatic cloud setup

The trusted setup companion initializes a dedicated Supabase Cloud project and creates the first administrator. It runs temporarily on **your computer**, independently of the project's not-yet-deployed Edge Functions. The public website stays static; do not put a Supabase secret/service_role key or Management API access token into its configuration, Actions variables or browser storage.

For a local Docker Supabase stack, or if you prefer SQL Editor/Studio, use the existing [manual setup](../setup.html), [Local guide](LocalSetup.html) or [Studio guide](StudioSetup.html). The cloud Management API does not manage a local Docker stack.

## Start the companion

Download/extract the selected RSVP Manager release on a trusted computer with Node 22.23 or newer. From its root:

```sh
npm ci
node --experimental-strip-types tools/setup-companion.mjs
```

Open the printed **http://127.0.0.1:8090/** address on that computer. If the port is in use:

```sh
node --experimental-strip-types tools/setup-companion.mjs --port 8091
```

The listener is deliberately bound to loopback. Do not expose or proxy it publicly. If running it on your own remote VM, forward the local port over SSH and open the forwarded 127.0.0.1 address on your computer:

```sh
ssh -L 8090:127.0.0.1:8090 USER@VM_HOST
```

The automatic page on a static website displays these startup instructions; it does not accept privileged credentials there. All automatic-wizard requests go to the local companion. Its scripts/styles are local, with no third-party browser scripts in the credential-entry page.

## Seven steps

1. **Connection.** Provide the canonical `https://PROJECT_REF.supabase.co` URL, its matching 20-letter reference, a publishable/legacy anon key, a secret/service_role key, a Supabase Management API PAT and the **final website base URL**, including any subdirectory/trailing slash. Use a dedicated healthy project with Data API enabled. The service validates project/public/Auth Admin access and reads the required management endpoints. Missing write permissions are reported at the relevant step; validation does not pretend to prove writes by making unrelated changes.
2. **Database.** Install the hash-checked complete installer atomically, or add missing tables/functions/views/triggers/policies/indexes/constraints/identity definitions to a compatible partial installation. Existing rows and function definitions are not replaced. Column/type or function-body incompatibilities, unrelated public tables, a published event or conflicting administrator state stop initialization. A failed SQL transaction rolls back. Retry uses the current schema rather than creating duplicate objects.
3. **Administrator.** Enter email/password. The server uses `auth.admin.createUser({ email, password, email_confirm: true })`; the account appears in **Authentication → Users**. Authorization is in protected `public.admins`, with the existing full permission preset and session/RLS checks—not editable user metadata. An existing Auth account is reused with its current password, without a password reset. Unconfirmed bootstrap accounts may be confirmed by the trusted service. The service verifies actual password sign-in and `is_admin()` before continuing. A lost creation response is recoverable without duplicating the account. Passwords never enter application settings or logs.
4. **Secrets.** Configure `RSVP_SITE_ORIGIN` and `RSVP_SITE_URL`. Platform `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEYS` are provided by Supabase; the companion does not overwrite reserved platform secrets. Current functions require no third-party API secret. Optional application secrets use unique `RSVP_` names (maximum ten, 8KB each, subject to the 64KB request limit). Unrelated secrets are preserved. Values are not displayed after submission; provider metadata/digests verify configuration.
5. **Functions.** Deploy only `guest-gateway` and `admin-invitations`, using this release's integrity-checked, self-contained Studio bundles. Both require `verify_jwt=false` because their existing handlers perform application validation. Existing compatible JWT settings and display names are retained. A conflicting JWT setting stops the step for operator review instead of being silently changed. Other functions are untouched. Deployment is followed by metadata/status checks.
6. **Configuration.** Set Auth Site URL and merge the administrator invitation redirect into the existing allowlist. Ensure `public` is exposed to the Data API and `app_private` is not, preserving unrelated settings. Existing event defaults come from the installer; only an unset website URL is filled. Setup does not publish the event.
7. **Verification.** Recheck schema, confirmed full administrator, secrets, function metadata, protected runtime responses, Auth redirects and Data API schemas. Require the event to remain unpublished. Only then write the initialized state, discard temporary privileged credentials and offer administrator login/public configuration.

The privileged database mechanism is the Management API SQL endpoint, not a browser query or an Edge Function that would itself need installing first. Management token permissions must cover the selected project and database queries, Auth configuration, Edge Functions and secrets. Current APIs and permissions are linked below.

## Publish only public browser configuration

After completion, download **config.js**, containing only the project URL and public browser key. For direct static hosting, install it as `js/config.js`. For the existing GitHub Pages deployment workflow, set `RSVP_SUPABASE_URL` and `RSVP_PUBLISHABLE_KEY` as Actions variables and redeploy. The setup companion has no GitHub credential and does not edit an unrelated hosting repository for you.

**Continue to administrator login** transfers only public connection values in a URL fragment to the chosen website's existing setup page. That page clears the fragment, configures this browser and opens administrator login. This lets the installer sign in immediately, but other devices still need the published public configuration. Configured applications use the minimal `get_setup_status()` completion probe to bypass first-time setup; `setup.html?manual=1` explicitly opens manual setup when needed.

No secret/service_role key, PAT or administrator password belongs in `config.js`. Do not put them into a public Actions variable or source file.

## Interrupted setup and errors

- Project progress is stored in protected `app_private.installation_state`: release/installer identity, completed steps, site URL, first administrator ID and secret digests. It contains **no credential values or passwords**. Pending administrator email is cleared on successful completion. This operational table is intentionally outside the 40-table application backup manifest; it is not an event/guest record or an Auth backup.
- Reloading the companion page reuses its temporary session. After process restart, disconnect or the 30-minute idle timeout, reconnect with credentials and the same website URL/release build; completed project steps are rediscovered. A different installer hash or website URL cannot silently take over a partial setup.
- A failed database, Auth, secret, configuration or deployment step retains completed steps and gives a retry. Re-enter a cleared password/optional secret when retrying it. The UI does not retain sensitive inputs for convenience.
- An already initialized application is detected and left unchanged. The completion page says it is an existing installation; it does not claim the event is unpublished or change its settings. This first-time wizard is not a general upgrade/recovery tool.
- The service only adds absent objects in compatible partial schemas. It refuses incompatible existing definitions rather than guessing destructive repairs. No reset command runs automatically.
- If Data API is disabled, enable it in the project's API settings before administrator RPC verification. If a function has not propagated yet, retry its verification. A 401/403 requires checking keys or PAT permissions; provider error bodies/SQL/secret values are not echoed.
- Use **Disconnect and forget credentials**, then stop the process with Ctrl-C. Privileged credentials exist only in temporary process memory while needed; there is no claim of cryptographic RAM erasure. Same-origin/CSRF checks, a strict Host check and a loopback listener protect the local HTTP interface.

## Verification and scope

Repository acceptance uses the actual Supabase JS Auth Admin client, disposable PostgreSQL-compatible SQL and synthetic Management/Auth/runtime HTTP responses. Tests cover fresh/partial/already-installed schemas, bad keys/permissions, atomic failures, lost Auth responses, retry, administrator login/authorization, secret/function failures, configuration preservation, HTTP security, no credential storage/echo and phone/desktop EN/DE/FO UI. These checks do not replace a fresh operator-owned Supabase Cloud acceptance run. No real project is created, reset or reconfigured by tests.

Developer commands:

```sh
node --experimental-strip-types tests/automatic-setup.mjs
node --experimental-strip-types tests/automatic-setup-http.mjs
node --experimental-strip-types tests/automatic-setup-browser.mjs
```

TypeScript is checked with the pinned compiler; runtime uses Node's native type stripping. Existing builds keep installer/Studio/CSS/locale outputs synchronized. Full release/hosted CI includes the new acceptance; ordinary development still uses targeted checks.

## Supabase references

- [Auth Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Management API SQL query](https://supabase.com/docs/reference/api/v1-run-a-query)
- [Management API function deployment](https://supabase.com/docs/reference/api/v1-deploy-a-function)
- [Auth service configuration](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Official Management API OpenAPI contract](https://github.com/supabase/supabase/blob/master/apps/docs/spec/api_v1_openapi.json)

The implementation checked these current endpoints and their multipart/parameter formats on 14 November 2026. It uses Management API HTTP calls and the pinned SDK; it does not depend on a functioning Supabase CLI deployment command.

[All user guides](README.md)

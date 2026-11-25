# Isolated iPhone HTTPS test website

Use this local preview only with a dedicated synthetic test installation. It copies reviewed website assets into a fresh directory, creates a temporary local certificate authority (CA), and prepares a separate unprivileged Nginx instance. It does not release the application, install it over an existing website, configure the system Nginx service, migrate a backend or publish an event.

The website and bootstrap ports must be reachable from the iPhone on the same trusted LAN. The hostname supplied below must already resolve to the test VM from the phone. A `.local` name can use the VM's existing mDNS hostname; the tool does not create DNS records or configure a firewall. No tunnel provider, public hosting account or paid service is required.

## Prepare without starting services

Install OpenSSL, Nginx and Node through the normal operator workflow if absent. Create an operator-owned JSON file outside the source checkout with only the dedicated test project's **public** connection:

```json
{
  "supabaseUrl": "https://abcdefghijklmnopqrst.supabase.co",
  "supabaseKey": "sb_publishable_REPLACE_WITH_PUBLIC_TEST_KEY"
}
```

The values above are synthetic examples. Use an editor or the already approved setup output to create the real file. Keep service/secret keys, passwords, real phone numbers and batch capabilities out of command arguments, this JSON file, source files and the static website. The tool rejects additional connection fields and privileged keys. An existing installed `config.js` is not a source for this preview.

Run from the reviewed source tree, using fresh private paths outside the checkout:

```sh
chmod 600 /private/path/test-public-connection.json
node tools/shortcuts-test-site.cjs prepare \
  --runtime-dir /private/path/new-synthetic-site \
  --connection /private/path/test-public-connection.json \
  --hostname test-vm.local
```

`--source /absolute/reviewed/source` selects a different source tree. Defaults are HTTPS port `8443`, certificate bootstrap port `8094` and bind address `0.0.0.0`; `--port`, `--bootstrap-port` and `--bind` can override them. Use `--bind 127.0.0.1` for a loopback-only check. Preparation refuses an existing runtime directory and never starts a listener.

The preview includes the same HTML, setup files, browser JavaScript, CSS, locales and public guides as the ordinary local publisher. It also copies the reviewed `tools/shortcuts-test-page.html` template to `/shortcuts-test.html` and includes the three scripts that power that page. Both browser connection files are generated fresh. Private records, Git metadata, test fixtures and server runtime configuration are excluded. Selected symlinks and detectable private keys/privileged tokens are rejected. Review the source and export; the scanner cannot establish that arbitrary text is free of every possible private value.

`site/` contains only that static website and the public test connection. `private/` contains TLS keys, certificates, Nginx configuration, the export manifest and process metadata. The runtime directory and its private directory are mode `0700`. Keep all of it outside any other webroot and outside Git. The private CA lasts 30 days; its hostname certificate lasts 14 days. Create a fresh runtime when the source, hostname or certificates change.

## Start and verify the public certificate

After reviewing the prepared export, start the isolated preview as the same unprivileged Unix account that prepared it:

```sh
node tools/shortcuts-test-site.cjs run --runtime-dir /private/path/new-synthetic-site
node tools/shortcuts-test-site.cjs status --runtime-dir /private/path/new-synthetic-site
```

The separate Nginx process loads only this runtime's configuration. It does not edit or reload system Nginx. Request access logging is disabled and Nginx diagnostics go to `/dev/null` at critical level, so invitation URLs are not written to preview logs. The separate HTTP bootstrap endpoint serves only fixed trust instructions at `/` and the **public** CA certificate at `/ca.cer`; it cannot serve arbitrary files, website content or TLS keys. Keep that endpoint on the trusted LAN and stop it with the preview after testing.

The terminal prints the CA's SHA-256 fingerprint. On the iPhone, open the printed bootstrap URL in Safari and download the certificate. Before trusting it, compare the certificate's fingerprint with the operator terminal over a separate trusted channel; the HTTP page alone cannot authenticate itself.

Install the downloaded profile in Settings. Then enable full trust for **RSVP synthetic test CA** under **Settings → General → About → Certificate Trust Settings**. A manually installed certificate profile is not automatically trusted for SSL. Apple's [certificate trust instructions](https://support.apple.com/en-us/102390) describe this requirement. Check the certificate details and fingerprint before enabling trust.

Open the printed HTTPS origin in Safari. It must load without a certificate warning and show the dedicated synthetic application. Check the admin page and the actual Shortcut's HTTPS requests on the physical phone; desktop certificate validation is not iPhone acceptance. If the hostname does not resolve, the port is blocked, or the CA is not trusted, fix that condition before proceeding. Do not bypass certificate validation.

The [Shortcuts test helper](../shortcuts-test.html) is at `/shortcuts-test.html` on this isolated origin. Prepare the export after final source/template changes; `run` rejects changes to exported files after preparation. Supply short-lived batch authorization only through the helper's supported memory/clipboard workflow, never by adding a public file to the export.

To prepare a batch on the helper, sign in normally with an existing confirmed test administrator. The page clears the entered password immediately and retains its access token only in memory. Its protected data read must verify the exact synthetic event, six named households with linked guests/phone contacts, two approved recipients and twelve existing Ready WhatsApp drafts across the two test modes. Select a mode, review all six messages/recipients and the shared labeled JPEG, then check the explicit review box before creating that batch. Creation uses the existing protected batch API and rechecks the reviewed revisions. The page has no account creation, access-granting, seeding, publication or Sent action. Existing batch authorization can also be entered directly; native launch input includes its verified mode and two-recipient allowlist.

## Install the native shortcuts from the helper

The helper includes an installation panel for **RSVP Upload Results** and
**RSVP Batch Runner**. Install the uploader first. Paste each shortcut's reviewed,
generic iCloud share link and confirm that its shared copy contains no credentials,
private contact references, recipient data or invitation URLs. The Install link
then opens Apple's import screen, where you review and add the shortcut.
Apple documents [sharing and importing through iCloud](https://support.apple.com/guide/shortcuts/share-shortcuts-apdf01f8c054/ios).

The page accepts only canonical HTTPS iCloud Shortcut links. It does not fetch,
inspect or store their contents, or establish that the shared workflow is safe or
works on the phone. Installation inputs and manual setup checks reset on refresh;
the Clear installer links and checks control also clears them. They do not change native
live gates, create a batch, count processing or verify a WhatsApp send.

No native shortcut artifact or share link ships with this source. The supplied
example ZIP is a web checklist, not the two shortcuts. Until reviewed iCloud
links exist, the Install controls remain unavailable. Build the generic shortcuts
using the [iPhone authoring guide](ShortcutsNativeRunner.md), then share reviewed
copies from the phone. Keep runtime authorization and the two recipients in the
existing separate copy-and-launch flow. No signed download, unattended photo
routing or device acceptance is implied by the web installer.

## Dedicated backend configuration

Configure only the isolated test backend with this exact origin, including the HTTPS port, and its full base URL:

```text
RSVP_SITE_ORIGIN=https://test-vm.local:8443
RSVP_SITE_URL=https://test-vm.local:8443/
RSVP_SHORTCUTS_API_URL=https://PROJECT_REF.supabase.co/functions/v1/invitation-shortcuts
```

Supply actual values through the backend's private configuration workflow, not through source edits. Keep server credentials on that backend. Configure its Auth Site URL and required administrator redirects for the same test website. The Shortcuts handler requires both website and API URLs to use HTTPS and keeps its exact-origin check; do not broaden CORS for this preview.

The dedicated synthetic event must satisfy the batch API's publication/allowlist requirements before device acceptance. Publication of that disposable synthetic event is a separate operation from serving this website. Never change a populated event or reuse its records, private photos or operational capabilities for this trial.

## Stop and remove device trust

```sh
node tools/shortcuts-test-site.cjs stop --runtime-dir /private/path/new-synthetic-site
node tools/shortcuts-test-site.cjs status --runtime-dir /private/path/new-synthetic-site
```

Stop verifies process ownership, executable and start identity before signalling the recorded preview processes. It refuses an unrelated/reused PID. It leaves the runtime intact for private review and does not signal system Nginx.

Remove the **RSVP synthetic test CA** profile from the iPhone after testing and confirm its trust is gone. Remove the preview's Auth redirects/configuration when retiring the dedicated test environment. Delete the private runtime directory only after `status` confirms both preview processes are stopped. No physical-device or live delivery acceptance is established merely by preparing or running this website.

Offline isolation and certificate checks:

```sh
node tests/shortcuts-test-site.cjs
```

These checks generate disposable certificates and verify export, bootstrap and process-safety boundaries without starting network listeners.

For explicitly authorized loopback transport acceptance, add `--loopback`. That variant starts disposable HTTPS/bootstrap listeners bound only to `127.0.0.1` on ephemeral ports, checks certificate validation and private-path isolation, then stops its verified processes. It does not establish LAN or physical iPhone acceptance.

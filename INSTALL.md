# Install RSVP Manager

Each installation has its own database, Auth users, website configuration and event. A fresh release contains no event records, private background photo or connection to an existing deployment.

## Requirements

- A static HTTPS website host. This alpha requires the site at the domain root for administrator invitation redirects; project-subdirectory hosting is not yet supported for that email flow. A dedicated hostname or GitHub user-site root works.
- A separate Supabase project, or a separately managed local Supabase stack.
- The Supabase CLI when deploying the included Edge Functions. Use the same release for the website, database and functions.

## New installation

1. Download and extract a versioned release ZIP. Keep its `version.json`, `release-manifest.json` and `SHA256SUMS` with your installation records. Verify the published ZIP checksum before using it.
2. Serve the extracted website files, including `setup.html` and `supabase/install.sql`, using the host's root directory. Keep local secrets, configuration exports, database backups and `.git` out of the website directory.
3. Open `setup.html`. Create your own Supabase project and first Auth user. Run the included installer SQL only against a new destination, then follow the wizard to establish the first administrator. Never replay the installer over an existing populated event.
4. Set the Edge Function secret `RSVP_SITE_ORIGIN` to this installation's exact website origin, such as `https://events.example.org`. Do not include a path, query or trailing route. Set database/service credentials only on the server. Deploy `guest-gateway` and `admin-invitations` from this release using `supabase/config.toml`.
5. Set Supabase Auth's Site URL to this website and allow its administrator invitation redirect, such as `https://events.example.org/admin/?admin-invitation=1`. Configure email delivery for real administrator invitations. See the wizard's current instructions and the [administrator guide](docs/Administrators.md).
6. Supply only this project's public/publishable browser key and URL through the wizard. Store the resulting per-installation browser configuration outside the development checkout; install it as directed by the wizard. Service/secret keys never belong in browser files.
7. Sign in, configure the event and test an invitation preview. A new event stays unpublished until you deliberately publish it.

For a local VM, use an explicitly configured local origin and backend; preserve its service configuration separately. Public release defaults deliberately contain no deployment address or backend key.

## Existing event and upgrades

Keep protected application and infrastructure backups before upgrading. Match the exact installed migrations and release contract; do not replace a populated database with the fresh installer. Application restore is a separate operation requiring an empty, unpublished destination. See [Backups](docs/Backups.md).

This alpha accepts current backup/CSV formats only. Release 0.9.0-alpha.1 uses application backup format 2/schema 20261113213849; compressed .json.gz files contain that same envelope. Database changes after this release will be described in subsequent release notes.

## Forks and testing

Fork the public repository for your own code changes, or install a selected release ZIP for a reproducible version. Configure an independent backend for each test/new installation. Source changes do not transfer any event data automatically.

The repository's verification workflow uses synthetic fixtures and disposable databases. Actual deployment smoke checks are explicit: set `RSVP_SMOKE_SITE_URL`, `RSVP_SMOKE_API_URL` and `RSVP_SMOKE_PUBLISHABLE_KEY` for an unpublished test installation, then run `node tests/rsvp-smoke.cjs`. That check makes test gateway requests and should not be aimed at an event serving real guests.

## Current alpha limits

Administrator password recovery, optional backup encryption and additional food-interest feedback/reporting remain planned. Gzip compression is implemented. Physical-device/native-app and full published-journey acceptance remain separate from automated checks. Publication and an installation's data are always controlled by its owner.

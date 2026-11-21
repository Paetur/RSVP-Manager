# Install RSVP Manager

Each installation has its own database, Auth users, website configuration and event. A fresh release contains no event records, private background photo or connection to an existing deployment.

## Requirements

- A static HTTPS website host. Domain-root and subdirectory installations are supported, for example `https://events.example.org/marriage/`.
- A separate Supabase project, or a separately managed local Supabase stack.
- Supabase Dashboard/Studio access for browser-based database, Edge Function and Auth setup. The CLI is optional. Use the same release for the website, database and functions.

## Automatic cloud setup

For a dedicated Supabase Cloud project, the [trusted local setup companion](docs/AutomaticSetup.md) performs the seven installation steps, including first administrator, secrets and Edge Functions. Run it temporarily on your computer; privileged credentials never belong in the static website. The manual Local/Cloud route below remains available.

## Existing installations

Beta.2 keeps the beta.1 application table layout and backup contract. A retained beta.1 installation needs a scoped update to the administrator load and delivery-recording functions and the canonical translation registry. Use the fresh installer only on an empty application database.

Verify the installed schema and prepare a reviewed change for that installation. Protect its database, administrator access, private photos and configuration, including the existing publication setting. Rehearse the update and rollback on disposable data, then verify data and access afterward. Keep the website and backend compatible.

## New installation

1. Download and extract a versioned release ZIP. Keep its `version.json`, `release-manifest.json` and `SHA256SUMS` with your installation records. Verify the published ZIP checksum before using it.
2. Serve the extracted website files, including `setup.html` and `supabase/install.sql`, under the chosen installation directory. Keep local secrets, configuration exports, database backups and `.git` out of the website directory.
3. Open `setup.html`. **Step 1:** choose New database → Local or Cloud, or Existing database for an installed event.
4. **Step 2, before Test connection:** for an empty cloud project, create the project with the security options below and run the complete installer once in SQL Editor. Then save `RSVP_SITE_ORIGIN` / `RSVP_SITE_URL`, deploy both release-matching Edge Functions with platform **Verify JWT OFF**, and configure Auth Site URL / allowed administrator redirects. Follow [the complete Studio guide](docs/StudioSetup.html) now. Local installations follow [the local guide](docs/LocalSetup.html). Existing installations verify their server setup without reinstalling SQL. Only then enter the public project URL/key and test the connection. The wizard checks the database and guest-gateway; it does not configure the server for you.
5. **Step 3** offers the trusted setup companion and Manual setup. For Manual setup, create and confirm the first Auth user, generate the first-administrator SQL, and run it in your own SQL Editor. Verify the administrator login. Existing installations use their existing administrator.
6. **Step 4:** publish the browser configuration for all visitors. For the selected-release GitHub Pages workflow, set both [Actions variables](#configure-jsconfigjs-with-github-actions) and redeploy the same release. For direct static hosting, upload the downloaded file as `js/config.js`. Browser-only setup is temporary for that browser; it does not configure the deployed website for others.
7. **Step 5: HTTP/SSL.** Installations with an HTTP/SSL companion can generate a certificate for a public domain under **Cloud** or a local network hostname under **Local**. Devices using a Local certificate must trust its local CA. Choose **None** to keep the current listener settings. Static hosted installations manage HTTPS with their website host.
8. Sign in, configure the event and test an invitation preview. A new event stays unpublished until you deliberately publish it.

The site origin has no path or trailing slash, such as `https://events.example.org`. The full installation URL includes the path and trailing slash, such as `https://events.example.org/marriage/`. Set Auth Site URL to that full URL and allow its `admin/?admin-invitation=1` redirect. Keep server credentials in Supabase; browser configuration contains only the public URL/key. Configure SMTP for real administrator invitations.

On installations with the companion, use **Settings → Interface → HTTP/SSL** after setup to manage certificates and listeners. The redirect option is available when both HTTP and HTTPS are enabled. For a local VM, use an explicitly configured local origin and backend and keep its service configuration separate. Public release defaults deliberately contain no deployment address or backend key.

## Local or Cloud

Under **Set up a new database**, choose **Local** or **Cloud** before continuing. Local uses your computer/VM’s Supabase stack and Studio, with its API URL/public key from `supabase status`; follow the [local setup guide](docs/LocalSetup.html). Cloud uses the [cloud Studio guide](docs/StudioSetup.html).

When creating the cloud project, use these **Security options**:

| Option | Set to | Why |
|---|---|---|
| Enable Data API | ON | Website and Edge Function database calls require it. |
| Automatically expose new tables | OFF | The installer supplies explicit table/function grants. |
| Enable automatic RLS | ON | Protects future tables; the installer also enables RLS and creates the application policies. |

Keep `public` in the Data API exposed schemas; do not expose `app_private`. For an existing project, check Data API availability and schema exposure under **Integrations → Data API**. These settings do not publish the event. Do not add broad grants or disable RLS to fix a connection error.

## Studio-first setup

The [browser guide](docs/StudioSetup.html) provides complete, checksum-verified code to copy into Studio. [Plain instructions](docs/StudioSetup.md) and the generated `supabase/studio/*.ts` files are also included. Both functions come from the same canonical modules as CLI deployments.

The installer is a single current application baseline with RLS enabled. It runs atomically and refuses an existing application schema. No previous application version, migration chain or compatibility installation is required.

## Configure js/config.js with GitHub Actions

For a selected-release Pages deployment, **do not upload or commit the wizard's downloaded `config.js` to the website repository**. Each deployment builds a new artifact and generates `js/config.js` from repository Actions variables.

1. In the **website repository**, open **Settings → Secrets and variables → Actions → Variables**.
2. Click **New repository variable** for each setting below. Copy the values from the setup wizard or its downloaded configuration. Enter just the value, without JavaScript quotes.

| Repository variable | Downloaded config field | Value |
|---|---|---|
| `RSVP_SUPABASE_URL` | `supabaseUrl` | Your public Supabase project URL |
| `RSVP_PUBLISHABLE_KEY` | `supabaseKey` | Your publishable browser key |

3. Open **Actions → Deploy RSVP → Run workflow** (or the deployment workflow's chosen name), select the release tag, and run it again.
4. Open the deployed website in a private browser window to check that it uses the configured backend. Browser-only wizard settings do not configure other visitors.

These two values are public browser settings. Never enter a database password or server/service/secret key here. The deployment builder rejects privileged keys. Supply both values together; leave both empty only for an unconfigured setup site.

CLI alternative, after `gh auth login`:

```bash
gh variable set RSVP_SUPABASE_URL --repo OWNER/WEBSITE --body 'https://YOUR-PROJECT.supabase.co'
gh variable set RSVP_PUBLISHABLE_KEY --repo OWNER/WEBSITE --body 'sb_publishable_YOUR_PUBLIC_KEY'
gh workflow run deploy.yml --repo OWNER/WEBSITE --field release_tag=v0.9.0-beta.2
```

Use the workflow filename and release input name from your copy of the [deployment template](deployment/README.md). For direct static hosting without this Actions workflow, upload the wizard's downloaded file as `js/config.js` in the installation directory instead.

## Current database and backup contract

`supabase/migrations/` contains one baseline, and `supabase/install.sql` is its generated SQL Editor equivalent. Use either installation route once. Do not apply both to the same database. Regenerate/check the SQL Editor file with `node tools/build-install-sql.cjs` / `--check`.

Test a fresh install against an empty, independent backend. Restore requires the current backup format and exact schema. The application backup envelope remains format 2/schema `20261114034908`; compressed `.json.gz` files contain the same envelope. Application restore uses the current contract and requires an empty, unpublished destination. See [Backups](docs/Backups.md). Resetting a test database is a separate destructive operator action.

## Forks and testing

Fork the public repository for your own code changes, or install a selected release ZIP for a reproducible version. Configure an independent backend for each test/new installation. Source changes do not transfer any event data automatically.

The repository's verification workflow uses synthetic fixtures and disposable databases. Actual deployment smoke checks are explicit: set `RSVP_SMOKE_SITE_URL`, `RSVP_SMOKE_API_URL` and `RSVP_SMOKE_PUBLISHABLE_KEY` for an unpublished test installation, then run `node tests/rsvp-smoke.cjs`. That check makes test gateway requests and should not be aimed at an event serving real guests.

## Verify your installation

The published guest journey runs with synthetic data on a disposable database. Check supported physical devices and sharing apps, keyboard and screen-reader navigation, and actual administrator email delivery on your test installation. Publication and an installation’s data are always controlled by its owner.

## Publish to a local webroot

Use the public-file publisher with the extracted release, a private path to the wizard’s public browser configuration, and the destination webroot:

```bash
python3 deployment/publish-web.py /path/to/release /private/path/config.js /path/to/webroot
```

It includes the SQL installer, hash manifest, guides and Studio code downloads. Existing `js/config.production.js` is preserved; `js/config.js` comes from the explicit configuration file. Private development files, raw server modules and environment files are excluded. Publishing files does not run SQL or publish an event.

# RSVP Pages deployment

Copy this directory's contents into your website repository, such as `<owner>.github.io`. The repository contains deployment instructions; application files come from a selected published RSVP-Manager release.

1. Enable GitHub Pages with **Source: GitHub Actions** in repository Settings → Pages.
2. Review `deployment.json`: select the release repository and installation path, normally `marriage`. Use `"path": ""` to publish the application directly at the domain root. Root deployments retain the application index instead of adding a separate landing page.
3. For an unconfigured setup site, leave repository variables empty. When your separate Supabase project is ready, set **Settings → Secrets and variables → Actions → Variables**: `RSVP_SUPABASE_URL` and `RSVP_PUBLISHABLE_KEY`. Use **New repository variable** for each. Copy `supabaseUrl` and `supabaseKey` from the wizard or its downloaded configuration, without JavaScript quotes. Supply both together. These are public browser settings; server/service keys stay in Supabase.
4. Open **Actions → Deploy RSVP → Run workflow**, enter a published tag such as `v0.9.0`, and run it. The workflow downloads the release automatically, verifies the ZIP and file checksums, injects public connection settings and publishes the Pages artifact.
5. Open `https://<owner>.github.io/marriage/setup.html` to finish installation. Setup may save a connection locally in that browser; deploy the public variables above so other visitors use the same backend.

For this example set Edge secrets `RSVP_SITE_ORIGIN=https://<owner>.github.io` and `RSVP_SITE_URL=https://<owner>.github.io/marriage/`. Configure Supabase Auth's Site URL to the full installation URL, with `https://<owner>.github.io/marriage/admin/?admin-invitation=1` allowed as an administrator invitation redirect. Deploy both Edge Functions from the same selected release using the [browser-based Studio guide](../docs/StudioSetup.md); the CLI is optional. Complete that step before the wizard’s connection test.

The workflow generates `js/config.js` in the Pages artifact from those variables on every run. Uploading or committing a separate `js/config.js` to this website repository does not configure the generated site. After changing variables, rerun the deployment workflow. For CLI configuration, see [the install guide](../INSTALL.md#configure-jsconfigjs-with-github-actions).

The workflow supports an explicit version change without manual ZIP downloads. It does not create or migrate a backend, restore data or publish an event. Each fresh backend starts unpublished; event publication is a separate administrator action. For an existing installation, keep website and backend versions compatible. Apply only the scoped backend changes required for the current work. Use the fresh installer only on an empty application database.

Only public website files and the setup SQL download are served. Development tests, Git metadata and server-function source are omitted from the Pages artifact. `deployment-state.json` records the installed version/path and whether browser configuration was supplied.

Each run publishes the complete Pages snapshot: currently a small root landing page plus the configured installation directory. Add any other site sections deliberately to the build process before expecting them to persist between deployments.

## Full verification before hosting

The deployment builder checks the selected public tag’s exact commit against `rsvp-security-smoke.yml` before downloading the archive or producing a Pages artifact. All three full jobs must have completed successfully. Lightweight checks, skipped jobs, another commit or an unavailable API do not pass. If blocked, run the full workflow in the release repository for that commit and retry after it passes. The private build repository’s status cannot replace verification of the independent public history.

The Pages artifact records the accepted public CI commit and run URL in deployment-state.json and the Actions summary. Routine local VM previews use focused checks and do not call this hosted-release gate. Updating deployment tooling does not itself deploy a site or publish an event.

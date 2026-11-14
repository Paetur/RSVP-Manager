# RSVP Pages deployment

Copy this directory's contents into your website repository, such as `<owner>.github.io`. The repository contains deployment instructions; application files come from a selected published RSVP-Manager release.

1. Enable GitHub Pages with **Source: GitHub Actions** in repository Settings → Pages.
2. Review `deployment.json`: select the release repository and installation path, normally `marriage`.
3. For an unconfigured setup site, leave repository variables empty. When your separate Supabase project is ready, set **Settings → Secrets and variables → Actions → Variables**: `RSVP_SUPABASE_URL` and `RSVP_PUBLISHABLE_KEY`. Supply both together. These are public browser settings; server/service keys stay in Supabase.
4. Open **Actions → Deploy RSVP → Run workflow**, enter a published tag such as `v0.9.0-alpha.2`, and run it. The workflow downloads the release automatically, verifies the ZIP and file checksums, injects public connection settings and publishes the Pages artifact.
5. Open `https://<owner>.github.io/marriage/setup.html` to finish installation. Setup may save a connection locally in that browser; deploy the public variables above so other visitors use the same backend.

For this example set Edge secrets `RSVP_SITE_ORIGIN=https://<owner>.github.io` and `RSVP_SITE_URL=https://<owner>.github.io/marriage/`. Configure Supabase Auth's Site URL to the full installation URL, with `https://<owner>.github.io/marriage/admin/?admin-invitation=1` allowed as an administrator invitation redirect. Deploy both Edge Functions from the same selected release.

The workflow supports an explicit version change without manual ZIP downloads. It does not create or migrate a backend, restore data or publish an event. Each fresh backend starts unpublished; event publication is a separate administrator action. Website and backend versions must remain compatible when upgrading.

Only public website files and the setup SQL download are served. Development tests, Git metadata and server-function source are omitted from the Pages artifact. `deployment-state.json` records the installed version/path and whether browser configuration was supplied.

Each run publishes the complete Pages snapshot: currently a small root landing page plus the configured installation directory. Add any other site sections deliberately to the build process before expecting them to persist between deployments.

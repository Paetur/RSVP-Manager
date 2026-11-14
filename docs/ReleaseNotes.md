# Release notes

## 0.9.0-alpha.4

This alpha adds the Languages redesign, encrypted backups and an experimental trusted automatic cloud-setup companion. New events remain unpublished. Existing installations and their data are not changed by downloading or publishing this release.

- Languages uses expandable venue/session/food record cards, a compact search icon and consistent header pencils. Language columns adapt to phone and desktop screens; independent unsaved drafts survive another record’s save.
- Compact administrator statistics retain household/guest, RSVP/session and food-interest counts. Food hides zero sub-category counts.
- Contextual {…} help lists and inserts only a field’s supported placeholders in invitation templates, Food Interest Reply and shared phrases. Food reply date offsets use the RSVP deadline and event timezone.
- Guest Food Explanation and custom Food Interest Reply live under Languages → Guests. Invites supports Yes/No/Unanswered food-interest filtering independently of food commitments.
- Optional password-encrypted JSON/gzip backups use AES-256-GCM with Argon2id; matching decryption retains existing preview/restore safeguards. Encryption requires HTTPS or localhost, Web Crypto and Workers. Password loss cannot be recovered by the application.
- The loopback-only automatic setup companion runs on the trusted operator computer, keeping privileged credentials out of static hosting. It handles seven setup steps, compatible partial retries, administrator creation, functions/secrets/public configuration and initialized-installation checks. The manual Local/Cloud setup path remains available.
- The setup wizard puts backend prerequisites before connection testing and distinguishes GitHub Actions public variables from direct config.js publication.
- Private release and hosted-deployment tooling require full verification. Private project instructions and handover files are excluded from public packages.

The fresh baseline includes protected setup progress and the minimal setup-completion RPC. The inner application backup remains format 2/schema 20261114034908 with its current 40-table manifest; encrypted v1 is an optional outer transport envelope. The fresh installer must not be replayed over an existing event. This alpha provides no old-schema/export upgrade adapter.

Automatic cloud setup has synthetic/disposable service and browser acceptance; real empty-cloud-project acceptance remains pending. Physical-device/accessibility, real email delivery, the full disposable published guest journey and administrator password recovery remain separate work. Treat this as an experimental prerelease, with manual setup available for independent testing.

## 0.9.0-alpha.3

This alpha is intended for fresh installations and setup testing. New events remain unpublished.

- One current database baseline and an atomic SQL installer, with matching hash metadata. The installer refuses an existing application schema.
- A Local/Cloud choice in the setup wizard, with separate local Studio and cloud instructions.
- Explicit cloud options: Data API ON, automatic table exposure OFF, automatic RLS ON; public exposed and app_private unexposed.
- Complete, version-matched Studio files for guest-gateway and admin-invitations, with browser Copy controls and checksum verification.
- GitHub Actions configuration instructions using public repository variables; direct static hosting can use the downloaded config.js.
- Working installer/guide downloads in local publishing, preservation of installation configuration, and clearer phone step navigation.
- Setup/security regression fixtures updated for the current controls and formatted HTML.

Application backup format 2/schema 20261114034908 is the current contract. This alpha does not upgrade an existing schema or accept old backup formats. The installer and functions contain no event data, background photo, credentials or installation-specific connection settings.

At the alpha.3 release, administrator password recovery, optional backup encryption and additional food-interest reporting/messages remained planned. Physical-device, accessibility, email and complete published-journey acceptance remain separate checks.

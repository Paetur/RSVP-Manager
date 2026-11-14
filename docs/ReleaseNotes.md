# Release notes

## 0.9.0-alpha.5

This alpha adds optional private invitation pictures and native-share fallbacks for testing on real devices. Existing events must remain unpublished until their organizer explicitly publishes them.

- Settings → Templates and delivery drafts support an optional JPEG picture, prepared without embedded metadata and limited to 2400px / 1.4 MB.
- New Manual / Messenger templates supply defaults for Manual delivery drafts. The operator chooses the app and recipient in the native share sheet.
- Each saved draft and Sent snapshot retains its own picture; later template changes do not rewrite history.
- Template-only Test sharing works while unpublished with example names/link and no delivery records.
- Picture sharing offers Share picture and text, Share picture, and Copy message. The caption retains the invitation link. Apple/receiving-app support varies; the separate actions provide a fallback. A handoff never records Sent automatically.
- Translation-card record search now belongs to its existing presentation component and receives current content for every search.

The fresh installer and current backup column contract include nullable invitation-picture fields. Do not replay the installer on a populated installation. Existing installations need a scoped, backed-up backend update before using this frontend. The 40-table manifest and format 2/schema 20261114034908 identifiers remain; take a fresh application backup after updating.

Synthetic browser/disposable database coverage does not establish real iPhone/iPad WhatsApp or Messenger acceptance. Automatic cloud setup remains experimental; administrator password recovery and the other launch-acceptance tasks remain separate work.

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

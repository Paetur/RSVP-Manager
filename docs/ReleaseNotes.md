# Release notes

## 0.9.0-alpha.9

This alpha consolidates invitation preparation and manual sending in **Main → Invites**. Publishing the website or upgrading an installation does not publish its event.

- Invites combines household/guest, RSVP, Food and invitation-status summaries with clickable filters, the optional Shortcuts workspace and the household list. The former Overview tab is removed. The compact **Action** box generates drafts for **All missing** or **Selected** households and manually marks up to ten selected households Sent after the organizer sends their invitations.
- The **Service** chip copies the current recipient number/email. **Draft** and **Ready** copy the latest valid published invitation and current RSVP link. Pictured invitations try combined picture-and-text clipboard formats, with a separate **Text** fallback. Check the picture, full caption and link after pasting; receiving-app support varies. Copying does not open a messaging app or record sending.
- **Rows 1 / 2** switches between individual detail columns and paired lines. Household, Service and Invitation stay visible. **Settings → Interface → Invites appearance** saves separate defaults for each layout and grouping by None, Relational group or Service. Search uses compact icons, grouped households have outline boxes, and copy targets follow their visible chips.
- Templates have multi-choice service, content and language tags, a separate Picture album and per-template editing/test-sharing controls. Bulk generation requires exactly one service/language match, checks the template revision and preserves existing drafts. Messages and SMS are distinct template services. Review language tags on existing templates before generating missing drafts.
- Local installations with the optional HTTP/SSL companion expose listener/certificate controls and an HTTP-to-HTTPS redirect. Static hosted installations continue to use their host's HTTPS configuration.
- Experimental Apple Shortcuts remains off by default. Updated authoring/recovery guides retain separate native/browser journals and preserve earlier results. Synthetic dry-run verification does not establish complete native, iPhone/iPad or live WhatsApp acceptance.

Existing alpha.8 installations follow the [scoped alpha.9 upgrade guide](UpgradeAlpha9.md). The upgrade preserves existing event records, template wording/pictures, access and configuration; existing templates appear untagged and require review. Backup format 2/schema `20261114034908` and the 43-table count stay the same, while the template column contract expands. Keep the event unpublished, retain the earlier backup for alpha.8 recovery, and take a fresh alpha.9 Full backup for alpha.9 restore testing after upgrading. Use the fresh installer only for an empty application schema.

Real-device picture/caption/link paste, administrator email delivery, accessibility, the complete published guest journey and final content/privacy acceptance remain separate checks.

## 0.9.0-alpha.8

- **Overview → Manage Invites** prepares missing drafts from named templates and filters households by service and delivery status. Review up to ten selected households before handing their invitations to your device's sharing options.
- Restore and wipe use Yes/No confirmation. In Wipe restore, a safety backup download validates the selected file and unlocks **Wipe and restore**. A successful restore or wipe with the current administrator returns to Overview. Wipe all opens setup if the administrator is removed.
- The setup wizard offers first-administrator SQL in step 3. The release also adds administrator password recovery and refines the language editors and compact settings cards.
- Experimental Apple Shortcuts support is off by default. Physical iPhone and WhatsApp acceptance is pending.

Existing alpha.7 installations follow the [scoped upgrade guide](UpgradeAlpha8.md). The current Full application backup covers 43 tables. Export a fresh Full backup after upgrading.

## 0.9.0-alpha.6

This alpha refines the administrator header and template-only sharing without publishing an event.

- Desktop shows the installed release version beneath the signed-in email, fetched from deployment metadata without delaying sign-in. The label hides if metadata is unavailable.
- Phone headers keep navigation and Sign out on one line with 44px controls. Reload, theme, guest-preview shortcuts and the version label are hidden on phones; desktop controls remain.
- Test sharing is a themed outlined template-header action beside the pencil. Saved templates and open drafts can both be tested, including Settings view-only accounts.
- Test sharing substitutes example names and the installation's landing-preview link (`#guest-preview=landing`), with subdirectory support. Preview sign-in/permission checks remain; no household code, delivery record or Sent confirmation is created.
- Synthetic browser fixtures retain real reload/permission checks when a phone shortcut is hidden, and explicitly test the desktop theme shortcut at desktop width.

Only additive private translation-registry entries are needed on an existing alpha.5 backend. No application table or data migration is required. Do not replay the fresh installer on a populated database. The fresh installer, EN/DE/FO catalogs and generated assets remain synchronized.

Real iPhone/iPad WhatsApp and Messenger picture/caption/link acceptance remains separate from synthetic coverage. Automatic setup remains experimental; password recovery and other launch-acceptance tasks remain open.

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

# Upgrade an alpha.6 installation to alpha.7

Alpha.7 includes inline editors/confirmations, template-based delivery, scrolling navigation and Overview, scoped placeholders, shared household names and guest-interface preferences, record timestamps and guarded same-installation replacement restore.

For a new empty database, use the complete current installer. For an existing alpha.6 installation, **do not replay install.sql**.

1. Keep the event unpublished. Protect an alpha.6 application backup, Auth/infrastructure recovery material and hosting/runtime configuration separately.
2. Review and run [alpha6-to-alpha7.sql](../supabase/upgrades/alpha6-to-alpha7.sql) once with the database owner. It adds current fields/functions and private rollback metadata, checks exact preservation of existing event rows, photos, administrator/Auth records and privileges, and rolls back on error. Existing historical venue/session dates remain unknown. The script refuses an already-upgraded or published event.
3. Deploy the matching alpha.7 website. Preserve the installation path, public connection variables, Auth redirects and server secrets. The website deployment workflow verifies the selected public release's full CI before publishing assets; it does not execute SQL or publish an event.
4. Sign in and check households, venues/sessions, translations, pictures and permissions. Household name and surname remain separate stored fields; display labels combine them without repeating an already-present surname. No stored names or wording are rewritten.
5. Download a **fresh Full backup after upgrading**. Alpha.7 uses the current fields and canonical field-name-ordered manifests. Older schema exports are not adapted automatically. Replace event data additionally requires a backup from this installation, full administrator access, an unpublished event, validated preview, fresh safety download and typed confirmation.

The current RSVP deadline token is `{rsvp_deadline}`, including calendar offsets such as `{rsvp_deadline:+5}`. Existing `{invite-deadline}` wording is left unchanged and has no alias; review and update saved wording separately. Missing values stay visible in draft previews and block Ready/sharing.

OS share/file/print interfaces remain native. Browser/viewport checks do not replace physical iPhone/app acceptance. Automatic cloud setup remains experimental pending real empty-cloud acceptance.

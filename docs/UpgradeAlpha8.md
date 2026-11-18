# Upgrade an existing alpha.7 installation to alpha.8

Use this procedure to update an existing alpha.7 installation. Keep the event unpublished during the upgrade. Use the bundled fresh installer for empty databases.

1. Download a Full backup and keep separate protected copies of the PostgreSQL database, Supabase Auth, Edge Function settings and website configuration.
2. Review and rehearse the scoped SQL upgrade on a disposable alpha.7 database. Run it with the database owner on the destination after checking the backup. The upgrade checks the source schema and verifies that it preserves existing event data, private photos and access. Existing invitation templates are grouped into named templates by their original delivery service. Each language version retains its wording and image.
3. Update guest-gateway from the matching alpha.8 Studio bundle. If you use experimental Apple Shortcuts, deploy invitation-shortcuts from the same release with platform **Verify JWT** off. Keep your existing Auth redirects, site settings and connection values. [Studio guide](StudioSetup.md)
4. Deploy the matching alpha.8 website to the existing installation path and verify its configuration. Open the admin site and check households, invitations, languages and pictures. Keep the event unpublished while verifying the upgrade.
5. Download a fresh Full backup after upgrading. Alpha.8 uses the current 43-table application backup contract. Use the new backup for restore testing. [Database and backups](Backups.md)

[Scoped alpha.7 to alpha.8 SQL](../supabase/upgrades/alpha7-to-alpha8.sql)

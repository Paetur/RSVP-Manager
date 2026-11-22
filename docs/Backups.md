# Backups

Application backups are private downloads and may contain names, contacts, invitation codes, replies, commitments and the invitation background photo.

Open **Settings → Database**. **Backup** contains the export options, **Restore** imports a backup file, and **Wipe** contains **Wipe all**. Switching tabs or resizing preserves your selections and file options. Validation and confirmation are required before restoring.

## Full and Partial modes

Choose **Full** or **Partial** when you export a backup. When you open a restore file, the app detects its type, shows the sections available for that destination, and disables incompatible destinations. Choose one **Restore destination** using the checkmarks.

The primary button starts at **Validate backup**. After successful validation, it changes to **Download safety backup** for destinations that replace existing data. The final action appears in the same place after the safety download. **Clean database** goes directly from validation to **Restore backup**.

| Operation | Activity logs |
|---|---|
| Full backup | Optional |
| Partial backup | Excluded |
| Full restore to a clean database | Optional, when present in the file |
| Replace or wipe and restore | Uses the Full file’s log selection |
| Partial restore | Excluded |

**Full backup** keeps all sections, current replies, immutable RSVP submissions/comments, food commitments, confirmation state and manually confirmed Sent invitations. **Full restore accepts Full backup files only.** It restores everything available in that file. A file exported without logs cannot supply them later.

**Partial backup/restore** retains selected planning sections and resets invitation codes, replies and food commitments. Food starts at Collect interest. Only explicitly selected drafts carry over from invitation delivery. Activity logs are always excluded. A Full restore requires a Full backup file.

Partial export shows **Venues & sessions**, **Households & guests**, **Food**, **Other**, **Language/Text data**, and **Invitation templates**. Under Invitation templates, **Picture album** and **Drafts** have separate checkboxes. The album checkbox includes the picture library. Images needed by selected templates and drafts travel with those records. Event settings and the configured languages and guest appearance are always included. Full export includes every available section.

Select **Households & guests** to enable **Drafts**. Drafts are optional and return to **Review**. They retain their saved wording and pictures. After publication, **Make invitation(s)** prepares them with the current invitation links.

**Issued-code reservations** is off by default for Partial export. Enable it to include the record of codes already issued, including codes retired from use. A clean Partial restore can carry over those reservations without enabling any past invitation link. A planning restart uses the destination’s reservations. Full backups always include issued-code reservations.

A food planning section without venues leaves venue-specific items unavailable until assigned again. Category/sub-category structure and Food Group membership are retained. Partial backups do not retain administrator-added food commitments.

## What the log option covers

When exporting a Full backup or restoring one to a clean database, **Include sections → Include activity logs** controls whether to include existing administration, configuration, access, delivery-change and RSVP-change logs, old restore history and administrator invitation/reference history. On restore, the checkbox appears when the file includes activity logs. Logs can contain personal details. Current replies/submissions, food commitments and Sent records remain in a Full backup even when logs are excluded.

Without logs means old activity history is omitted. Every completed restore still records a **new restore audit entry**; this safeguard is always enabled. No imported snapshot-history feature is used.

## Compressed files

Tick **Compression** under File options to download a smaller gzip file in either Full or Partial mode. Leave it unticked for JSON. Restore accepts either file and opens gzip automatically; the backup contents, checksum and validation rules are unchanged. Both the uploaded file and its opened contents must be at most 20 MB. Damaged or oversized compressed files are rejected before validation or restore.

Compression alone does not encrypt the file. Select **Encryption** separately to protect it with a password. If your browser does not support gzip, the compression option is disabled; use JSON instead.

## Optional encryption

Select **Encryption**, enter a password and confirm it. Compression and encryption are independent; gzip is applied first. Encrypted files download as `.encrypted.json`. Keep the password separately: the file cannot be recovered without it.

Encrypted imports are detected automatically and request that file’s password. Incorrect passwords or damaged files stop before database validation; use Open encrypted backup to retry. Unencrypted JSON/gzip continues unchanged. Decryption does not bypass Validate backup or restore confirmation.

Encryption requires HTTPS or localhost, Web Crypto and Web Workers. See [encrypted backup details and development testing](BackupEncryption.md). Passwords are not saved in settings or browser storage and are not sent to the server for encryption.

## Clean-database recovery restore

Choose **Clean database** for the original recovery workflow. It requires an **empty, unpublished destination**.

1. Prepare the destination with the current application baseline and a verified administrator.
2. Open the file and choose **Clean database**. The detected type determines whether the app restores Full event data or uses the Partial planning sections.
3. Choose from the included sections for a Partial file or the activity-log option for a Full file that contains logs. Changing the file, destination or any section choice clears prior validation and confirmation.
4. Select **Validate backup**. The server rehearses the restore and rolls it back. Full restore may require matching verified historical actor accounts wherever retained records reference them. Resolve reported problems before proceeding.
5. Review the result and select **Restore backup**. Choose **Yes** to proceed or **No** to return to the review.
6. The application returns to **Home → Main** after a successful restore. Check representative households, replies/comments, food, translations, assignments and any included logs.

The restored event stays **unpublished**. Review administrator access separately: included historical administrator references return disabled with View only permissions; source access rights are not automatically granted.

Store protected copies away from the planning device and agree retention and recovery ownership.

## Replace event data on this installation

Use this separate destination to return an existing unpublished event to an earlier backup before a test. It requires a full administrator and a complete current-schema Full backup downloaded from the same installation. Partial files and other installations are rejected.

1. Install matching code/schema, then take a fresh Full backup before testing. Protect it and its encryption password.
2. Select **Replace event data**, open that backup and validate. Review current versus restored record counts and the preserved security boundary.
3. Download the fresh safety backup offered by the page. It captures the state being replaced and uses your selected compression/encryption options.
4. Select **Replace event data** and choose **Yes** to proceed or **No** to return to the review. If data changes or the 30-minute confirmation expires, validate again and download a new safety backup.
5. After replacement, **Home → Main** opens. Review representative invitations, replies, food, wording and pictures. The event remains unpublished.

Event settings, private pictures, household invitation codes, replies, food commitments and delivery records return to the backup state. Current Auth accounts/passwords, administrator access/sessions, pending administrator invitations and security/restore audit history remain; a new restore audit is appended. Failed validation or replacement rolls back atomically. This cannot undo messages already sent or changes to Auth, hosting or runtime configuration.

## Restart planning from backup

Use **Restart planning from backup** to refill an existing unpublished installation from a **Partial** backup. A Full administrator must run the restart.

1. Choose the restore destination **Restart planning from backup**, open the Partial backup, and select **Validate backup**. Review the sections carried over, the sections that will be cleared and the before-and-after counts.
2. Select **Download safety backup** to save a fresh Full backup of this installation. Store it privately. If the destination changes or 30 minutes pass, validate and download a fresh copy.
3. Select **Restart planning from backup** and confirm. The event remains unpublished and food starts at Collect interest. Drafts, including drafts selected in the Partial file, delivery history, active invitation codes, replies and food commitments are cleared.
4. If you need to undo the restart, open the downloaded Full safety backup on the same unpublished installation and use **Replace event data**.

The current installation keeps its administrator access, website address, runtime configuration and existing invitation-code reservations. The source registry stays out of the import. When you publish, eligible households receive new invitation codes.

## Current format and infrastructure recovery

Current exports use application backup **format 3**, schema **20261114034908**, with a 44-table manifest. Full files store each referenced picture and template revision once. Partial files read the selected sections and include the shared snapshots those sections need. Column manifests use a stable field-name order. Beta.3 exports use format 2 and need a matching beta.3 recovery installation. Download a fresh Full backup after updating. Language CSV exports are separate.

Passwords, Auth sessions, personal administrator Interface preferences, secret keys, email-service settings, rate-limit counters and hosting configuration require separate infrastructure recovery. App sign-in references, if included, are historical information rather than active sessions. Raw Auth-service audit records are not application-backup data. Keep the repository/deployment configuration with the installation owner and rehearse restoration.

[All user guides](README.md)

## Wipe and restore application data

Choose **Wipe and restore** under **Restore destination** to import a complete Full backup into an existing unpublished installation, including one exported by another installation. Both installations must have the same current schema and exact backup fields. Wipe uses the whole file and its log selection.

1. Open the Full backup and select **Validate backup**. Review the record counts.
2. Select **Download safety backup** and store it privately.
3. Select **Wipe and restore**. Choose **Yes** to proceed or **No** to return to the review. If data or administrator access changes, or the 30-minute receipt expires, validate and download a fresh safety backup.
4. Review the imported event from **Home → Main**. It stays unpublished.

Wipe replaces application data and cancels imported pending administrator invitations. It keeps the signed-in administrator's access, Auth account and personal preferences, destination website address and runtime/connection configuration. Other administrator accounts are suspended and their application sessions revoked; their Auth accounts/passwords are not deleted. Historical actors are matched by verified email. If no verified destination account matches, the importing administrator is used for the foreign key; original identities and per-record attribution are retained in the new restore audit. The destination installation ID remains unchanged.

Wipe cannot undo messages sent from another app. A database/Auth/runtime backup remains the way to recover infrastructure and account state; an application safety backup does not replace it.

## Wipe all without importing a backup

**Settings → Database → Wipe → Wipe all** clears application data. It requires a Full administrator and an unpublished event. To import a Full backup while clearing the installation, use **Wipe and restore** on the **Restore** tab.

1. Review the current counts and choose whether to retain your current administrator.
2. Download the required fresh safety backup. The download uses the selected backup compression and encryption options. Keep the file and any password privately.
3. Select **Wipe all**, then choose **Yes** to proceed or **No** to return to the review. A changed destination, expired preparation or uncertain response requires a new review; the page does not retry automatically.

This clears event content, private pictures, household links, replies, food commitments, delivery history and application administrator access. With **Retain current administrator** checked, only your current application administrator remains and **Home → Main** opens. With it unchecked, the application signs you out and opens the first-administrator setup wizard. Supabase Auth accounts and passwords are retained in either case. Connection configuration, the database schema and installation identity remain. Retired invitation codes and session revocations remain protected against reuse.

The empty event is unpublished. All Shortcuts capabilities are revoked and the experimental feature is disabled. An application safety backup does not restore Auth passwords or infrastructure configuration; follow the installation owner's recovery procedure.

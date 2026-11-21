# RSVP Manager

A private invitation and event-planning app for keeping guests, replies, venues, food and practical arrangements together. Designed for use on an iPad as well as a desktop browser.

Guests use their own invitation link. Organizers sign in to manage the event, with access that can be tailored to each administrator.

## Screenshots

A fictional event in Dark mode, shown at iPad landscape size.

### Invites

![Invites in Dark mode on iPad, with filters and a grouped household delivery list](docs/images/ipad-invites.png)

### Templates

![An expanded invitation template with service, language tags, message placeholders and a sample picture](docs/images/ipad-templates.png)

## What you can do

- Organize households and individual guests in a nested list.
- Invite different households or guests to different sessions and venues.
- Review and confirm individual replies, then keep the confirmed list visible.
- Collect food interest before opening category-based choices; Food Groups reserve every included item together without exceeding capacity.
- Open shared read-only recipe dialogs with Print and Close, including printable PDFs.
- Track practical jobs and things to bring in Other.
- Generate invitation drafts from service/language-matched templates in Invites. Copy recipients and invitations for manual sending, then mark up to ten selected households Sent.
- Manage event wording in multiple languages.
- Give administrators Full, View only or Custom access.
- Download JSON/gzip backups, optionally protect them with password-based encryption, and rehearse recovery separately.

## Downloads and installation

This source targets the **0.9.0-beta.1** candidate. For a published installation package and checksums, use the [0.9.0-alpha.9 release](https://github.com/Paetur/RSVP-Manager/releases/tag/v0.9.0-alpha.9). [Installation instructions](INSTALL.md) describe the website, Supabase and administrator setup. Each installation starts unconfigured and has its own data.

Use the current installer for a fresh database. The candidate uses the alpha.9 schema and backup contract. Follow the [existing-installation instructions](INSTALL.md#existing-installations) to verify your setup.

For a new cloud project, the [trusted automatic setup companion](docs/AutomaticSetup.md) can perform first-time setup from your own computer. The manual wizard and Studio guides remain available. Encryption usage and requirements are in [Backup encryption](docs/BackupEncryption.md).

Use the [GitHub Pages deployment template](deployment/README.md) to publish a selected release under a path such as `/marriage/`, without downloading ZIP files manually. The workflow does not create a backend or publish your event.

## Start here

**Guests:** use the private link provided by your organizer. See [Replying to an invitation](docs/Guests.md).

**Organizers:** open your installation’s administrator page and sign in. See [Getting started](docs/GettingStarted.md).

**Using your own installation:** open `setup.html` in your installation for the database, administrator and hosting steps. The guides below explain everyday use once that setup is ready.

## User guides

| I want to… | Guide |
|---|---|
| Find my way around and understand View/Edit | [Getting started](docs/GettingStarted.md) |
| Manage people, invitations and replies | [Households and invitations](docs/HouseholdsAndInvites.md) |
| Arrange food, quantities and recipes | [Food and recipes](docs/FoodAndRecipes.md) |
| Track practical jobs and things to bring | [Other](docs/Other.md) |
| Translate event content and change my interface language | [Languages](docs/Languages.md) |
| Add administrators or adjust their access | [Administrators](docs/Administrators.md) |
| Keep a backup and understand restoration | [Backups](docs/Backups.md) |
| Find a quick answer | [Frequently asked questions](docs/FAQ.md) |

These guides are organized as individual pages so they can later form a wiki.

## Before inviting guests to respond

Review your venues, sessions, guest assignments, translations and contact details. Test a complete invitation and reply on the devices you intend to use. Keep the event unpublished until you are ready and have approved publication.

Use the Service chip to copy the recipient number/email and the Draft or Ready chip to copy a saved invitation. When it includes a picture, check the full caption/link after pasting and use Text as the fallback. Review and send in your messaging app, then return to mark the selected households Sent. Administrator invitation emails use a separate email invitation process.

Private invitation links and downloaded backups should be shared only with the people who need them.

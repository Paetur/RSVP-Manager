# Release notes

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

Administrator password recovery, optional backup encryption and additional food-interest reporting/messages remain planned. Physical-device, accessibility, email and complete published-journey acceptance remain separate checks.

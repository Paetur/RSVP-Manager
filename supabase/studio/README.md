# Paste-ready Studio functions

These generated TypeScript entrypoints combine the canonical shared helpers and handlers without changing their request/authentication checks. See [Studio setup](../../docs/StudioSetup.md).

- Paste all of `guest-gateway.ts` into `index.ts` for `guest-gateway`.
- Paste all of `admin-invitations.ts` into `index.ts` for `admin-invitations`.
- Save the required server-side site secrets first; set platform Verify JWT OFF for both functions, matching the release configuration.
- `manifest.json` records the version and SHA-256 hashes of each canonical source and generated file.

Run `node tools/build-studio-functions.cjs` from the project root after changing any input; CI uses `--check`. For earlier release packages without these files, obtain a release-matching copy from the installation maintainer. Never combine files from different releases.

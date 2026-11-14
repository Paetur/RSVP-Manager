# Stylesheet source

Edit the numbered CSS files here, then run:

```sh
node tools/build-css.cjs
node tools/build-css.cjs --check
```

Include both the source changes and generated `css/app.css` in the same commit. All pages continue to load that single generated stylesheet. No runtime imports or extra stylesheet requests are needed.

`manifest.json` records the cascade order. These are contiguous blocks from the existing stylesheet, not independent components: later theme, responsive and component rules can intentionally override earlier defaults. Keep their order and specificity when editing. The mixed Food/guest and shared-editor blocks preserve historical cross-component dependencies; their names do not imply that every selector is limited to that page.

| Source | Main responsibility |
|---|---|
| 01 | Tokens, shared elements, original page foundations |
| 02 | Administrator workspace and navigation |
| 03 | Theme and shared control refinements |
| 04 | Administrator lists, editors, access and languages |
| 05 | Food, guest attendance, private photo and maps; dedicated Food-interest base/selected/photo/reply component |
| 06 | Shared editor, layout and lifecycle refinements |
| 07 | Guest invitation customization and editor preview |
| 08 | Invites delivery overview |

The first split preserves the generated stylesheet byte for byte. Consolidate further only with targeted interaction and style comparisons; matching selector names alone do not prove a rule is redundant. The build uses only Node's standard library. CI checks the generated file so source and served CSS cannot drift silently.

Food-interest basics are consolidated in `05-food-interest.css`, immediately after the mixed guest/Food refinements. More-specific tile, light-theme and customized-design rules retain their cascade positions. Eleven ordered sources still generate one application stylesheet. The latest consolidation was checked with full computed styles, pseudo-elements and geometry across 108 viewport/theme/design/pointer/interaction combinations.

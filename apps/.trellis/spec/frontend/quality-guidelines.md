# Frontend Quality Guidelines

These are conventions observed in Kailo's current Web, Desktop, and Mobile platform surfaces. Product meaning remains authoritative in `.design`, not here.

## Shared platform presentation

- Web and Desktop consume the same TypeScript package at `web/packages/platform`. Platform text, relative-time thresholds, calendar exceptions, and English/Chinese plural selection live in `web/packages/platform/src/i18n.ts`.
- `tools/gen-platform-i18n.py` projects that source into `mobile/lib/shared/kailo/kailo_platform_text.dart`. Mobile's controlled Buzz tree receives the generated file through `upstream-patches/buzz-mobile/baseline.yaml` `vendor_files`; do not hand-edit the generated or vendored copy.
- Kailo management views use `relativeTime` in TypeScript or `kailoRelativeTime` in Dart for compact timestamps. Mobile evidence/detail rows use `kailoAbsoluteTime`. Invalid timestamps render the shared `platform.time.unavailable` message, not a raw parser error.
- Count wording uses `platformPluralForm` in TypeScript and generated `kailoPluralOne` in Dart. Calendar exceptions such as yesterday and tomorrow are independent of grammatical plural category.
- Both locales, past and future timestamps, unit boundaries, zero, invalid input, and plural forms have executable examples in `web/packages/platform/test/format.test.ts` and the controlled Mobile test `mobile/test/features/kailo/kailo_time_test.dart`.

## Change checks

After changing the shared catalog, run `python3 tools/gen-platform-i18n.py`, then `python3 tools/gen-platform-i18n.py --check`. Refresh the Mobile vendor files, export its controlled patch, and rebuild Web and Desktop artifacts: both ship bytes from the same package. Confirm the generator's `--check` fails when a generated translation is deliberately changed, then restore it.

The Buzz-native chat date formatters remain separate from these Kailo management-view helpers. Do not treat the platform helper checks as proof that all collaborative chat timestamps have converged across three clients.

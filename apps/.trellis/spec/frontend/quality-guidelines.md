# Frontend Quality Guidelines

These are conventions observed in Kailo's current Web, Desktop, and Mobile platform surfaces. Product meaning remains authoritative in `.design`, not here.

## Shared platform presentation

- Web and Desktop consume the same TypeScript package at `client-kit/ts/platform`. Platform text, relative-time thresholds, calendar exceptions, and English/Chinese plural selection live in `client-kit/ts/platform/src/i18n.ts`.
- `tools/gen-platform-i18n.py` projects that source into `client-kit/dart/lib/shared/platform/platform_text.dart`. The Mobile client in `collaboration/mobile` depends on the `client_kit` Dart package by Flutter `path:` dependency (ADR-16); do not hand-edit the generated file.
- Kailo management views use `relativeTime` in TypeScript or `kailoRelativeTime` in Dart for compact timestamps. Mobile evidence/detail rows use `kailoAbsoluteTime`. Invalid timestamps render the shared `platform.time.unavailable` message, not a raw parser error.
- Count wording uses `platformPluralForm` in TypeScript and generated `kailoPluralOne` in Dart. Calendar exceptions such as yesterday and tomorrow are independent of grammatical plural category.
- Both locales, past and future timestamps, unit boundaries, zero, invalid input, and plural forms have executable examples in `client-kit/ts/platform/test/format.test.ts` and the Mobile test `collaboration/mobile/test/features/platform/platform_time_test.dart`.

## Change checks

After changing the shared catalog, run `python3 tools/gen-platform-i18n.py`, then `python3 tools/gen-platform-i18n.py --check`. Rebuild the Web, Desktop and Mobile artifacts: all three reference `client-kit` by local path dependency and ship bytes from the same package. Confirm the generator's `--check` fails when a generated translation is deliberately changed, then restore it.

The Buzz-native chat date formatters remain separate from these Kailo management-view helpers. Do not treat the platform helper checks as proof that all collaborative chat timestamps have converged across three clients.

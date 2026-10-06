#!/usr/bin/env python3
"""Project the shared TypeScript platform catalog into Mobile's Dart surface."""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "client-kit/ts/platform/src/i18n.ts"
TS_ENUM = ROOT / "client-kit/ts/contracts/src/generated/contracts.ts"
DART_ENUM = ROOT / "client-kit/dart/lib/shared/contracts/generated/contracts.dart"
TARGET = ROOT / "client-kit/dart/lib/shared/platform/reason_text.dart"
PLATFORM_TARGET = ROOT / "client-kit/dart/lib/shared/platform/platform_text.dart"


def block(source: str, start: str, end: str) -> str:
    match = re.search(re.escape(start) + r"(.*?)" + re.escape(end), source, re.S)
    if match is None:
        raise ValueError(f"source block not found: {start}")
    return match.group(1)


def catalog() -> list[tuple[str, str, str]]:
    ts_enum = block(TS_ENUM.read_text(), "export enum ReasonCode {", "}\n")
    names = dict(re.findall(r'\b(\w+)\s*=\s*"([A-Z_]+)"\s*,', ts_enum))
    dart_enum = block(DART_ENUM.read_text(), "enum ReasonCode {", "}\n")
    dart_names = set(re.findall(r"\b([A-Z_]+)\s*,", dart_enum))
    if not names or set(names.values()) != dart_names:
        raise ValueError("TypeScript and Dart ReasonCode enums differ")

    body = block(
        SOURCE.read_text(),
        "export const reasonMessages = {",
        "} as const satisfies Record<ReasonCode, Message>;",
    )
    entry = re.compile(
        r'\[ReasonCode\.(\w+)\]:\s*\{\s*en:\s*("(?:\\.|[^"\\])*"),'
        r'\s*"zh-CN":\s*("(?:\\.|[^"\\])*"),?\s*\},',
        re.S,
    )
    found = entry.findall(body)
    if entry.sub("", body).strip() or len(found) != len(names):
        raise ValueError("reasonMessages contains an unrecognized or missing entry")
    messages = {name: (json.loads(en), json.loads(zh)) for name, en, zh in found}
    if set(messages) != set(names):
        raise ValueError("reasonMessages does not cover exactly the ReasonCode enum")
    return [(code, *messages[name]) for name, code in names.items()]


def message_catalog(source: str, start: str, end: str, key_pattern: str) -> list[tuple[str, str, str]]:
    body = block(source, start, end)
    entry = re.compile(
        key_pattern
        + r'\s*:\s*\{\s*en:\s*("(?:\\.|[^"\\])*"),'
        + r'\s*"zh-CN":\s*("(?:\\.|[^"\\])*"),?\s*\},',
        re.S,
    )
    found = entry.findall(body)
    if not found or entry.sub("", body).strip():
        raise ValueError(f"unrecognized or missing message in {start}")
    rows = [(name, json.loads(en), json.loads(zh)) for name, en, zh in found]
    if len({name for name, _, _ in rows}) != len(rows):
        raise ValueError(f"duplicate message key in {start}")
    for name, en, zh in rows:
        if set(re.findall(r"\{(\w+)\}", en)) != set(re.findall(r"\{(\w+)\}", zh)):
            raise ValueError(f"en and zh-CN placeholders differ for {name}")
    return rows


def platform_catalog() -> tuple[list[tuple[str, str, str]], dict[str, list[tuple[str, str, str]]]]:
    source = SOURCE.read_text()
    messages = message_catalog(
        source,
        "export const platformMessages = {",
        "} as const;",
        r'"([^"\\]+)"',
    )
    enum_groups = {
        "ApprovalStatus": "approvalStatusMessages",
        "TenantInvitationStatus": "invitationStatusMessages",
        "TenantMembershipState": "tenantMembershipStateMessages",
        "WorkspaceMembershipState": "workspaceMembershipStateMessages",
        "BuzzIdentityState": "buzzIdentityStateMessages",
        "AuditEventType": "auditEventTypeMessages",
        "ApprovalDecision": "approvalDecisionMessages",
        "ApprovalSelector": "approvalSelectorMessages",
    }
    groups = {}
    for enum, variable in enum_groups.items():
        rows = message_catalog(
            source,
            f"export const {variable} = {{",
            f"}} as const satisfies Record<{enum}, Message>;",
            rf"\[{enum}\.(\w+)\]",
        )
        ts_enum = block(TS_ENUM.read_text(), f"export enum {enum} {{", "}\n")
        ts_values = dict(re.findall(r'\b(\w+)\s*=\s*"([A-Z_]+)"\s*,', ts_enum))
        dart_enum = block(DART_ENUM.read_text(), f"enum {enum} {{", "}\n")
        dart_names = set(re.findall(r"\b([A-Z_]+)\b", dart_enum))
        if {name for name, _, _ in rows} != set(ts_values) or set(ts_values.values()) != dart_names:
            raise ValueError(f"{variable} does not cover both {enum} enums")
        groups[enum] = [(ts_values[name], en, zh) for name, en, zh in rows]
    return messages, groups


def presentation_rules(
    messages: list[tuple[str, str, str]],
) -> tuple[dict[str, int], list[str], list[str], int]:
    source = SOURCE.read_text()
    seconds_body = block(source, "export const platformTimeSeconds = {", "} as const;")
    seconds_entries = re.findall(r"\b(minute|hour|day|month):\s*(\d+),", seconds_body)
    seconds = {unit: int(value) for unit, value in seconds_entries}
    if len(seconds_entries) != 4 or set(seconds) != {"minute", "hour", "day", "month"}:
        raise ValueError("platformTimeSeconds must define four distinct units")
    if not (0 < seconds["minute"] < seconds["hour"] < seconds["day"] < seconds["month"]):
        raise ValueError("platformTimeSeconds must increase by unit")

    plural_match = re.search(r"export const platformPluralOneLocales = (\[[^;]+\]) as const;", source)
    if plural_match is None:
        raise ValueError("platformPluralOneLocales not found")
    plural_locales = json.loads(plural_match.group(1))
    if plural_locales != ["en"]:
        raise ValueError("platformPluralOneLocales must match the supported English/Chinese rules")

    special_match = re.search(r"export const platformSpecialRelativeUnits = (\[[^;]+\]) as const;", source)
    if special_match is None:
        raise ValueError("platformSpecialRelativeUnits not found")
    special_units = json.loads(special_match.group(1))
    if len(special_units) != len(set(special_units)) or not set(special_units) <= {"day", "month"}:
        raise ValueError("platformSpecialRelativeUnits must contain distinct calendar units")

    keys = {key for key, _, _ in messages}
    required = {"platform.time.unavailable", "platform.time.now", "platform.time.absolute"}
    required.update(
        f"platform.time.{direction}.{unit}.{form}"
        for direction in ("past", "future")
        for unit in ("second", "minute", "hour", "day", "month")
        for form in ("one", "other")
    )
    if not required <= keys:
        raise ValueError(f"platform relative-time messages missing: {sorted(required - keys)}")
    weekday_match = re.search(r"export const platformCalendarWeekdayBandDays = (\d+) as const;", source)
    if weekday_match is None:
        raise ValueError("platformCalendarWeekdayBandDays not found")
    weekday_band_days = int(weekday_match.group(1))
    if weekday_band_days < 2:
        raise ValueError("platformCalendarWeekdayBandDays must be at least two days")
    chat_required = {
        "chat.time.today", "chat.time.yesterday", "chat.time.justNow",
        "chat.time.at", "chat.time.weekdayDate", "chat.time.on", "chat.time.lastReply",
    }
    if not chat_required <= keys:
        raise ValueError(f"chat time messages missing: {sorted(chat_required - keys)}")
    return seconds, plural_locales, special_units, weekday_band_days


def theme_modes(messages: list[tuple[str, str, str]]) -> dict[str, str]:
    source = SOURCE.read_text()
    match = re.search(
        r"export const platformThemeModeKeys = (\{.*?\}) as const satisfies", source, re.S
    )
    if match is None:
        raise ValueError("platformThemeModeKeys not found")
    modes = json.loads(match.group(1))
    if list(modes) != ["light", "dark", "system"]:
        raise ValueError("platformThemeModeKeys must be exactly light, dark, system (DD-53)")
    keys = {key for key, _, _ in messages}
    missing = sorted(set(modes.values()) - keys)
    if missing:
        raise ValueError(f"theme mode messages missing: {missing}")
    return modes


def dart_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$")
    return "'" + escaped.replace("\n", "\\n") + "'"


def render(rows: list[tuple[str, str, str]]) -> str:
    lines = [
        "// Generated from client-kit/ts/platform/src/i18n.ts by tools/gen-platform-i18n.py.",
        "// Do not edit this file. The ReasonCode enum comes from contracts/.",
        "import 'platform_text.dart' show platformLocale;",
        "",
        "import '../contracts/contracts.dart';",
        "",
        "String platformReasonText(ReasonCode reason, {String? locale}) {",
        "  final language = platformLocale(locale: locale);",
        "  if (language.startsWith('zh')) {",
        "    return switch (reason) {",
    ]
    lines.extend(f"      ReasonCode.{code} => {dart_string(zh)}," for code, _, zh in rows)
    lines.extend(["    };", "  }", "  return switch (reason) {"])
    lines.extend(f"    ReasonCode.{code} => {dart_string(en)}," for code, en, _ in rows)
    lines.extend(
        [
            "  };",
            "}",
            "",
            "String platformReasonCode(ReasonCode reason) => reasonCodeValues.reverse[reason]!;",
            "",
        ]
    )
    return "\n".join(lines)


def dart_key(key: str) -> str:
    parts = re.split(r"[.-]", key)
    if not parts or not all(re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", p) for p in parts):
        raise ValueError(f"unsupported platform message key: {key}")
    return parts[0] + "".join(p[0].upper() + p[1:] for p in parts[1:])


def render_platform(
    messages: list[tuple[str, str, str]],
    groups: dict[str, list[tuple[str, str, str]]],
) -> str:
    seconds, plural_locales, special_units, weekday_band_days = presentation_rules(messages)
    keys = [dart_key(key) for key, _, _ in messages]
    if len(set(keys)) != len(keys):
        raise ValueError("platform message keys collide after Dart conversion")
    lines = [
        "// Generated from client-kit/ts/platform/src/i18n.ts by tools/gen-platform-i18n.py.",
        "// Do not edit. Message keys and translations have one TypeScript source.",
        "",
        "import '../contracts/contracts.dart';",
        "",
        "enum PlatformMessageKey {",
    ]
    lines.extend(f"  {key}," for key in keys)
    lines.extend(["}", "", "const _messages = <PlatformMessageKey, (String, String)>{"])
    lines.extend(
        f"  PlatformMessageKey.{dart_key(key)}: ({dart_string(en)}, {dart_string(zh)}),"
        for key, en, zh in messages
    )
    lines.extend(
        [
            "};",
            "",
            "String platformText(PlatformMessageKey key, {String? locale, Map<String, Object>? variables}) {",
            "  final language = platformLocale(locale: locale);",
            "  final pair = _messages[key]!;",
            "  final template = language.startsWith('zh') ? pair.$2 : pair.$1;",
            "  return template.replaceAllMapped(RegExp(r'\\{(\\w+)\\}'),",
            "      (match) => variables?[match.group(1)]?.toString() ?? '');",
            "}",
            "",
        ]
    )
    for enum, rows in groups.items():
        lines.extend(
            [
                f"String platform{enum}Text({enum} value, {{String? locale}}) {{",
                "  final language = platformLocale(locale: locale);",
                "  if (language.startsWith('zh')) {",
                "    return switch (value) {",
            ]
        )
        lines.extend(f"      {enum}.{name} => {dart_string(zh)}," for name, _, zh in rows)
        lines.extend(["    };", "  }", "  return switch (value) {"])
        lines.extend(f"    {enum}.{name} => {dart_string(en)}," for name, en, _ in rows)
        lines.extend(["  };", "}", ""])

    modes = theme_modes(messages)
    lines.append("enum PlatformThemeMode {")
    lines.extend(f"  {mode}," for mode in modes)
    lines.extend(
        [
            "}",
            "",
            "PlatformMessageKey platformThemeModeKey(PlatformThemeMode mode) => switch (mode) {",
        ]
    )
    lines.extend(
        f"  PlatformThemeMode.{mode} => PlatformMessageKey.{dart_key(key)}," for mode, key in modes.items()
    )
    lines.extend(["};", ""])
    lines.extend(
        [
            "String _platformLanguage(String? locale) =>",
            "    (locale ?? '').toLowerCase().startsWith('en') ? 'en' : 'zh-CN';",
            "",
            "/// The supported locale (`en` or `zh-CN`) a device locale resolves to.",
            "String platformLocale({String? locale}) => _platformLanguage(locale);",
            "",
            f"const platformCalendarWeekdayBandDays = {weekday_band_days};",
            *(
                f"const platformTimeSeconds{unit.capitalize()} = {seconds[unit]};"
                for unit in ("minute", "hour", "day", "month")
            ),
            "",
            "String platformIntlLocale({String? locale}) =>",
            "    _platformLanguage(locale) == 'zh-CN' ? 'zh_CN' : 'en_US';",
            "",
            "const _platformPluralOneLocales = <String>{",
        ]
    )
    lines.extend(f"  {dart_string(locale)}," for locale in plural_locales)
    lines.extend(
        [
            "};",
            "",
            "bool platformPluralOne(int count, {String? locale}) =>",
            "    count == 1 && _platformPluralOneLocales.contains(_platformLanguage(locale));",
            "",
            "const _platformSpecialRelativeUnits = <String>{",
        ]
    )
    lines.extend(f"  {dart_string(unit)}," for unit in special_units)
    lines.extend(
        [
            "};",
            "",
            "String platformAbsoluteTime(String rfc3339, {String? locale}) {",
            "  final at = DateTime.tryParse(rfc3339);",
            "  if (at == null) {",
            "    return platformText(PlatformMessageKey.platformTimeUnavailable, locale: locale);",
            "  }",
            "  final local = at.toLocal();",
            "  return platformText(PlatformMessageKey.platformTimeAbsolute, locale: locale, variables: {",
            "    'year': local.year,",
            "    'month': local.month,",
            "    'day': local.day,",
            "    'hour': local.hour.toString().padLeft(2, '0'),",
            "    'minute': local.minute.toString().padLeft(2, '0'),",
            "  });",
            "}",
            "",
            "String platformRelativeTime(String rfc3339, {String? locale, DateTime? now}) {",
            "  final at = DateTime.tryParse(rfc3339);",
            "  if (at == null) {",
            "    return platformText(PlatformMessageKey.platformTimeUnavailable, locale: locale);",
            "  }",
            "  final current = now ?? DateTime.now();",
            "  final elapsed = ((at.millisecondsSinceEpoch - current.millisecondsSinceEpoch).abs() / 1000).round();",
            "  if (elapsed == 0) {",
            "    return platformText(PlatformMessageKey.platformTimeNow, locale: locale);",
            "  }",
            "  var unit = 'second';",
            "  var count = elapsed;",
        ]
    )
    for index, unit in enumerate(("month", "day", "hour", "minute")):
        lines.extend(
            [
                f"  {'if' if index == 0 else 'else if'} (elapsed >= platformTimeSeconds{unit.capitalize()}) {{",
                f"    unit = '{unit}';",
                f"    count = (elapsed / platformTimeSeconds{unit.capitalize()}).round();",
                "  }",
            ]
        )
    lines.extend(
        [
            "  final direction = at.isAfter(current) ? 'future' : 'past';",
            "  final form = count == 1 && _platformSpecialRelativeUnits.contains(unit)",
            "      ? 'one'",
            "      : (platformPluralOne(count, locale: locale) ? 'one' : 'other');",
            "  final key = switch ('$direction.$unit.$form') {",
        ]
    )
    for direction in ("past", "future"):
        for unit in ("second", "minute", "hour", "day", "month"):
            for form in ("one", "other"):
                key = f"platform.time.{direction}.{unit}.{form}"
                lines.append(f"    '{direction}.{unit}.{form}' => PlatformMessageKey.{dart_key(key)},")
    lines.extend(
        [
            "    _ => PlatformMessageKey.platformTimeUnavailable,",
            "  };",
            "  return platformText(key, locale: locale, variables: {'count': count});",
            "}",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        reason_file = Path(directory) / TARGET.name
        platform_file = Path(directory) / PLATFORM_TARGET.name
        reason_file.write_text(render(catalog()))
        platform_file.write_text(render_platform(*platform_catalog()))
        dart = shutil.which("dart")
        if dart is None:
            raise ValueError("Dart formatter unavailable")
        subprocess.run(
            [dart, "format", str(reason_file), str(platform_file)],
            check=True,
            capture_output=True,
        )
        outputs = {TARGET: reason_file.read_text(), PLATFORM_TARGET: platform_file.read_text()}
    if args.check:
        for target, generated in outputs.items():
            if not target.exists() or target.read_text() != generated:
                print(f"FAIL: {target.relative_to(ROOT)} is out of sync", file=sys.stderr)
                return 1
        print("PASS: Mobile platform and reason catalogs match the shared TypeScript source")
        return 0
    for target, generated in outputs.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(generated)
        print(f"Generated {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

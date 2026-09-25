// 平台页的显示格式。与两端宿主各自的同名工具取同一规则。

import {
  type PlatformLocale,
  type PlatformMessageKey,
  platformPluralForm,
  platformSpecialRelativeUnits,
  platformTimeSeconds,
  translate,
} from "./i18n";

/** 公钥的紧凑显示：前 8 位、省略号、后 4 位；不超过 12 位时原样显示。 */
export function truncatePubkey(pubkey: string): string {
  return pubkey.length <= 12 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** RFC 3339 时刻相对于 `now`（毫秒）的相对时间。 */
export function relativeTime(locale: PlatformLocale, rfc3339: string, now = Date.now()): string {
  const timestamp = Date.parse(rfc3339);
  if (!Number.isFinite(timestamp)) return translate(locale, "platform.time.unavailable");
  const seconds = Math.round(Math.abs(timestamp - now) / 1_000);
  if (seconds === 0) return translate(locale, "platform.time.now");

  let unit: "second" | "minute" | "hour" | "day" | "month" = "second";
  let count = seconds;
  if (seconds >= platformTimeSeconds.month) {
    unit = "month";
    count = Math.round(seconds / platformTimeSeconds.month);
  } else if (seconds >= platformTimeSeconds.day) {
    unit = "day";
    count = Math.round(seconds / platformTimeSeconds.day);
  } else if (seconds >= platformTimeSeconds.hour) {
    unit = "hour";
    count = Math.round(seconds / platformTimeSeconds.hour);
  } else if (seconds >= platformTimeSeconds.minute) {
    unit = "minute";
    count = Math.round(seconds / platformTimeSeconds.minute);
  }

  const direction = timestamp > now ? "future" : "past";
  const form = count === 1 && platformSpecialRelativeUnits.some((candidate) => candidate === unit)
    ? "one"
    : platformPluralForm(locale, count);
  const key = `platform.time.${direction}.${unit}.${form}` as PlatformMessageKey;
  return translate(locale, key, { count });
}

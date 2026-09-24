// 平台页的显示格式。与两端宿主各自的同名工具取同一规则。

import type { PlatformLocale } from "./i18n";

/** 公钥的紧凑显示：前 8 位、省略号、后 4 位；不超过 12 位时原样显示。 */
export function truncatePubkey(pubkey: string): string {
  return pubkey.length <= 12 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** RFC 3339 时刻相对于 `now`（毫秒）的相对时间。 */
export function relativeTime(locale: PlatformLocale, rfc3339: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(rfc3339) - now) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return formatter.format(Math.round(days / 30), "month");
}

import { relativeTime as platformRelativeTime } from "@kailo/platform/format";
import { translate } from "@kailo/platform/i18n";
import { getLocale } from "@/shared/i18n";

/** Chat and management use the same locale, thresholds and message catalog. */
export function relativeTime(unix: number): string {
  const milliseconds = unix * 1_000;
  const locale = getLocale();
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return translate(locale, "platform.time.unavailable");
  }
  return platformRelativeTime(locale, date.toISOString());
}

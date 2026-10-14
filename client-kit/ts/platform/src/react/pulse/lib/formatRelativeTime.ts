// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/pulse/ui/NoteCard.tsx::formatRelativeTime ("5m") and
// desktop/src/features/pulse/ui/AgentActivityCard.tsx::formatRelativeTime ("5m ago").
// Same thresholds and short-date fallback; copy comes from the shared catalog.
import type { PlatformLocale } from "../../../i18n";
import type { Translate } from "../../context";

export function formatPulseRelativeTime(unixSeconds: number, t: Translate, locale: PlatformLocale,
  { ago = false }: { ago?: boolean } = {}, now = Date.now() / 1_000): string {
  const diff = now - unixSeconds;
  if (diff < 60) return t("pulse.time.justNow");
  if (diff < 3_600) return t(ago ? "pulse.time.minutesAgo" : "pulse.time.minutes", { count: Math.floor(diff / 60) });
  if (diff < 86_400) return t(ago ? "pulse.time.hoursAgo" : "pulse.time.hours", { count: Math.floor(diff / 3_600) });
  if (diff < 604_800) return t(ago ? "pulse.time.daysAgo" : "pulse.time.days", { count: Math.floor(diff / 86_400) });
  return new Date(unixSeconds * 1_000).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

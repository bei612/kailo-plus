// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/lib/ephemeralChannel.ts::{isEphemeralChannel,getEphemeralChannelDisplay}
// desktop/src/features/channels/useEphemeralChannelDisplay.ts::useEphemeralChannelDisplay
// desktop/src/features/channels/ui/EphemeralChannelBadge.tsx::EphemeralChannelBadge
// desktop/src/features/channels/ui/ChannelHeaderStatusBadge.tsx::ChannelHeaderStatusBadge
// The TTL countdown is derived only from the admitted channel view (DD-119(3)): ttlSeconds and
// the Relay ttlDeadline. Wording follows the original English and is localized through i18n.
import * as React from "react";
import { ClockFading } from "lucide-react";
import { translate, type PlatformLocale, type PlatformMessageKey } from "../i18n";
import { useUiLocale } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";

export type EphemeralChannelLike = {
  id?: string;
  ttlSeconds?: number | null;
  /** RFC 3339, as on the wire (ADR-21). */
  ttlDeadline?: string | null;
};

export type EphemeralChannelDisplay = {
  /** Original compact remaining label; a change key only, the badge does not render it. */
  detailLabel: string | null;
  tooltipLabel: string;
};

const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 60 * 60 * 24;

export function isEphemeralChannel(channel: EphemeralChannelLike): boolean {
  return (channel.ttlSeconds !== undefined && channel.ttlSeconds !== null)
    || (channel.ttlDeadline !== undefined && channel.ttlDeadline !== null);
}

function deadlineMs(ttlDeadline: EphemeralChannelLike["ttlDeadline"]): number | null {
  if (ttlDeadline === undefined || ttlDeadline === null) return null;
  const value = Date.parse(ttlDeadline);
  return Number.isNaN(value) ? null : value;
}

function formatCompactRemaining(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return "Cleanup due";
  if (remainingSeconds <= 60) return "1m left";
  if (remainingSeconds < HOUR) return `${Math.max(1, Math.ceil(remainingSeconds / MINUTE))}m left`;
  if (remainingSeconds < DAY) return `${Math.max(1, Math.ceil(remainingSeconds / HOUR))}h left`;
  return `${Math.max(1, Math.ceil(remainingSeconds / DAY))}d left`;
}

function formatCompactTtl(ttlSeconds: number): string {
  if (ttlSeconds < 60) return `${Math.max(1, ttlSeconds)}s TTL`;
  if (ttlSeconds < HOUR) return `${Math.max(1, Math.ceil(ttlSeconds / MINUTE))}m TTL`;
  if (ttlSeconds < DAY) return `${Math.max(1, Math.ceil(ttlSeconds / HOUR))}h TTL`;
  return `${Math.max(1, Math.ceil(ttlSeconds / DAY))}d TTL`;
}

function formatVerboseRemaining(locale: PlatformLocale, remainingSeconds: number): string {
  const formatter = new Intl.RelativeTimeFormat(locale === "en" ? "en-US" : locale, { numeric: "auto" });
  if (remainingSeconds <= 60) return formatter.format(1, "minute");
  if (remainingSeconds < HOUR) return formatter.format(Math.max(1, Math.ceil(remainingSeconds / MINUTE)), "minute");
  if (remainingSeconds < DAY) return formatter.format(Math.max(1, Math.ceil(remainingSeconds / HOUR)), "hour");
  return formatter.format(Math.max(1, Math.ceil(remainingSeconds / DAY)), "day");
}

function formatVerboseTtl(locale: PlatformLocale, ttlSeconds: number): string {
  const [count, unit] = ttlSeconds < 60 ? [Math.max(1, ttlSeconds), "second"] as const
    : ttlSeconds < HOUR ? [Math.max(1, Math.ceil(ttlSeconds / MINUTE)), "minute"] as const
      : ttlSeconds < DAY ? [Math.max(1, Math.ceil(ttlSeconds / HOUR)), "hour"] as const
        : [Math.max(1, Math.ceil(ttlSeconds / DAY)), "day"] as const;
  const key = `channel.ephemeral.${unit}.${count === 1 ? "one" : "other"}` as PlatformMessageKey;
  return translate(locale, key, { count });
}

export function getEphemeralChannelDisplay(
  channel: EphemeralChannelLike,
  locale: PlatformLocale,
  nowMs = Date.now(),
): EphemeralChannelDisplay | null {
  if (!isEphemeralChannel(channel)) return null;
  const deadline = deadlineMs(channel.ttlDeadline);
  const ttlSeconds = channel.ttlSeconds ?? null;
  if (deadline === null) {
    return {
      detailLabel: ttlSeconds === null ? null : formatCompactTtl(ttlSeconds),
      tooltipLabel: ttlSeconds === null
        ? translate(locale, "channel.ephemeral.cleansUpAutomatically")
        : translate(locale, "channel.ephemeral.cleansUpAfter", { duration: formatVerboseTtl(locale, ttlSeconds) }),
    };
  }
  const remainingSeconds = Math.ceil((deadline - nowMs) / 1_000);
  const compactRemaining = formatCompactRemaining(remainingSeconds);
  const absoluteDeadline = new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(deadline));
  return {
    detailLabel: compactRemaining,
    tooltipLabel: remainingSeconds <= 0
      ? translate(locale, "channel.ephemeral.cleanupDueNow")
      : translate(locale, "channel.ephemeral.cleansUpScheduled", {
        relative: formatVerboseRemaining(locale, remainingSeconds), deadline: absoluteDeadline,
      }),
  };
}

/** Re-evaluates once a minute while a deadline is known, with a stable reference per label. */
export function useEphemeralChannelDisplay(channel: EphemeralChannelLike | null): EphemeralChannelDisplay | null {
  const locale = useUiLocale();
  const [, setClockTick] = React.useState(0);
  const deadline = channel ? deadlineMs(channel.ttlDeadline) : null;
  const deadlineKey = channel === null || deadline === null ? null : `${channel.id ?? ""}:${deadline}`;
  React.useEffect(() => {
    if (deadlineKey === null) return;
    const intervalId = window.setInterval(() => setClockTick((current) => current + 1), 60_000);
    return () => window.clearInterval(intervalId);
  }, [deadlineKey]);
  const display = channel ? getEphemeralChannelDisplay(channel, locale, Date.now()) : null;
  const stableRef = React.useRef(display);
  const previous = stableRef.current;
  if (previous?.detailLabel !== display?.detailLabel || previous?.tooltipLabel !== display?.tooltipLabel) {
    stableRef.current = display;
  }
  return stableRef.current;
}

export function EphemeralChannelBadge({ display, testId, variant }: {
  display: EphemeralChannelDisplay;
  testId?: string;
  variant: "header" | "sidebar";
}) {
  return (
    <ClockFading
      aria-label={display.tooltipLabel}
      className={cn("h-4 w-4 shrink-0", variant === "header" ? "text-muted-foreground" : "text-sidebar-foreground/45")}
      data-testid={testId}
      role="img"
    />
  );
}

/** Original header/sidebar badge for one admitted channel view; renders nothing for ongoing channels. */
export function ChannelEphemeralBadge({ channel, testId, variant }: {
  channel: EphemeralChannelLike;
  testId?: string;
  variant: "header" | "sidebar";
}) {
  const display = useEphemeralChannelDisplay(channel);
  return display ? <EphemeralChannelBadge display={display} testId={testId} variant={variant} /> : null;
}

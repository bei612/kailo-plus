// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/app/useTrayMenu.ts: the pure
// projection from the admitted Agent working signal (DD-125(5): the same source as the channel
// activity bar) to the native tray rows, plus the localized fixed labels (DD-111 name).
import type { PlatformLocale, PlatformMessageKey } from "@client-kit/platform/i18n";

export type TrayAgentActivity = {
  activityId: string;
  agentName: string;
  channelId: string;
  channelName: string;
  elapsed: string;
};

export type TrayMenuLabels = {
  running: string;
  noAgents: string;
  recent: string;
  newChannel: string;
  openApp: string;
  quitApp: string;
};

export type TrayWorkingChannel = {
  channelId: string;
  anchorAt: number;
  source: "turn" | "typing";
  agentPubkeys: readonly string[];
};

export type TrayAgentLookup = {
  /** Display name from the channel's admitted Installation directory, if known. */
  agentName: (channelId: string, pubkey: string) => string | undefined;
  /** Per-Agent anchor of an audited turn, when the signal has one. */
  agentAnchor: (channelId: string, pubkey: string) => number | undefined;
};

export const MAX_RECENT_TRAY_ACTIVITIES = 5;

type Translate = (key: PlatformMessageKey, variables?: Record<string, string>) => string;

function shortPubkey(pubkey: string): string {
  return pubkey.length > 12 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : pubkey;
}

/**
 * One row per working Agent per channel. Elapsed time is shown only for audited turns (their
 * anchor is the native turn start); typing-only work says "Working", as the activity badge does.
 */
export function buildTrayActivities(
  working: readonly TrayWorkingChannel[],
  channelNames: ReadonlyMap<string, string>,
  lookup: TrayAgentLookup,
  now: number,
  t: Translate,
  formatElapsed: (ms: number) => string,
): TrayAgentActivity[] {
  return working.flatMap((channel) =>
    channel.agentPubkeys.map((rawPubkey) => {
      const pubkey = rawPubkey.trim().toLowerCase();
      // Only an audited turn has a trustworthy start; typing-only Agents (even when folded into
      // a channel that has audited turns) say "Working" instead of a guessed elapsed time.
      const anchor = channel.source === "turn"
        ? (lookup.agentAnchor(channel.channelId, pubkey) ?? null)
        : null;
      return {
        activityId: `${channel.channelId}:${pubkey}`,
        agentName: lookup.agentName(channel.channelId, pubkey)
          ?? t("tray.agentFallback", { id: shortPubkey(pubkey) }),
        channelId: channel.channelId,
        channelName: channelNames.get(channel.channelId) ?? t("tray.unknownChannel"),
        elapsed: anchor === null ? t("agentActivity.popover.working") : formatElapsed(now - anchor),
      };
    }),
  );
}

/** Rows that disappeared since the previous projection, newest first, capped like the original. */
export function nextRecentActivities(
  previous: ReadonlyMap<string, TrayAgentActivity>,
  current: readonly TrayAgentActivity[],
  recent: readonly TrayAgentActivity[],
  stamp: number,
): TrayAgentActivity[] {
  const live = new Set(current.map((activity) => activity.activityId));
  const completed = [...previous.entries()]
    .filter(([activityId]) => !live.has(activityId))
    .map(([, activity]) => ({ ...activity, activityId: `recent:${activity.activityId}:${stamp}` }));
  if (completed.length === 0) return [...recent];
  return [...completed, ...recent].slice(0, MAX_RECENT_TRAY_ACTIVITIES);
}

/** The fixed labels; the product name is the deployment's, else neutral wording. */
export function trayMenuLabels(locale: PlatformLocale, displayName: string | null,
  translate: (locale: PlatformLocale, key: PlatformMessageKey, variables?: Record<string, string>) => string): TrayMenuLabels {
  const name = displayName?.trim() || null;
  return {
    running: translate(locale, "tray.running"),
    noAgents: translate(locale, "tray.noAgents"),
    recent: translate(locale, "tray.recent"),
    newChannel: translate(locale, "tray.newChannel"),
    openApp: name ? translate(locale, "tray.openNamed", { name }) : translate(locale, "tray.open"),
    quitApp: name ? translate(locale, "tray.quitNamed", { name }) : translate(locale, "tray.quit"),
  };
}

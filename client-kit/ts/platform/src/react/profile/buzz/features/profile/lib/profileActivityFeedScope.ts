// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/lib/profileActivityFeedScope.ts.
// DD-125(6): Kailo Agents publish no 24200 observer frames, so the feed has no observer events;
// its inputs are the unified working signal (audited running turns, 20002 fallback) and the
// Installation's live Codex transcript items. Channel keys are the host's activity scope (the
// Workspace ID the working signal and the activity opener use). Derivation rules are unchanged.
import * as React from "react";

import type { TranscriptItem } from "../../../../../agent-transcript/agentSessionTypes";

/** One channel with Agent work in progress (original ActiveTurnSummary fields used here). */
export type ProfileActiveTurn = { channelId: string; anchorAt: number };

export type ProfileActivityFeedScope = {
  /** Distinct channel ids to surface in the embed switcher. */
  channelIds: string[];
  /** Whether the live feed has any transcript for this agent. */
  hasFeedContent: boolean;
  /** True while the working signal reports live work for this agent. */
  isLive: boolean;
  /** Latest observed activity timestamp, keyed by channel id. */
  latestActivityAtByChannel: Record<string, number>;
  /** Preferred channel scope when no explicit selection exists yet. */
  preferredChannelId: string | null;
};

function channelIdsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function latestActivityByChannelEqual(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function scopesEqual(
  left: ProfileActivityFeedScope,
  right: ProfileActivityFeedScope,
): boolean {
  return (
    left.hasFeedContent === right.hasFeedContent &&
    left.isLive === right.isLive &&
    left.preferredChannelId === right.preferredChannelId &&
    latestActivityByChannelEqual(
      left.latestActivityAtByChannel,
      right.latestActivityAtByChannel,
    ) &&
    channelIdsEqual(left.channelIds, right.channelIds)
  );
}

function collectChannelIdsFromFeed(
  transcript: readonly TranscriptItem[],
): string[] {
  const channelIds = new Set<string>();
  for (const item of transcript) {
    if (item.channelId) {
      channelIds.add(item.channelId);
    }
  }
  return [...channelIds].sort((left, right) => left.localeCompare(right));
}

function deriveLatestChannelId(
  transcript: readonly TranscriptItem[],
): string | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const channelId = transcript[index]?.channelId;
    if (channelId) {
      return channelId;
    }
  }

  return null;
}

function parseTimestampMillis(timestamp: string): number | null {
  const millis = Date.parse(timestamp);
  return Number.isNaN(millis) ? null : millis;
}

function collectLatestActivityAtByChannel({
  activeTurns,
  transcript,
}: {
  activeTurns: readonly ProfileActiveTurn[];
  transcript: readonly TranscriptItem[];
}): Record<string, number> {
  const latestActivityAtByChannel: Record<string, number> = {};

  const record = (channelId: string | null | undefined, timestamp: number) => {
    if (!channelId) {
      return;
    }
    const previous = latestActivityAtByChannel[channelId];
    if (previous === undefined || timestamp > previous) {
      latestActivityAtByChannel[channelId] = timestamp;
    }
  };

  for (const turn of activeTurns) {
    record(turn.channelId, turn.anchorAt);
  }

  for (const item of transcript) {
    const timestamp = parseTimestampMillis(item.timestamp);
    if (timestamp !== null) {
      record(item.channelId, timestamp);
    }
  }

  return latestActivityAtByChannel;
}

export function deriveProfileActivityFeedScope({
  activeTurns,
  transcript,
}: {
  activeTurns: readonly ProfileActiveTurn[];
  transcript: readonly TranscriptItem[];
}): ProfileActivityFeedScope {
  const hasFeedContent = transcript.length > 0;
  const isLive = activeTurns.length > 0;
  const latestActivityAtByChannel = collectLatestActivityAtByChannel({
    activeTurns,
    transcript,
  });

  if (isLive) {
    const channelIds = [...activeTurns]
      .map((turn) => turn.channelId)
      .sort((left, right) => left.localeCompare(right));

    return {
      channelIds,
      hasFeedContent: true,
      isLive: true,
      latestActivityAtByChannel,
      preferredChannelId: channelIds[0] ?? null,
    };
  }

  const feedChannelIds = collectChannelIdsFromFeed(transcript);
  const latestChannelId = deriveLatestChannelId(transcript);

  return {
    channelIds: feedChannelIds,
    hasFeedContent,
    isLive: false,
    latestActivityAtByChannel,
    preferredChannelId: latestChannelId,
  };
}

/**
 * The original store-backed hook: both inputs are already reactive here (the working signal
 * and the live transcript subscription), so only the original structural stability remains.
 */
export function useProfileActivityFeedScope(
  activeTurns: readonly ProfileActiveTurn[],
  transcript: readonly TranscriptItem[],
): ProfileActivityFeedScope {
  const cached = React.useRef<ProfileActivityFeedScope | null>(null);
  const next = deriveProfileActivityFeedScope({ activeTurns, transcript });
  if (cached.current && scopesEqual(cached.current, next)) {
    return cached.current;
  }
  cached.current = next;
  return next;
}

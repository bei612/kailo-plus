// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/useChannelActivityTyping.ts (bot typing mirrored into the working
// signal) plus the Kailo turn-primary input (DD-125(6)):
// - Agents are the channel's admitted Installation directory (never kind:0 is_agent).
// - Members only see the Agent's 20002 typing. Core publishes it with the original thread tags,
//   and Kailo Agents reply in threads, so a thread-scoped Agent typing entry also marks the channel
//   as working (the original relied on 24200 observer turns for that; Kailo has none).
// - Installation `audit` holders additionally read the audited running turns of this Workspace
//   (GET /api/v1/workspaces/{id}/agent-turns) on mount, on Agent typing changes and when the window
//   regains focus/visibility. It is a projection of Core facts, never polled as an authority.
import * as React from "react";
import type { AgentActiveTurnPage, AgentInstallationView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import type { TypingIndicatorEntry } from "../messages/typingState";
import {
  normalizePubkey,
  reportChannelActiveTurns,
  reportChannelAgents,
  reportChannelBotTyping,
  useChannelWorkingAgentPubkeys,
  type ReportedAgentTurn,
} from "./agentWorkingSignal";

export function agentPubkeysOf(agents: readonly AgentInstallationView[] | undefined): ReadonlySet<string> {
  return new Set((agents ?? []).flatMap((row) => row.agentPubkey ? [normalizePubkey(row.agentPubkey)] : []));
}

/** The original typing key: sorted, de-duplicated Agent pubkeys currently typing. */
export function botTypingPubkeyKey(entries: readonly Pick<TypingIndicatorEntry, "pubkey">[], agents: ReadonlySet<string>): string {
  return [...new Set(entries.map((entry) => normalizePubkey(entry.pubkey)).filter((pubkey) => agents.has(pubkey)))]
    .sort()
    .join(",");
}

/** Turns of audited Installations only; a malformed page yields nothing rather than a guess. */
export function auditedTurns(page: AgentActiveTurnPage, workspaceId: string,
  agents: readonly AgentInstallationView[]): ReportedAgentTurn[] | null {
  if (!page || page.workspaceId !== workspaceId || !Array.isArray(page.turns)) return null;
  const byInstallation = new Map(agents.filter((row) => row.canAudit === true && row.agentPubkey)
    .map((row) => [row.resourceId, normalizePubkey(row.agentPubkey!)]));
  const turns: ReportedAgentTurn[] = [];
  for (const turn of page.turns) {
    const pubkey = byInstallation.get(turn?.installationId);
    if (!pubkey || (turn.agentPubkey !== undefined && normalizePubkey(turn.agentPubkey) !== pubkey)) continue;
    const started = turn.startedAt === undefined ? Number.NaN : Date.parse(turn.startedAt);
    // Without the native start the original typing first-seen anchor applies (reported as typing).
    if (!Number.isFinite(started)) continue;
    turns.push({ agentPubkey: pubkey, anchorAt: started });
  }
  return turns;
}

export function useChannelAgentActivity({
  client,
  channelId,
  agents,
  typingEntries,
  enabled,
}: {
  client: BffClient;
  /** The host's channel identity; the Web uses the route's Workspace ID. */
  channelId: string | null;
  /** The channel's admitted Installation directory (Resource read). */
  agents: readonly AgentInstallationView[] | undefined;
  typingEntries: readonly TypingIndicatorEntry[];
  enabled: boolean;
}) {
  const agentPubkeys = React.useMemo(() => agentPubkeysOf(agents), [agents]);
  const typingKey = enabled ? botTypingPubkeyKey(typingEntries, agentPubkeys) : "";
  const audited = React.useMemo(() => (agents ?? []).filter((row) => row.canAudit === true && row.agentPubkey), [agents]);

  React.useEffect(() => {
    if (!channelId || !enabled) return;
    reportChannelAgents(channelId, (agents ?? []).flatMap((row) => row.agentPubkey ? [{
      pubkey: row.agentPubkey,
      name: row.agentDisplayName?.trim() ?? "",
      canOpenActivity: row.canAudit === true,
    }] : []));
    return () => reportChannelAgents(channelId, []);
  }, [channelId, enabled, agents]);

  React.useEffect(() => {
    if (!channelId || !enabled) return;
    reportChannelBotTyping(channelId, typingKey ? typingKey.split(",") : []);
    return () => reportChannelBotTyping(channelId, []);
  }, [channelId, enabled, typingKey]);

  const [focusTick, setFocusTick] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const visible = () => { if (document.visibilityState === "visible") setFocusTick((tick) => tick + 1); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, []);

  React.useEffect(() => {
    if (!channelId || !enabled || audited.length === 0) {
      if (channelId) reportChannelActiveTurns(channelId, []);
      return;
    }
    let current = true;
    client.agentActiveTurns(channelId).then((page) => {
      if (!current) return;
      reportChannelActiveTurns(channelId, auditedTurns(page, channelId, audited) ?? []);
    }, () => {
      // An unreadable projection is no evidence of work; keep only the typing fallback.
      if (current) reportChannelActiveTurns(channelId, []);
    });
    return () => { current = false; };
  }, [client, channelId, enabled, audited, typingKey, focusTick]);

  React.useEffect(() => () => {
    if (channelId) reportChannelActiveTurns(channelId, []);
  }, [channelId]);

  const workingBotPubkeys = useChannelWorkingAgentPubkeys(enabled ? channelId : null);
  return { agentPubkeys, workingBotPubkeys };
}

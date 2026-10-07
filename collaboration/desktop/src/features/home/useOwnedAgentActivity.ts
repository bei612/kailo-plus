// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/useOwnedAgentPubkeys.ts and original author feed.
// Kailo ownership comes only from its admitted Installation directory; events
// remain signed Relay data, never a second stored feed or Agent registry.
import { useQuery } from "@tanstack/react-query";
import { loadOwnedAgentIdentities } from "@client-kit/platform/inbox";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { relayClient } from "@/shared/api/relayClient";
import type { FeedItem } from "@/shared/api/types";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { verifyEvent } from "nostr-tools/pure";

export function useOwnedAgentActivity(workspaces: ReadonlySet<string>, enabled: boolean) {
  const session = useNativeSession();
  const ids = [...workspaces].sort();
  return useQuery({
    queryKey: ["home", "owned-agent-activity", session.facts.relayUrl, session.devicePubkey, ids],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const principal = (await session.client.session()).tenantPrincipalId;
      signal.throwIfAborted();
      const activity: FeedItem[] = [];
      const pubkeys = new Set<string>();
      for (const workspace of ids) {
        signal.throwIfAborted();
        const agents = await loadOwnedAgentIdentities(session.client, workspace, principal);
        // The native Relay client is shared with the current connection. Do not
        // issue an old scope's author request after its directory read returns.
        signal.throwIfAborted();
        if (!agents.size) continue;
        const limit = session.facts.relayQueryLimit;
        if (!Number.isSafeInteger(limit) || !limit || limit <= 0) throw new Error("Missing Relay read bound");
        const authors = [...agents.values()];
        const events = await relayClient.fetchEvents({ kinds: [KIND_STREAM_MESSAGE], authors, "#h": [workspace], limit });
        signal.throwIfAborted();
        const current = await loadOwnedAgentIdentities(session.client, workspace, principal);
        signal.throwIfAborted();
        if (current.size !== agents.size || [...agents].some(([id, key]) => current.get(id) !== key)) throw new Error("Agent admission changed during read");
        for (const event of events) {
          if (!verifyEvent(event) || event.kind !== KIND_STREAM_MESSAGE || !authors.includes(event.pubkey) ||
              event.tags.filter(tag => tag[0] === "h").length !== 1 ||
              !event.tags.some(tag => tag[0] === "h" && tag[1] === workspace)) throw new Error("Unverifiable Agent activity");
          activity.push({ ...event, createdAt: event.created_at, channelId: workspace, channelName: "", category: "activity" });
        }
        authors.forEach(key => pubkeys.add(key));
      }
      const current = await session.client.session();
      signal.throwIfAborted();
      const visible = new Set((await session.client.workspaces()).filter(item => item.isMember === true).map(item => item.id));
      signal.throwIfAborted();
      if (current.tenantPrincipalId !== principal || ids.some(id => !visible.has(id))) throw new Error("Inbox scope changed during read");
      return { activity, pubkeys };
    },
  });
}

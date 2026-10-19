// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/lib/huddlePresenceRuntime.ts (10 s liveness poll)
// desktop/src/shared/api/relayClientSession.ts::subscribeToHuddleEvents (48100-48103 of a parent)
// desktop/src/features/huddle/hooks/useHuddleParticipantRoster.ts
// DD-125(3): Browser does not subscribe to the Relay (DD-39). The parent's in-progress
// HuddleBuzzBindings and their verified lifecycle come from the BFF and are re-read on the
// original 10 s liveness cadence. Participant names come from the admitted Workspace
// member / conversation participant directories and the Workspace's Agent Installations.
import { useQuery } from "@tanstack/react-query";
import { HuddleState, type HuddleLifecycleEvent, type HuddleView } from "@client-kit/contracts";
import { useBffClient } from "../context";
import { loadWorkspaceAgents } from "../agent-installation-view";
import { reconstructActiveHuddle, type ActiveHuddle } from "../../huddle";
import { type HuddleParent, huddleParentKey } from "./host";

/** Original huddlePresenceRuntime liveness interval. */
export const HUDDLE_POLL_MS = 10_000;

export function huddleParentQueryKey(parent: HuddleParent | null) {
  return ["platform", "huddles", parent?.kind ?? "none", parent ? (parent.kind === "workspace" ? parent.workspaceId : parent.conversationId) : ""] as const;
}

export function useParentHuddles(parent: HuddleParent | null) {
  const client = useBffClient();
  return useQuery({
    queryKey: huddleParentQueryKey(parent),
    queryFn: async () => (parent ? (await client.huddles(huddleParentKey(parent))).items : []),
    enabled: parent !== null,
    refetchInterval: HUDDLE_POLL_MS,
  });
}

export function useHuddleLifecycle(huddleId: string | null) {
  const client = useBffClient();
  return useQuery({
    queryKey: ["platform", "huddle-lifecycle", huddleId ?? ""] as const,
    queryFn: () => client.huddleLifecycle(huddleId ?? ""),
    enabled: huddleId !== null,
    refetchInterval: HUDDLE_POLL_MS,
  });
}

/** The parent's live session (original HuddleIndicator) and its binding. */
export function useActiveParentHuddle(parent: HuddleParent | null): {
  binding: HuddleView | null;
  active: ActiveHuddle | null;
  events: HuddleLifecycleEvent[];
} {
  const huddles = useParentHuddles(parent);
  const list = Array.isArray(huddles.data) ? huddles.data : [];
  const binding = list.find((item) => item.state === HuddleState.Active) ?? null;
  const lifecycle = useHuddleLifecycle(binding?.huddleId ?? null);
  const events = Array.isArray(lifecycle.data?.events) ? lifecycle.data.events : [];
  const reconstructed = reconstructActiveHuddle(events);
  const active = binding && reconstructed?.ephemeralChannelId === binding.channelId ? reconstructed : null;
  return { binding, active, events };
}

export type HuddleDirectoryEntry =
  | { kind: "human"; pubkey: string; principalId: string; displayName: string; alternatePubkeys: string[] }
  | { kind: "agent"; pubkey: string; installationId: string; displayName: string };

/**
 * The names behind a Huddle's pubkeys: the parent Workspace's members and Agent Installations,
 * or the conversation's participants. Unknown keys fall back to the original
 * "Participant npub…" label in the views.
 */
export function useHuddleDirectory(parent: HuddleParent | null) {
  const client = useBffClient();
  return useQuery({
    queryKey: ["platform", "huddle-directory", ...huddleParentQueryKey(parent).slice(2)] as const,
    enabled: parent !== null,
    queryFn: async (): Promise<Map<string, HuddleDirectoryEntry>> => {
      const directory = new Map<string, HuddleDirectoryEntry>();
      if (!parent) return directory;
      const addHuman = (principalId: string, displayName: string, pubkeys: string[]) => {
        for (const pubkey of pubkeys) {
          directory.set(pubkey.toLowerCase(), { kind: "human", pubkey, principalId, displayName, alternatePubkeys: pubkeys });
        }
      };
      if (parent.kind === "workspace") {
        const [members, agents] = await Promise.all([
          client.members(parent.workspaceId),
          loadWorkspaceAgents(client, parent.workspaceId),
        ]);
        for (const member of members) addHuman(member.principalId, member.displayName, member.pubkeys);
        for (const agent of agents) {
          if (!agent.agentPubkey) continue;
          directory.set(agent.agentPubkey.toLowerCase(), {
            kind: "agent",
            pubkey: agent.agentPubkey,
            installationId: agent.resourceId,
            displayName: agent.agentDisplayName ?? "",
          });
        }
        return directory;
      }
      let cursor: string | undefined;
      do {
        const page = await client.conversationParticipants(cursor);
        for (const item of page.items) addHuman(item.principalId, item.displayName, item.pubkeys);
        cursor = page.nextCursor;
      } while (cursor);
      return directory;
    },
  });
}

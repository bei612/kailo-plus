// DD-130 host seam for the original Projects Agent chat (Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectAgentChatPanel.tsx, ProjectsAgentPromptPage.tsx::useAgentCandidates).
// The shared panel owns presentation and the payload; the host only reads the opener thread
// and publishes the viewer's message in the Agent's bound channel through its existing
// transport (Web: BFF workspace message publish and reads; Desktop: local CLIENT key and
// Relay). No host starts, enables or installs an Agent, and no host opens an Agent DM.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceChannelCreateChannelType, WorkspaceMembershipState, type AgentMentionOutcomePage, type WorkspaceMemberView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { useBffClient } from "../context";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import { loadComposerAgentDirectory } from "../composer/features/messages/lib/composerAgentDirectory";
import {
  sortProjectAgentCandidates,
  type ProjectAgentCandidate,
  type ProjectAgentConversationEvent,
  type ProjectAgentSendRequest,
} from "./lib/projectAgentConversation";

export type ProjectAgentChatHost = {
  /**
   * Tenant and signing identity of this host (Web: Tenant + principal; Desktop: Community host +
   * device key). Scopes the device-local conversation pointer; never a session id.
   */
  identityScope: string;
  /** The viewer's own signing pubkey on this host; its messages carry the context payload. */
  viewerPubkey: string;
  /** The opener event and its thread replies, through the host's admitted channel read. */
  readConversation: (
    scope: { workspaceId: string; channelId: string },
    openerEventId: string,
    signal: AbortSignal,
  ) => Promise<ProjectAgentConversationEvent[]>;
  /**
   * Publish as the viewer. Web keeps the idempotency key across an unknown outcome (DD-81);
   * Desktop signs with the captured relay and signer scope.
   */
  send: (request: ProjectAgentSendRequest, idempotencyKey: string) => Promise<{ eventId: string }>;
  /** DD-121 outcomes of the viewer's own messages; hosts without this read show no status. */
  mentionOutcomes?: (workspaceId: string, eventIds: readonly string[]) => Promise<AgentMentionOutcomePage>;
};

const Context = React.createContext<ProjectAgentChatHost | null>(null);

export function ProjectAgentChatHostProvider({ host, children }: { host?: ProjectAgentChatHost; children: React.ReactNode }) {
  return <Context.Provider value={host ?? null}>{children}</Context.Provider>;
}

/** Absent outside a host that supplies the governed chat transport: no chat entry is rendered. */
export function useProjectAgentChatHost() {
  return React.useContext(Context);
}

export type ProjectAgentDirectory = {
  candidates: ProjectAgentCandidate[];
  membersByWorkspace: ReadonlyMap<string, WorkspaceMemberView[]>;
};

const DIRECTORY_CONCURRENCY = 3;

/**
 * DD-130(2): Installations the viewer may @mention, from the same admitted per-channel
 * directory as the composer — ACTIVE member Workspaces only, stream and not archived.
 * One failed Workspace read fails the whole directory: a partial list would hide Agents.
 */
export async function loadProjectAgentDirectory(
  client: BffClient,
  current: () => boolean,
): Promise<ProjectAgentDirectory> {
  const check = () => { if (!current()) throw new Error("Project Agent scope changed"); };
  const rows = (await loadChannelDirectory(client, current)).filter(row => row.isMember
    && row.membershipState === WorkspaceMembershipState.Active
    && row.channel.channelType === WorkspaceChannelCreateChannelType.Stream && !row.channel.archived);
  check();
  const candidates: ProjectAgentCandidate[] = [];
  const membersByWorkspace = new Map<string, WorkspaceMemberView[]>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const row = rows[next++];
      if (!row) return;
      // Cheap first page: Workspaces without Installations need no admitted directory read.
      const first = await client.agentInstallations(row.id, 0);
      check();
      if (!first || !Array.isArray(first.installations)) throw new Error("Agent directory unavailable");
      if (first.installations.length === 0 && first.nextOffset == null) continue;
      const directory = await loadComposerAgentDirectory(client, { workspaceId: row.id, channelId: row.channel.channelId }, current);
      check();
      if (directory.channelId !== row.channel.channelId) throw new Error("Agent directory channel mismatch");
      membersByWorkspace.set(row.id, directory.members);
      for (const agent of directory.agents) {
        candidates.push({
          installationId: agent.installation.resourceId,
          pubkey: agent.pubkey,
          name: agent.displayName,
          workspaceId: row.id,
          channelId: directory.channelId,
          channelName: row.channel.name,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DIRECTORY_CONCURRENCY, rows.length) }, worker));
  check();
  return { candidates: sortProjectAgentCandidates(candidates), membersByWorkspace };
}

export function useProjectAgentDirectory(host: ProjectAgentChatHost | null) {
  const client = useBffClient();
  const owner = React.useMemo(() => ({ active: true }), [client, host?.identityScope]);
  React.useEffect(() => {
    owner.active = true;
    return () => { owner.active = false; };
  }, [owner]);
  const query = useQuery({
    queryKey: ["projects", "agent-chat-directory", host?.identityScope ?? null],
    enabled: Boolean(host),
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) => loadProjectAgentDirectory(client, () => owner.active && !signal.aborted),
  });
  // A failed or in-flight refetch never keeps a stale candidate list usable.
  const data = query.isSuccess && !query.isFetching ? query.data : undefined;
  return { ...query, data };
}

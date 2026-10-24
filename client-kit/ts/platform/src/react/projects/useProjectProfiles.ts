// DD-157(8), .design/20 §1/§9, DD-139: Projects people are Kailo members or Agents. A relay kind:0
// is a self-published claim; Projects shows its name and picture only for an identity that a Kailo
// directory already vouches for, and otherwise "Unknown member" with the neutral initials avatar.
//   - Kailo member: the pubkey is in the Tenant participant directory (`GET /api/v1/conversation-
//     participants`, the existing Tenant `discover` read). Its kind:0 picture is the same community
//     media the Kailo avatar route `/api/v1/identity/avatars/<subject>` resolves to (web_profile.rs
//     `avatar_location`); a member without a kind:0 name shows the directory name.
//   - Agent: the pubkey is in a Workspace's member-readable Agent author directory (DD-147(1)); its
//     kind:0 is the Installation persona Core publishes (DD-117) and it renders as an Agent.
// No new read authority: both directories are existing BFF reads with their own admission, cached
// under the same keys as their other consumers, and nothing here is persisted. A directory that
// cannot be read vouches for no one (fail closed), so a self-published picture is never shown on
// the strength of a failed read.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { AgentAuthorDirectory, WorkspaceView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { useOptionalBffClient } from "../context";
import { normalizePubkey } from "../conversations/pubkey";
import type { UserProfileLookup } from "../messages/system/identity";
import { tenantMentionDirectoryQuery } from "../non-member-mentions/useTenantMentionDirectory";
import { usePulseHost, useUsersBatchQuery, type UserProfileSummary } from "../pulse/host";

export type ProjectIdentityDirectory = {
  members: ReadonlyMap<string, { displayName: string }>;
  agents: ReadonlyMap<string, { displayName: string | null }>;
};

const HEX_KEY = /^[0-9a-f]{64}$/;
/** Never called: the directory query is disabled without a platform client. */
const NO_DIRECTORY_CLIENT: Pick<BffClient, "conversationParticipants"> = {
  conversationParticipants: async () => { throw new Error("No platform client"); },
};
const EMPTY_PROFILE: UserProfileSummary = { displayName: null, avatarUrl: null, nip05Handle: null, ownerPubkey: null };

/**
 * The vouched lookup for `pubkeys`. A pubkey neither directory names is absent, so every reader
 * resolves it to "Unknown member" and the initials avatar.
 */
export function trustedProjectProfiles(
  pubkeys: readonly string[],
  claimed: UserProfileLookup | undefined,
  directory: ProjectIdentityDirectory,
): UserProfileLookup {
  const profiles: UserProfileLookup = {};
  for (const pubkey of new Set(pubkeys.map(normalizePubkey))) {
    const claim = claimed?.[pubkey];
    const claimedName = claim?.displayName?.trim() || null;
    const member = directory.members.get(pubkey);
    const agent = member ? undefined : directory.agents.get(pubkey);
    if (member) {
      profiles[pubkey] = { ...EMPTY_PROFILE, ...claim,
        displayName: claimedName || member.displayName.trim() || null, isAgent: false };
    } else if (agent) {
      profiles[pubkey] = { ...EMPTY_PROFILE, ...claim,
        displayName: claimedName || agent.displayName?.trim() || null, isAgent: true };
    }
  }
  return profiles;
}

/** The Tenant member directory and every readable Workspace's Agent author directory. */
export function useProjectIdentityDirectory(enabled = true): {
  directory: ProjectIdentityDirectory | undefined;
  isFetching: boolean;
} {
  const client = useOptionalBffClient();
  const host = usePulseHost();
  const active = enabled && client !== null;
  const members = useQuery({
    ...tenantMentionDirectoryQuery(client ?? NO_DIRECTORY_CLIENT, host.scopeKey),
    enabled: active,
  });
  const workspaces = useQuery({
    queryKey: ["platform", "workspaces", host.scopeKey],
    queryFn: () => client!.workspaces(),
    enabled: active,
    retry: false,
    staleTime: 30_000,
  });
  const workspaceIds = Array.isArray(workspaces.data)
    ? (workspaces.data as WorkspaceView[]).filter((workspace) => workspace?.isMember !== false && typeof workspace?.id === "string")
      .map((workspace) => workspace.id)
    : [];
  const authors = useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: ["platform", "agent-authors", workspaceId],
      queryFn: () => client!.agentAuthors(workspaceId),
      enabled: active,
      retry: false,
    })),
  });
  if (!client) return { directory: { members: new Map(), agents: new Map() }, isFetching: false };
  const settled = !members.isPending && !workspaces.isPending && authors.every((query) => !query.isPending);
  const isFetching = members.isFetching || workspaces.isFetching || authors.some((query) => query.isFetching);
  if (!enabled || !settled) return { directory: undefined, isFetching };
  const memberMap = new Map<string, { displayName: string }>();
  for (const person of members.isSuccess && Array.isArray(members.data) ? members.data : []) {
    if (!person || !Array.isArray(person.pubkeys)) continue;
    for (const key of person.pubkeys) {
      const pubkey = typeof key === "string" ? normalizePubkey(key) : "";
      if (HEX_KEY.test(pubkey) && !memberMap.has(pubkey))
        memberMap.set(pubkey, { displayName: typeof person.displayName === "string" ? person.displayName : "" });
    }
  }
  const agentMap = new Map<string, { displayName: string | null }>();
  for (const query of authors) {
    const agents = query.isSuccess ? (query.data as AgentAuthorDirectory | undefined)?.agents : undefined;
    for (const agent of Array.isArray(agents) ? agents : []) {
      const pubkey = typeof agent?.agentPubkey === "string" ? normalizePubkey(agent.agentPubkey) : "";
      if (HEX_KEY.test(pubkey) && !agentMap.has(pubkey))
        agentMap.set(pubkey, { displayName: agent.agentDisplayName?.trim() || null });
    }
  }
  return { directory: { members: memberMap, agents: agentMap }, isFetching };
}

/**
 * `useUsersBatchQuery` for Projects: the same kind:0 read, answered only for vouched identities.
 * Same result shape, so a reader keeps `.data?.profiles`; `data` stays undefined until both the
 * profiles and the directories have been read.
 */
export function useProjectProfiles(keys: string[], options?: { enabled: boolean }) {
  const enabled = keys.length > 0 && options?.enabled !== false;
  const claimed = useUsersBatchQuery(keys, options);
  const { directory, isFetching } = useProjectIdentityDirectory(enabled);
  const profiles = enabled && directory && claimed.data
    ? trustedProjectProfiles(keys, claimed.data.profiles, directory) : undefined;
  return {
    data: profiles ? { profiles } : undefined,
    isSuccess: Boolean(profiles),
    isFetching: claimed.isFetching || isFetching,
    isError: claimed.isError,
  };
}

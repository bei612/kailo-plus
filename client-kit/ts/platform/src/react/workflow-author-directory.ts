// Host seam for the original WorkflowAuthorPicker. The existing BFF remains the
// sole identity/scope authority; no directory or profile is persisted here.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationParticipant, WorkspaceMemberView } from "@client-kit/contracts";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { useBffClient } from "./context";
import { TransportError } from "../transport";
import { mergeAuthorCandidateSources, type WorkflowAuthorCandidate } from "./workflow-author-candidates";
import { useLoad } from "./use-load";
import type { UserProfileSummary } from "./pulse/host";

const validKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function validPerson(person: ConversationParticipant) {
  return !!person && typeof person.principalId === "string" && !!person.principalId
    && typeof person.displayName === "string" && Array.isArray(person.pubkeys)
    && person.pubkeys.every(validKey);
}
export function useWorkflowAuthorDirectory(workspaceId: string | undefined) {
  const client = useBffClient();
  const [rows, setRows] = useState<WorkflowAuthorCandidate[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberView[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const epoch = useRef(0);
  const busy = useRef(false);
  const cursors = useRef(new Set<string>());
  const load = useCallback(async (cursor?: string) => {
    if (busy.current || !workspaceId) return;
    const generation = epoch.current;
    busy.current = true; setLoading(true); setFailed(false);
    if (!cursor) { setRows([]); setMembers([]); setNextCursor(undefined); cursors.current.clear(); }
    try {
      const [channelMembers, page] = await Promise.all([
        cursor ? Promise.resolve(null) : client.members(workspaceId),
        client.conversationParticipants(cursor),
      ]);
      if (generation !== epoch.current) return;
      if ((channelMembers && (!Array.isArray(channelMembers) || channelMembers.some((member) =>
        !validPerson(member) || !Object.values(WorkspaceMembershipState).includes(member.state))))
        || !page || !Array.isArray(page.items) || page.items.some((person) => !validPerson(person))
        || (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor
          || page.nextCursor === cursor || cursors.current.has(page.nextCursor)))) {
        throw new TransportError("Invalid authorized author directory");
      }
      const activeMembers = channelMembers?.filter((member) => member.state === WorkspaceMembershipState.Active);
      if (activeMembers) setMembers(activeMembers);
      const sources = [...(activeMembers ?? []), ...page.items].flatMap((person) =>
        person.pubkeys.map((pubkey) => ({pubkey, displayName: person.displayName})));
      setRows((previous) => mergeAuthorCandidateSources([cursor ? previous : [], sources]));
      if (page.nextCursor) cursors.current.add(page.nextCursor);
      setNextCursor(page.nextCursor);
    } catch {
      if (generation === epoch.current) { setRows([]); setMembers([]); setNextCursor(undefined); setFailed(true); }
    } finally {
      if (generation === epoch.current) { busy.current = false; setLoading(false); }
    }
  }, [client, workspaceId]);
  const reload = useCallback(() => {
    epoch.current++; busy.current = false;
    void load();
  }, [load]);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => { epoch.current++; busy.current = false; window.removeEventListener("focus", reload); };
  }, [reload]);
  return {rows, members, isLoading: loading, isError: failed, hasNextPage: !!nextCursor,
    isFetchingNextPage: loading && !!nextCursor, fetchNextPage: () => load(nextCursor), refetch: reload};
}
export type WorkflowAuthorDirectory = ReturnType<typeof useWorkflowAuthorDirectory>;

/** Profile enrichment never expands the authorized candidate identities. */
export function useWorkflowAuthorProfiles(workspaceId: string | undefined, pubkeys: string[], directory: WorkflowAuthorDirectory) {
  const client = useBffClient();
  const targets = pubkeys.flatMap((pubkey) => {
    const member = directory.members.find((person) => person.pubkeys.includes(pubkey));
    return member && workspaceId ? [{pubkey, principalId: member.principalId, workspaceId}] : [];
  });
  const [result] = useLoad(JSON.stringify(targets), async () => {
    const rows = await Promise.all(targets.map(async (target) => {
      try {
        const profile = await client.memberProfile(target.workspaceId, target.principalId, target.pubkey);
        return profile?.pubkey === target.pubkey && profile.avatarMediaPaths ? profile : null;
      } catch { return null; }
    }));
    const profiles: Record<string, UserProfileSummary> = {};
    const media: Record<string, string> = {};
    for (const profile of rows) if (profile) {
      profiles[profile.pubkey] = {displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl ?? null, nip05Handle: profile.nip05Handle ?? null, ownerPubkey: null, isAgent: false};
      Object.assign(media, profile.avatarMediaPaths);
    }
    return {profiles, media};
  });
  return {
    profiles: result.status === "ok" ? result.data.profiles : {},
    resolveMediaUrl: (url: string) => result.status === "ok" ? result.data.media[url] : undefined,
  };
}

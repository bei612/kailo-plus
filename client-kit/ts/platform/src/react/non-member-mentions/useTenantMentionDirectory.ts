// DD-125(8): the @ picker's people outside a Workspace channel come from the existing Tenant
// participant directory (`GET /api/v1/conversation-participants`, Tenant `discover`). Agents
// are never taken from it; private conversations never read it.
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "../../client";
import { loadTenantMentionDirectory } from "./nonMemberMentions";

/** Read once per identity scope and reused while fresh; the BFF re-admits every read. */
export const TENANT_MENTION_DIRECTORY_STALE_MS = 30_000;

export function tenantMentionDirectoryQuery(client: Pick<BffClient, "conversationParticipants">, scopeKey: string) {
  return {
    queryKey: ["platform", "tenant-mention-directory", scopeKey] as const,
    queryFn: () => loadTenantMentionDirectory(client),
    staleTime: TENANT_MENTION_DIRECTORY_STALE_MS,
    retry: false,
  };
}

export function useTenantMentionDirectory(client: Pick<BffClient, "conversationParticipants">, scopeKey: string, enabled: boolean) {
  return useQuery({ ...tenantMentionDirectoryQuery(client, scopeKey), enabled });
}

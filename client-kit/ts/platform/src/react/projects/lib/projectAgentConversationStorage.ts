// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectAgentConversationStorage.ts (DD-130(5)).
// The original device-local pointer to the last inline Projects conversation, never its
// content. Kailo pins the conversation to the Installation's bound Workspace channel, so the
// pointer names that Workspace and Installation besides the Agent and the opener event; it
// stays on this device (not CollaborationUserState), as the original never synced it.
const CONVERSATION_STORAGE_PREFIX = "buzz.projects.agentConversation";

/**
 * Identity boundary for Projects conversation pointers and drafts: the surface, the
 * host's tenant-and-identity scope (the original relay URL plus signer pubkey) and the
 * resource. No scope means nothing can be restored or written.
 */
export function projectsConversationScope(surface: string, identityScope: string | null, resource: string): string | null {
  if (!identityScope || !resource) return null;
  return `${surface}:${identityScope}:${resource}`;
}

/** The exact signed opener event of the conversation; its thread holds every follow-up. */
export type ProjectsConversationOpener = {
  eventId: string;
};

export type StoredProjectsAgentConversation = {
  agentPubkey: string;
  channelId: string;
  installationId: string;
  opener: ProjectsConversationOpener;
  workspaceId: string;
};

const HEX64 = /^[0-9a-f]{64}$/;

function scopedKey(prefix: string, scope: string) {
  return `${prefix}.${encodeURIComponent(scope)}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Reads the last inline Projects conversation pointer of this scope. */
export function readStoredProjectsAgentConversation(scope: string | null): StoredProjectsAgentConversation | null {
  if (!scope) return null;
  try {
    const raw = globalThis.localStorage?.getItem(scopedKey(CONVERSATION_STORAGE_PREFIX, scope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredProjectsAgentConversation> | null;
    if (
      !value ||
      typeof value !== "object" ||
      !nonEmpty(value.agentPubkey) || !HEX64.test(value.agentPubkey) ||
      !nonEmpty(value.channelId) ||
      !nonEmpty(value.installationId) ||
      !nonEmpty(value.workspaceId) ||
      !value.opener || typeof value.opener !== "object" ||
      !nonEmpty(value.opener.eventId) || !HEX64.test(value.opener.eventId)
    ) {
      return null;
    }
    return {
      agentPubkey: value.agentPubkey,
      channelId: value.channelId,
      installationId: value.installationId,
      opener: { eventId: value.opener.eventId },
      workspaceId: value.workspaceId,
    };
  } catch {
    return null;
  }
}

/** Saves only the pointer needed to restore the Projects conversation. */
export function writeStoredProjectsAgentConversation(scope: string | null, conversation: StoredProjectsAgentConversation) {
  if (!scope) return;
  try {
    globalThis.localStorage?.setItem(scopedKey(CONVERSATION_STORAGE_PREFIX, scope), JSON.stringify(conversation));
  } catch {
    // Persistence is best-effort; the in-memory conversation remains usable.
  }
}

/** Deletes the saved pointer so no prior conversation is restored; messages stay. */
export function clearStoredProjectsAgentConversation(scope: string | null) {
  if (!scope) return;
  try {
    globalThis.localStorage?.removeItem(scopedKey(CONVERSATION_STORAGE_PREFIX, scope));
  } catch {
    // Persistence is best-effort; the current page still clears immediately.
  }
}

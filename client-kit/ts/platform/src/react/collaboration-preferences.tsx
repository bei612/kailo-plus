// DD-125 personal preference actions shared by the Web and Desktop hosts. Every write
// goes to Core CollaborationUserState through the same CAS queue as read marks
// (use-inbox-state.ts); this module holds no second copy of the authority.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  WorkspaceChannelCreateChannelType,
  SidebarSortMode as SortModeContract,
  WorkspaceVisibility,
  type ChannelTemplateRequest,
} from "@client-kit/contracts";
import type { BffClient } from "../client";
import {
  isNotifiedForThread,
  isPubkeyFollowed,
  isThreadFollowed,
  isThreadMuted,
  movedSectionOrder,
  orderedSidebarSections,
  patchPreferences,
  sidebarSortMode,
  threadPreferenceKey,
  type ChannelTemplateRecord,
  type SidebarSection,
  type SidebarSortGroupKey,
  type SidebarSortMode,
} from "../collaboration-preferences";
import { newIdempotencyKey } from "../governance";
import type { CollaborationUserState } from "../inbox";
import type { useInboxState } from "./use-inbox-state";

type Reads = Pick<ReturnType<typeof useInboxState>, "state" | "pending" | "unknown" | "update">;
export type ChannelTemplateDraft = Omit<ChannelTemplateRecord, "updatedAt">;

export type CollaborationPreferenceActions = {
  state: CollaborationUserState | null;
  /** False while the authority is unread, being written or unknown: controls stay inert. */
  writable: boolean;
  isFollowingThread: (rootId: string) => boolean;
  isThreadMuted: (rootId: string) => boolean;
  isNotifiedForThread: (rootId: string, implicitInterest: boolean) => boolean;
  /** Original handleFollowThread: follow and unmute. */
  followThread: (rootId: string) => Promise<boolean>;
  /** Original handleUnfollowThread: unfollow and mute. */
  unfollowThread: (rootId: string) => Promise<boolean>;
  sections: SidebarSection[];
  assignments: Readonly<Record<string, string>>;
  createSection: (name: string, icon?: string) => Promise<SidebarSection | null>;
  renameSection: (sectionId: string, name: string, icon?: string) => Promise<boolean>;
  deleteSection: (sectionId: string) => Promise<boolean>;
  moveSection: (sectionId: string, direction: "up" | "down") => Promise<boolean>;
  reorderSections: (sectionIds: string[]) => Promise<boolean>;
  assignChannel: (channelId: string, sectionId: string | null) => Promise<boolean>;
  sortModeFor: (group: SidebarSortGroupKey) => SidebarSortMode;
  setSortModeFor: (group: SidebarSortGroupKey, mode: SidebarSortMode) => Promise<boolean>;
  templates: Array<ChannelTemplateRecord & { id: string }>;
  saveTemplate: (templateId: string | null, draft: ChannelTemplateDraft) => Promise<string | null>;
  deleteTemplate: (templateId: string) => Promise<boolean>;
  isFollowing: (pubkey: string) => boolean;
  setFollowing: (pubkey: string, followed: boolean) => Promise<boolean>;
  /** DD-150(3): a Workspace channel's mute; undefined until Core has been read. */
  isWorkspaceMuted: (workspaceId: string) => boolean | undefined;
  /** Writes `workspace_preferences.muted`, keeping the Star Core last returned. */
  setWorkspaceMuted: (workspaceId: string, muted: boolean) => Promise<boolean>;
};

function templateRequest(draft: ChannelTemplateDraft, version: number): ChannelTemplateRequest {
  return {
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    channelType: draft.channelType === "forum" ? WorkspaceChannelCreateChannelType.Forum : WorkspaceChannelCreateChannelType.Stream,
    visibility: draft.visibility === "open" ? WorkspaceVisibility.Open : WorkspaceVisibility.Private,
    ...(draft.canvasTemplate ? { canvasTemplate: draft.canvasTemplate } : {}),
    agentResourceIds: draft.agentResourceIds,
    version,
  };
}

export function useCollaborationPreferenceActions(client: BffClient, reads: Reads): CollaborationPreferenceActions {
  const { state, pending, unknown, update } = reads;
  return useMemo(() => {
    const thread = (rootId: string, followed: boolean) => update(
      (version) => client.setThreadPreference({ threadKey: threadPreferenceKey(rootId), followed, version }),
      (current, now) => ({ ...current, ...patchPreferences.thread(current, rootId, followed, now) }),
    );
    const sections = orderedSidebarSections(state);
    const writeSection = (section: SidebarSection) => update(
      (version) => client.setSidebarSection(section.id, {
        name: section.name, ...(section.icon ? { icon: section.icon } : {}), order: section.order, version,
      }),
      (current, now) => ({ ...current, ...patchPreferences.section(current, section, now) }),
    );
    const reorder = (sectionIds: string[]) => update(
      (version) => client.setSidebarSectionOrder({ sectionIds, version }),
      (current, now) => ({ ...current, ...patchPreferences.order(current, sectionIds, now) }),
    );
    return {
      state,
      writable: state !== null && !pending && !unknown,
      isFollowingThread: (rootId) => isThreadFollowed(state, rootId),
      isThreadMuted: (rootId) => isThreadMuted(state, rootId),
      isNotifiedForThread: (rootId, implicitInterest) => isNotifiedForThread(state, rootId, implicitInterest),
      followThread: (rootId) => thread(rootId, true),
      unfollowThread: (rootId) => thread(rootId, false),
      sections,
      assignments: state?.sidebarSections?.assignments ?? {},
      // Original createSection: a new ID, placed after the last section.
      createSection: async (name, icon) => {
        const order = sections.length > 0 ? Math.max(...sections.map((section) => section.order)) + 1 : 0;
        const section: SidebarSection = { id: newIdempotencyKey(), name: name.trim(), ...(icon?.trim() ? { icon: icon.trim() } : {}), order };
        return (await writeSection(section)) ? section : null;
      },
      renameSection: async (sectionId, name, icon) => {
        const existing = sections.find((section) => section.id === sectionId);
        if (!existing) return false;
        return writeSection({ id: sectionId, name: name.trim(), ...(icon?.trim() ? { icon: icon.trim() } : {}), order: existing.order });
      },
      deleteSection: (sectionId) => update(
        (version) => client.deleteSidebarSection(sectionId, { version }),
        (current, now) => ({ ...current, ...patchPreferences.deleteSection(current, sectionId, now) }),
      ),
      moveSection: async (sectionId, direction) => {
        const order = movedSectionOrder(sections, sectionId, direction);
        return order ? reorder(order) : false;
      },
      reorderSections: reorder,
      assignChannel: (channelId, sectionId) => update(
        (version) => client.setSidebarAssignment({ channelKey: channelId, ...(sectionId ? { sectionId } : {}), version }),
        (current, now) => ({ ...current, ...patchPreferences.assign(current, channelId, sectionId, now) }),
      ),
      sortModeFor: (group) => sidebarSortMode(state, group),
      setSortModeFor: (group, mode) => update(
        (version) => client.setSidebarSort({
          groupKey: group, mode: mode === "recent" ? SortModeContract.Recent : SortModeContract.Alpha, version,
        }),
        (current, now) => ({ ...current, ...patchPreferences.sort(current, group, mode, now) }),
      ),
      templates: Object.entries(state?.channelTemplates ?? {})
        .map(([id, template]) => ({ id, ...template }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
      saveTemplate: async (templateId, draft) => {
        const id = templateId ?? newIdempotencyKey();
        const saved = await update(
          (version) => client.setChannelTemplate(id, templateRequest(draft, version)),
          (current, now) => ({ ...current, ...patchPreferences.template(current, id, { ...draft, updatedAt: now }) }),
        );
        return saved ? id : null;
      },
      deleteTemplate: (templateId) => update(
        (version) => client.deleteChannelTemplate(templateId, { version }),
        (current) => ({ ...current, ...patchPreferences.deleteTemplate(current, templateId) }),
      ),
      isFollowing: (pubkey) => isPubkeyFollowed(state, pubkey),
      // Core resolves the key to its Principal; the follow list is re-read (DD-77).
      setFollowing: (pubkey, followed) => update((version) => client.setFollowedPrincipal({ pubkey, followed, version })),
      isWorkspaceMuted: (workspaceId) => state ? state.workspacePreferences[workspaceId]?.muted ?? false : undefined,
      // Star comes from the same snapshot as the CAS version, never from an older render.
      setWorkspaceMuted: (workspaceId, muted) => update(
        (version, current) => client.setWorkspacePreference(workspaceId, {
          muted, starred: current.workspacePreferences[workspaceId]?.starred ?? false, version,
        }),
        (current, now) => ({ ...current, workspacePreferences: { ...current.workspacePreferences,
          [workspaceId]: { starred: current.workspacePreferences[workspaceId]?.starred ?? false, muted, updatedAt: now } } }),
      ),
    };
  }, [client, state, pending, unknown, update]);
}

const CollaborationPreferencesContext = createContext<CollaborationPreferenceActions | null>(null);

export function CollaborationPreferencesProvider({ value, children }: { value: CollaborationPreferenceActions; children: ReactNode }) {
  return <CollaborationPreferencesContext.Provider value={value}>{children}</CollaborationPreferencesContext.Provider>;
}

/** Null when the host has not provided Core preferences (the original controls stay hidden). */
export function useCollaborationPreferences(): CollaborationPreferenceActions | null {
  return useContext(CollaborationPreferencesContext);
}

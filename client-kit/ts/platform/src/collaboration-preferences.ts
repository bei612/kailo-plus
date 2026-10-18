// DD-125 personal preferences in Core CollaborationUserState (design 03, DD-40).
//
// Buzz 779af8886caae1317b4de962082429867ab61503 kept these per device or per key:
// desktop/src/features/messages/lib/useThreadFollows.ts (500 follows),
// desktop/src/features/channels/unreadMembership.ts (thread mutes),
// desktop/src/features/sidebar/lib/{channelSectionsStorage,channelSortPreference}.ts
// (NIP-44 kind:30078), desktop/src-tauri/src/templates/types.rs (local file) and a
// per-key kind 3 for Pulse follows. Web and Desktop now read and write the one Core
// state with its version CAS; these helpers only shape and patch that projection.

export const MAX_THREAD_PREFERENCES = 500;
export const MAX_CHANNEL_SECTIONS = 100;
export const MAX_CHANNEL_SECTION_ASSIGNMENTS = 1_000;
export const MAX_CHANNEL_SORT_GROUPS = 104;
export const MAX_CHANNEL_TEMPLATES = 200;
export const MAX_CANVAS_TEMPLATE_BYTES = 64 * 1024;

export type ThreadPreferenceState = "FOLLOWED" | "MUTED";
export type ThreadPreference = { state: ThreadPreferenceState; updatedAt: string };
export type SidebarSection = { id: string; name: string; icon?: string; order: number };
export type SidebarSections = {
  sections: SidebarSection[];
  /** Native Buzz channel ID -> section ID (original `assignments`). */
  assignments: Record<string, string>;
  updatedAt?: string;
};
export type SidebarSortMode = "alpha" | "recent";
export type SidebarSortGroupKey = "starred" | "channels" | "forums" | "dms" | `section:${string}`;
export type SidebarSortPreference = { mode: SidebarSortMode; updatedAt: string };
export type ChannelTemplateRecord = {
  name: string;
  description?: string;
  channelType: "stream" | "forum";
  visibility: "open" | "private";
  canvasTemplate?: string;
  /** Same-Tenant AgentDefinition Resource IDs (the original persona entries). */
  agentResourceIds: string[];
  updatedAt: string;
};
export type FollowedPrincipal = { followedAt: string; pubkeys: string[] };

export type CollaborationPreferences = {
  threadPreferences?: Record<string, ThreadPreference>;
  sidebarSections?: SidebarSections;
  sidebarSort?: Record<string, SidebarSortPreference>;
  channelTemplates?: Record<string, ChannelTemplateRecord>;
  followedPrincipals?: Record<string, FollowedPrincipal>;
};

export const EMPTY_SIDEBAR_SECTIONS: SidebarSections = Object.freeze({ sections: [], assignments: {} }) as SidebarSections;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

/** `thread:<root event id>`, the same key space as thread read marks. */
export function threadPreferenceKey(rootId: string): string {
  return `thread:${rootId}`;
}

/** Throws on a shape the Core writer never produces (fail closed, like read marks). */
export function checkCollaborationPreferences(value: CollaborationPreferences): void {
  const fail = () => { throw new Error("Invalid CollaborationUserState preferences"); };
  const { threadPreferences, sidebarSections, sidebarSort, channelTemplates, followedPrincipals } = value;
  if (threadPreferences !== undefined) {
    if (!isRecord(threadPreferences)) fail();
    for (const [key, entry] of Object.entries(threadPreferences)) {
      if (!key.startsWith("thread:") || !HEX64.test(key.slice(7)) || !isRecord(entry) ||
        (entry.state !== "FOLLOWED" && entry.state !== "MUTED") || !isTime(entry.updatedAt)) fail();
    }
  }
  if (sidebarSections !== undefined) {
    if (!isRecord(sidebarSections) || !Array.isArray(sidebarSections.sections) || !isRecord(sidebarSections.assignments)) fail();
    for (const section of sidebarSections.sections) {
      if (!isRecord(section) || typeof section.id !== "string" || !UUID.test(section.id) || typeof section.name !== "string" ||
        (section.icon !== undefined && typeof section.icon !== "string") || !Number.isSafeInteger(section.order)) fail();
    }
    for (const [channel, section] of Object.entries(sidebarSections.assignments)) {
      if (!UUID.test(channel) || typeof section !== "string" || !UUID.test(section)) fail();
    }
  }
  if (sidebarSort !== undefined) {
    if (!isRecord(sidebarSort)) fail();
    for (const entry of Object.values(sidebarSort)) {
      if (!isRecord(entry) || (entry.mode !== "alpha" && entry.mode !== "recent") || !isTime(entry.updatedAt)) fail();
    }
  }
  if (channelTemplates !== undefined) {
    if (!isRecord(channelTemplates)) fail();
    for (const [id, template] of Object.entries(channelTemplates)) {
      if (!UUID.test(id) || !isRecord(template) || typeof template.name !== "string" ||
        (template.channelType !== "stream" && template.channelType !== "forum") ||
        (template.visibility !== "open" && template.visibility !== "private") ||
        (template.description !== undefined && typeof template.description !== "string") ||
        (template.canvasTemplate !== undefined && typeof template.canvasTemplate !== "string") ||
        !Array.isArray(template.agentResourceIds) || template.agentResourceIds.some((agent) => typeof agent !== "string" || !UUID.test(agent))) fail();
    }
  }
  if (followedPrincipals !== undefined) {
    if (!isRecord(followedPrincipals)) fail();
    for (const [principal, entry] of Object.entries(followedPrincipals)) {
      if (!UUID.test(principal) || !isRecord(entry) || !isTime(entry.followedAt) || !Array.isArray(entry.pubkeys) ||
        entry.pubkeys.some((key) => typeof key !== "string" || !HEX64.test(key))) fail();
    }
  }
}

export function threadPreferenceState(state: CollaborationPreferences | null | undefined, rootId: string): ThreadPreferenceState | undefined {
  return state?.threadPreferences?.[threadPreferenceKey(rootId)]?.state;
}

/** Original `useThreadFollows().isFollowing`: an explicit follow only. */
export function isThreadFollowed(state: CollaborationPreferences | null | undefined, rootId: string): boolean {
  return threadPreferenceState(state, rootId) === "FOLLOWED";
}

export function isThreadMuted(state: CollaborationPreferences | null | undefined, rootId: string): boolean {
  return threadPreferenceState(state, rootId) === "MUTED";
}

/**
 * Original `AppShell.tsx::isNotifiedForThread`: not muted, and followed or otherwise
 * of interest (participated, authored or mentioned, as the host observes it).
 */
export function isNotifiedForThread(
  state: CollaborationPreferences | null | undefined,
  rootId: string,
  implicitInterest: boolean,
): boolean {
  return !isThreadMuted(state, rootId) && (isThreadFollowed(state, rootId) || implicitInterest);
}

/** Every ACTIVE pubkey of every followed Principal (DD-77), deduplicated. */
export function followedPubkeys(state: CollaborationPreferences | null | undefined): string[] {
  return [...new Set(Object.values(state?.followedPrincipals ?? {}).flatMap((entry) => entry.pubkeys))];
}

export function isPubkeyFollowed(state: CollaborationPreferences | null | undefined, pubkey: string): boolean {
  return Object.values(state?.followedPrincipals ?? {}).some((entry) => entry.pubkeys.includes(pubkey));
}

/** Sections in their original display order. */
export function orderedSidebarSections(state: CollaborationPreferences | null | undefined): SidebarSection[] {
  return [...(state?.sidebarSections?.sections ?? [])].sort((left, right) => left.order - right.order);
}

export function sidebarSortMode(state: CollaborationPreferences | null | undefined, group: SidebarSortGroupKey): SidebarSortMode {
  return state?.sidebarSort?.[group]?.mode ?? "alpha";
}

export function sectionSortGroupKey(sectionId: string): SidebarSortGroupKey {
  return `section:${sectionId}`;
}

/** Original `swapSectionOrder` expressed as the full new order Core accepts. */
export function movedSectionOrder(sections: readonly SidebarSection[], sectionId: string, direction: "up" | "down"): string[] | null {
  const ordered = [...sections].sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((section) => section.id === sectionId);
  const neighbor = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || neighbor < 0 || neighbor >= ordered.length) return null;
  const ids = ordered.map((section) => section.id);
  [ids[index], ids[neighbor]] = [ids[neighbor]!, ids[index]!];
  return ids;
}

/**
 * Local projections of an acknowledged write (same rule as Core), so the UI keeps
 * the original immediate feel without re-reading the whole state after each ACK.
 */
export const patchPreferences = {
  thread(state: CollaborationPreferences, rootId: string, followed: boolean, now: string): CollaborationPreferences {
    const threads = { ...(state.threadPreferences ?? {}) };
    threads[threadPreferenceKey(rootId)] = { state: followed ? "FOLLOWED" : "MUTED", updatedAt: now };
    const keep = threadPreferenceKey(rootId);
    while (Object.keys(threads).length > MAX_THREAD_PREFERENCES) {
      const oldest = (wanted: ThreadPreferenceState) => Object.entries(threads)
        .filter(([key, entry]) => key !== keep && entry.state === wanted)
        .sort(([leftKey, left], [rightKey, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt) || leftKey.localeCompare(rightKey))[0]?.[0];
      const victim = oldest("FOLLOWED") ?? oldest("MUTED");
      if (!victim) break;
      delete threads[victim];
    }
    return { ...state, threadPreferences: threads };
  },
  section(state: CollaborationPreferences, section: SidebarSection, now: string): CollaborationPreferences {
    const current = state.sidebarSections ?? EMPTY_SIDEBAR_SECTIONS;
    const exists = current.sections.some((existing) => existing.id === section.id);
    const sections = exists ? current.sections.map((existing) => existing.id === section.id ? section : existing) : [...current.sections, section];
    return { ...state, sidebarSections: { ...current, sections, updatedAt: now } };
  },
  deleteSection(state: CollaborationPreferences, sectionId: string, now: string): CollaborationPreferences {
    const current = state.sidebarSections ?? EMPTY_SIDEBAR_SECTIONS;
    const assignments = Object.fromEntries(Object.entries(current.assignments).filter(([, section]) => section !== sectionId));
    const sort = { ...(state.sidebarSort ?? {}) };
    delete sort[sectionSortGroupKey(sectionId)];
    return { ...state, sidebarSort: sort,
      sidebarSections: { sections: current.sections.filter((section) => section.id !== sectionId), assignments, updatedAt: now } };
  },
  order(state: CollaborationPreferences, sectionIds: readonly string[], now: string): CollaborationPreferences {
    const current = state.sidebarSections ?? EMPTY_SIDEBAR_SECTIONS;
    const sections = current.sections.map((section) => {
      const order = sectionIds.indexOf(section.id);
      return order < 0 ? section : { ...section, order };
    });
    return { ...state, sidebarSections: { ...current, sections, updatedAt: now } };
  },
  assign(state: CollaborationPreferences, channelId: string, sectionId: string | null, now: string): CollaborationPreferences {
    const current = state.sidebarSections ?? EMPTY_SIDEBAR_SECTIONS;
    const assignments = { ...current.assignments };
    delete assignments[channelId];
    if (sectionId) assignments[channelId] = sectionId;
    return { ...state, sidebarSections: { ...current, assignments, updatedAt: now } };
  },
  sort(state: CollaborationPreferences, group: SidebarSortGroupKey, mode: SidebarSortMode, now: string): CollaborationPreferences {
    return { ...state, sidebarSort: { ...(state.sidebarSort ?? {}), [group]: { mode, updatedAt: now } } };
  },
  template(state: CollaborationPreferences, id: string, template: ChannelTemplateRecord): CollaborationPreferences {
    return { ...state, channelTemplates: { ...(state.channelTemplates ?? {}), [id]: template } };
  },
  deleteTemplate(state: CollaborationPreferences, id: string): CollaborationPreferences {
    const templates = { ...(state.channelTemplates ?? {}) };
    delete templates[id];
    return { ...state, channelTemplates: templates };
  },
};

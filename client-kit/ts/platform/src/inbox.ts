// Inbox aggregation extracted from Buzz Home (779af8886caae1317b4de962082429867ab61503).
// Hosts supply already admitted events. This module grants no access and holds no user state.
import type { ConversationView } from "@client-kit/contracts";
import type { BffClient } from "./client";
import { translate, type PlatformLocale } from "./i18n";

// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/lib/{inbox,projectInbox}.ts. These are display
// labels, not feed admission: hosts still supply only their authorized events.
type InboxLabelEvent = {
  id: string;
  kind: number;
  content: string;
  tags: string[][];
  category: string;
  channelType?: string;
};

export type InboxTypeLabel = { text: string; channelLabel: string | null };

const PROJECT_ROOT_KINDS = new Set([1618, 1621]);
const PROJECT_ACTIVITY_KINDS = new Set([1, 1619, 1630, 1631, 1632, 1633]);
const REPO_ADDRESS_PATTERN = /^30617:[0-9a-f]{64}:.+$/i;

function projectTagValue(item: Pick<InboxLabelEvent, "tags">, name: string) {
  return item.tags.find(
    (tag) => tag[0] === name && typeof tag[1] === "string" && tag[1].length > 0,
  )?.[1];
}

function getProjectInboxReference(item: InboxLabelEvent) {
  const repoAddress = projectTagValue(item, "a");
  if (!repoAddress || !REPO_ADDRESS_PATTERN.test(repoAddress)) return null;
  if (PROJECT_ROOT_KINDS.has(item.kind)) return { repoAddress, rootId: item.id };
  if (!PROJECT_ACTIVITY_KINDS.has(item.kind)) return null;
  const rootId = projectTagValue(item, "e") ?? projectTagValue(item, "E");
  return rootId ? { repoAddress, rootId } : null;
}

function isProjectInboxItem(item: InboxLabelEvent) {
  return getProjectInboxReference(item) !== null;
}

function projectRootItem(item: InboxLabelEvent, groupItems: readonly InboxLabelEvent[]) {
  return groupItems.find((candidate) => candidate.kind === 1618 || candidate.kind === 1621) ?? item;
}

function projectTypeLabel(item: InboxLabelEvent, locale: PlatformLocale) {
  return translate(locale, item.kind === 1618 ? "inbox.reviewLabel" : item.kind === 1621 ? "inbox.taskLabel" : "inbox.projectUpdate");
}

export function feedHeadline(item: InboxLabelEvent, groupItems: readonly InboxLabelEvent[] = [], locale: PlatformLocale = "en"): string {
  if (isProjectInboxItem(item)) {
    const root = projectRootItem(item, groupItems);
    return (root.tags.find((tag) => tag[0] === "subject")?.[1]?.trim() || root.content.trim().split("\n")[0]) || projectTypeLabel(root, locale);
  }
  switch (item.kind) {
    case 40007: return translate(locale, "inbox.reminderLabel");
    case 43001: return translate(locale, "inbox.jobRequested");
    case 43002: return translate(locale, "inbox.jobAccepted");
    case 43003: return translate(locale, "inbox.progressUpdate");
    case 43004: return translate(locale, "inbox.jobResult");
    case 43005: return translate(locale, "inbox.jobCancelled");
    case 43006: return translate(locale, "inbox.jobFailed");
    case 45001: return translate(locale, "inbox.forumPost");
    case 45003: return translate(locale, "inbox.forumReply");
    case 46010: return translate(locale, "inbox.approvalRequested");
    default:
      return translate(locale, item.category === "mention" ? "inbox.mentionLabel" : item.category === "agent_activity" ? "inbox.agentUpdate" : "inbox.channelUpdate");
  }
}

export function feedPreview(item: Pick<InboxLabelEvent, "content" | "kind">, locale: PlatformLocale = "en"): string {
  const content = item.content.trim();
  if (content.length > 0) return content;
  if (item.kind === 46010) return translate(locale, "inbox.previewApproval");
  if (item.kind === 40007) return translate(locale, "inbox.previewReminder");
  return translate(locale, "inbox.previewEmpty");
}

export function categoryLabelFor(category: string, locale: PlatformLocale = "en"): string {
  return translate(locale, category === "needs_action" ? "inbox.categoryNeedsAction"
    : category === "mention" ? "inbox.mentionLabel"
    : category === "agent_activity" ? "inbox.agentUpdate" : "inbox.categoryActivity");
}

export function isThreadActivityItem(item: Pick<InboxLabelEvent, "category" | "tags">) {
  return item.category === "activity" && inboxReply(item.tags);
}

export function getInboxTypeLabel(item: {
  item: InboxLabelEvent;
  groupItems: readonly InboxLabelEvent[];
  channelLabel: string | null;
  senderLabel: string;
}, locale: PlatformLocale = "en"): InboxTypeLabel {
  const channelName = item.channelLabel;
  if (item.groupItems.some(isProjectInboxItem)) {
    const root = projectRootItem(item.item, item.groupItems);
    return { text: projectTypeLabel(root, locale), channelLabel: null };
  }
  if (item.item.channelType === "dm") {
    return { text: item.senderLabel ? translate(locale, "inbox.dmFrom", { sender: item.senderLabel }) : translate(locale, "inbox.dmLabel"), channelLabel: null };
  }
  const primaryCategory = item.item.category;
  if (primaryCategory === "mention") {
    return { text: translate(locale, channelName ? "inbox.mentionedIn" : "inbox.mentionedLabel"), channelLabel: channelName };
  }
  if (primaryCategory === "needs_action") {
    return { text: translate(locale, channelName ? "inbox.needsActionIn" : "inbox.needsActionLabel"), channelLabel: channelName };
  }
  if (isThreadActivityItem(item.item)) {
    return { text: translate(locale, channelName ? "inbox.threadIn" : "inbox.threadLabel"), channelLabel: channelName };
  }
  const headline = feedHeadline(item.item, [], locale);
  return { text: channelName ? translate(locale, "inbox.activityIn", { activity: headline }) : headline, channelLabel: channelName };
}

/** Original useOwnedAgentPubkeys, resolved from Kailo's existing governed installation directory. */
export async function loadOwnedAgentIdentities(client: Pick<BffClient, "agentInstallations">, workspaceId: string, ownerPrincipalId: string): Promise<ReadonlyMap<string, string>> {
  const keys = new Map<string, string>();
  const rejected = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallations(workspaceId, offset);
    if (!page || !Array.isArray(page.installations)) throw new Error("Invalid Installation directory");
    for (const installation of page.installations) {
      if (installation.workspaceId !== workspaceId) throw new Error("Installation scope mismatch");
      if (installation.ownerPrincipalId !== ownerPrincipalId || installation.state !== "ACTIVE" ||
          installation.resourceState !== "ACTIVE" || installation.agentPrincipalState !== "ACTIVE" ||
          installation.channelBinding?.status !== "ACTIVE" || installation.projection?.state !== "ACTIVE" ||
          installation.projection.generation !== installation.activeProjectionGeneration) {
        rejected.add(installation.resourceId);
        continue;
      }
      if (!installation.agentPubkey || !/^[0-9a-f]{64}$/.test(installation.agentPubkey)) throw new Error("Unverifiable Agent identity");
      const previous = keys.get(installation.resourceId);
      if (previous && previous !== installation.agentPubkey) throw new Error("Agent identity changed during directory read");
      keys.set(installation.resourceId, installation.agentPubkey);
    }
    if (page.nextOffset === undefined || page.nextOffset === null) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Invalid Installation cursor");
    offset = page.nextOffset;
  }
  return new Map([...keys].filter(([id]) => !rejected.has(id)));
}

/** Map Core preference bindings to original Relay channels for notification consumers. */
export function conversationNotificationMutes(
  legacy: ReadonlySet<string>, privateChannelIds: readonly string[],
  conversations: readonly Pick<ConversationView, "id" | "channelId">[],
  preferences: CollaborationUserState["conversationPreferences"],
): ReadonlySet<string> {
  const result = new Set(legacy);
  const bindings = new Map(conversations.map((item) => [item.channelId, item.id]));
  for (const channelId of privateChannelIds) {
    result.delete(channelId);
    const binding = bindings.get(channelId);
    // Missing/fetching projection is not evidence of an unmuted conversation.
    if (!binding || !preferences || preferences[binding]?.muted) result.add(channelId);
  }
  return result;
}
export type InboxEvent = {
  id: string;
  tags: string[][];
  createdAt: number;
  channelId: string | null;
  channelType?: string;
  category: "mention" | "activity";
};

/** NIP-10 marked replies; unmarked e-tags are not invented thread edges. */
export function inboxThread(tags: string[][]) {
  const events = tags.filter(
    (tag) => tag[0] === "e" && typeof tag[1] === "string",
  );
  const reply = [...events].reverse().find((tag) => tag[3] === "reply");
  const parentId = reply?.[1] ?? null;
  return {
    parentId,
    rootId:
      parentId === null
        ? null
        : (events.find((tag) => tag[3] === "root")?.[1] ?? parentId),
  };
}

export function inboxReply(tags: string[][]) {
  return (
    inboxThread(tags).parentId !== null &&
    !tags.some((tag) => tag[0] === "broadcast" && tag[1] === "1")
  );
}

export function inboxConversation(
  item: Pick<InboxEvent, "id" | "tags"> & Partial<Pick<InboxEvent, "channelId" | "channelType">>,
) {
  // Original getInboxConversationId: a DM is one conversation, not one row
  // per NIP-10 root. Hosts derive the type from the admitted directory.
  if (item.channelType === "dm" && item.channelId) return `dm:${item.channelId}`;
  const thread = inboxThread(item.tags);
  return thread.rootId ?? thread.parentId ?? item.id;
}

/** Same event/root IDs in another admitted scope must never merge conversations. */
export function inboxScopeKey(
  item: Pick<InboxEvent, "id" | "tags" | "channelId" | "channelType">,
) {
  return `${item.channelId ?? ""}:${inboxConversation(item)}`;
}

export function aggregateInbox<T extends InboxEvent>(
  feed: { mentions: readonly T[]; activity: readonly T[] },
  getMessageReadAt?: (id: string) => number | null,
  getThreadReadAt?: (root: string, channel?: string | null) => number | null,
  getChannelReadAt?: (channel: string) => number | null,
) {
  const groups = new Map<string, T[]>();
  for (const [category, items] of [
    ["mention", feed.mentions],
    ["activity", feed.activity],
  ] as const) {
    for (const source of items) {
      const item = { ...source, category };
      const key = inboxScopeKey(item);
      const group = groups.get(key) ?? [];
      if (!group.some((existing) => existing.id === item.id)) group.push(item);
      else if (category === "mention")
        group.find((existing) => existing.id === item.id)!.category = category;
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([scopeKey, items]) => {
      const conversationId = inboxConversation(items[0]!);
      const latest = items.reduce((left, right) =>
        right.createdAt > left.createdAt ? right : left,
      );
      const directMessage = latest.channelType === "dm" && latest.channelId !== null;
      const readAt = directMessage
        ? getChannelReadAt?.(latest.channelId!)
        : getThreadReadAt?.(conversationId, latest.channelId);
      const unread = items
        .filter((item) => {
          if (!directMessage && !inboxReply(item.tags)) return false;
          const mark = directMessage ? readAt : getMessageReadAt ? getMessageReadAt(item.id) : readAt;
          return mark !== undefined && item.createdAt > (mark ?? 0);
        })
        .sort((left, right) => left.createdAt - right.createdAt);
      return {
        scopeKey,
        conversationId,
        items,
        item: unread[0] ?? latest,
        latestActivityAt: latest.createdAt,
        unreadCount: unread.length,
        categories: [...new Set(items.map((item) => item.category))].sort(
          (a) => (a === "mention" ? -1 : 1),
        ),
      };
    })
    .sort((a, b) => b.latestActivityAt - a.latestActivityAt);
}

/** Original DM read position is its channel, including threaded messages. */
export function inboxReadContext(item: Pick<InboxEvent, "id" | "tags" | "channelId" | "channelType">) {
  return item.channelType !== "dm" && inboxReply(item.tags) ? `msg:${item.id}` : item.channelId;
}

export function matchesInbox(
  item: {
    categories: readonly string[];
    groupItems: readonly (Pick<InboxEvent, "tags" | "channelType"> & { pubkey?: string })[];
    item?: { pubkey?: string; channelType?: string };
  },
  filter: string,
  ownedAgentPubkeys?: ReadonlySet<string>,
) {
  const thread = item.groupItems.some((event) => inboxReply(event.tags));
  const representative = item.item ?? item.groupItems.at(-1);
  const ownedAgent = representative?.pubkey && ownedAgentPubkeys?.has(representative.pubkey.toLowerCase()) === true;
  if (filter === "agent_activity") return Boolean(ownedAgent);
  if (filter === "all") return representative?.channelType === "dm" || item.categories.includes("mention") || thread || Boolean(ownedAgent);
  if (filter === "thread") return thread;
  return item.categories.includes(filter);
}

// These response shapes already belong to the Core user_state reader (DD-40).
// Unlike ReadMarkRequest they have no generated contract in this baseline.
export type CollaborationUserState = {
  workspacePreferences: Record<
    string,
    { starred: boolean; muted: boolean; updatedAt?: string }
  >;
  conversationPreferences?: Record<string, { starred: boolean; muted: boolean; updatedAt?: string }>;
  projectPreferences?: Record<string, {selected:boolean;updatedAt:string}>;
  readContexts: Record<string, string>;
  version: number;
};

export function checkedUserState(
  value: CollaborationUserState,
): CollaborationUserState {
  if (
    !value ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !value.readContexts ||
    Array.isArray(value.readContexts) ||
    typeof value.readContexts !== "object" ||
    !value.workspacePreferences ||
    typeof value.workspacePreferences !== "object" ||
    Array.isArray(value.workspacePreferences) ||
    (value.projectPreferences!==undefined&&(!value.projectPreferences||typeof value.projectPreferences!=="object"||Array.isArray(value.projectPreferences)||Object.entries(value.projectPreferences).some(([address,entry])=>!/^(30621|30617):[0-9a-f]{64}:.+$/.test(address)||!entry||typeof entry.selected!=="boolean"||typeof entry.updatedAt!=="string"||!Number.isFinite(Date.parse(entry.updatedAt))))) ||
    (value.conversationPreferences !== undefined &&
      (!value.conversationPreferences || typeof value.conversationPreferences !== "object" ||
       Array.isArray(value.conversationPreferences) || Object.values(value.conversationPreferences).some(
         (entry) => !entry || typeof entry.starred !== "boolean" || typeof entry.muted !== "boolean"))) ||
    Object.values(value.readContexts).some(
      (mark) => typeof mark !== "string" || !Number.isFinite(Date.parse(mark)),
    )
  ) {
    throw new Error("Invalid CollaborationUserState");
  }
  return value;
}

export function inboxReadAt(
  state: CollaborationUserState,
  context: string,
): number | null {
  const mark = state.readContexts[context];
  return mark === undefined ? null : Date.parse(mark) / 1000;
}

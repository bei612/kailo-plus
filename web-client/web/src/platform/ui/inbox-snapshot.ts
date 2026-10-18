// The Inbox snapshot: the same admitted reads InboxPane always made (workspace directory,
// first windows, members, owned Agents, DMs, the mention feed and Project work items), shared
// with the shell's Home badge and background notifications so that leaving Inbox does not lose
// them (SS-WEB-RELAY, DD-39). One HTTP read at a time; no browser Relay filter or signer.
import {
  WorkspaceMembershipState,
  type ConversationParticipant,
  type ConversationView,
  type DiscoverableWorkspace,
  type WorkspaceMemberView,
  type WorkspaceView,
} from "@client-kit/contracts";
import type { BffClient } from "@client-kit/platform/client";
import type { CollaborationPreferences } from "@client-kit/platform/collaboration-preferences";
import { aggregateInbox, inboxConversation, inboxReadContext, inboxReply, loadOwnedAgentIdentities } from "@client-kit/platform/inbox";
import { loadChannelDirectory } from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import { reactionThreadInteractionRoots } from "@client-kit/platform/react/messages";
import { loadInboxConversations, type ConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import { loadProjectWorkItems, projectInboxMentions, type ProjectInboxWorkItem, type ProjectsHost } from "@client-kit/platform/react/projects";
import { loadWorkspaceActivity } from "@client-kit/platform/react/workspace-activity";
import { hex, inboxEvents, inboxReactionEvents, inboxWindowEvents, type Event } from "./inbox-events";

type ProjectEvent = ReturnType<typeof projectInboxMentions>[number];
export type InboxEvent = Event | ProjectEvent;

export type InboxSnapshot = {
  scope: object;
  mentions: InboxEvent[];
  activity: InboxEvent[];
  /** Channel thread replies admitted by the original interest rule (authored, replied, mentioned, followed; never muted). */
  interestReplyIds: Set<string>;
  projectItems: ProjectInboxWorkItem[];
  workspaces: WorkspaceView[];
  channelIds: Map<string, string>;
  forumChannels: Set<string>;
  members: Map<string, WorkspaceMemberView[]>;
  agentPubkeys: Set<string>;
  conversations: ConversationView[];
  people: ConversationParticipant[];
  hiddenDm: ReadonlySet<string>;
};

/**
 * DD-125(1) original isNotifiedForThread over the implicit interest roots (authored,
 * replied, mentioned): an explicit Core follow joins the set, a mute leaves it.
 */
export function applyThreadPreferences(roots: Set<string>, threadPreferences: CollaborationPreferences["threadPreferences"]): Set<string> {
  for (const [key, preference] of Object.entries(threadPreferences ?? {})) {
    const rootId = key.slice("thread:".length);
    if (preference.state === "FOLLOWED") roots.add(rootId);
    else roots.delete(rootId);
  }
  return roots;
}

/** The read positions an Inbox projection needs (useInboxState). */
export type InboxReads = {
  readAt: (key: string) => number | null;
  visibleChannels: ReadonlySet<string>;
};

/**
 * Build one Inbox snapshot. Returns null when `isCurrent` reports that a newer load or scope
 * superseded this one; any unverifiable read throws.
 */
export async function loadInboxSnapshot({ client, principalId, visibility, projectsHost, scope: selectionScope, isCurrent, signal, threadPreferences }: {
  client: BffClient;
  /** DD-125(1) Core thread follows/mutes; absent keeps the original implicit interest only. */
  threadPreferences?: CollaborationPreferences["threadPreferences"];
  principalId: string;
  visibility: ConversationVisibilityHost | null;
  projectsHost: ProjectsHost;
  scope: object;
  isCurrent: () => boolean;
  signal: AbortSignal;
}): Promise<InboxSnapshot | null> {
  const workspaces = await client.workspaces();
  if (
    !Array.isArray(workspaces) ||
    new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length
  )
    throw new Error("Invalid Workspace directory");
  const joined = workspaces.filter((workspace) => workspace.isMember === true);
  const conversations = await loadInboxConversations(client, isCurrent);
  if (!isCurrent()) return null;
  const people: ConversationParticipant[] = [];
  if (conversations.length) {
    let cursor: string | undefined; const seen = new Set<string>();
    do {
      const page = await client.conversationParticipants(cursor);
      if (!isCurrent()) return null;
      if (!Array.isArray(page.items)) throw new Error("Invalid Conversation participants");
      people.push(...page.items); cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Participant cursor did not advance");
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  if (conversations.length && !visibility) throw new Error("Conversation visibility unavailable");
  const hiddenDm = conversations[0] ? await visibility!.read(conversations[0]) : new Set<string>();
  // Original channel-list batch (fixed Buzz channels/fetch.rs): one admitted read for every
  // joined channel's first window, keyed by the directory's native channel ID and type.
  const directory = joined.length ? await loadChannelDirectory(client, isCurrent) : [];
  if (!isCurrent()) return null;
  const joinedRows = joined.map((workspace) => directory.find((row) => row.id === workspace.id));
  if (joinedRows.some((row) => row === undefined || row.isMember !== true)) throw new Error("Unverifiable Workspace channel binding");
  const activity = await loadWorkspaceActivity(client, joinedRows as DiscoverableWorkspace[]);
  if (!isCurrent()) return null;
  const next: InboxSnapshot = { scope: selectionScope, interestReplyIds: new Set(), mentions: [], activity: [], projectItems:[], workspaces: joined, channelIds: new Map(), forumChannels: new Set(), members: new Map(), agentPubkeys: new Set(), conversations, people, hiddenDm };
  // One HTTP read at a time. No browser Relay filter, signer or unbounded SSE fan-out.
  for (const workspace of joined) {
    if (!isCurrent()) return null;
    const members = await client.members(workspace.id);
    if (
      !Array.isArray(members) ||
      members.some(
        (member) =>
          typeof member.principalId !== "string" ||
          typeof member.displayName !== "string" ||
          !Array.isArray(member.pubkeys) ||
          member.pubkeys.some((key) => !hex.test(key)),
      )
    )
      throw new Error("Invalid member page");
    const identities = members.filter(
      (member) =>
        member.principalId === principalId && member.state === WorkspaceMembershipState.Active,
    );
    if (identities.length !== 1) throw new Error("Unverifiable own identity");
    const self = identities[0];
    if (
      !self ||
      !Array.isArray(self.pubkeys) ||
      self.pubkeys.length === 0 ||
      self.pubkeys.some((key) => !hex.test(key))
    )
      throw new Error("Unverifiable own identity");
    const own = new Set(self.pubkeys);
    const channel = activity.get(workspace.id);
    if (!channel?.channelId) throw new Error("Unverifiable Workspace channel binding");
    const forum = channel.channelType === "forum";
    if (forum) next.forumChannels.add(workspace.id);
    const page = { events: channel.events };
    // Relay h/bounds use the native Channel ID. Management/profile/navigation
    // keep the existing Workspace key; neither identity is inferred from the other.
    const events = inboxWindowEvents(page.events, channel.channelId, forum)
      .map((event) => ({ ...event, channelId: workspace.id }));
    next.channelIds.set(workspace.id, channel.channelId);
    const mentioned = (event: Event) =>
      event.tags.some((tag) => tag[0] === "p" && own.has(tag[1]));
    // Same upstream interest rule: authored/participated/mentioned roots, not all channel traffic.
    const roots = new Set(
      events
        .filter((event) => own.has(event.pubkey) || mentioned(event))
        .map(inboxConversation),
    );
    const reactionContext = [...events, ...inboxReactionEvents(page.events, channel.channelId)];
    for (const rootId of reactionThreadInteractionRoots(reactionContext, own, channel.channelId)) roots.add(rootId);
    applyThreadPreferences(roots, threadPreferences);
    next.mentions.push(
      ...events
        .filter((event) => !own.has(event.pubkey) && mentioned(event))
        .map((event) => ({ ...event, category: "mention" as const })),
    );
    const interestReplies = events.filter(
      (event) =>
        !own.has(event.pubkey) &&
        inboxReply(event.tags) &&
        roots.has(inboxConversation(event)),
    );
    for (const event of interestReplies) next.interestReplyIds.add(event.id);
    next.activity.push(...interestReplies);
    const agents = await loadOwnedAgentIdentities(client, workspace.id, principalId);
    for (const [installationId, pubkey] of agents) {
      if (!isCurrent()) return null;
      const activity = inboxEvents((await client.workspaceMessages(workspace.id, { agentInstallationId: installationId })).events, channel.channelId)
        .map((event) => ({ ...event, channelId: workspace.id }));
      if (activity.some((event) => event.pubkey !== pubkey)) throw new Error("Unverifiable Agent author");
      next.activity.push(...activity);
      next.agentPubkeys.add(pubkey);
    }
    next.members.set(workspace.id, members);
  }
  for (const conversation of conversations) {
    if (!isCurrent()) return null;
    if (!conversation.participantPrincipalIds.includes(principalId)) throw new Error("Conversation participant changed");
    const self = people.find(person => person.principalId === principalId);
    if (!self?.pubkeys.length || self.pubkeys.some(key => !hex.test(key))) throw new Error("Unverifiable Conversation identity");
    const own = new Set(self.pubkeys);
    const events = inboxWindowEvents((await client.conversationMessages(conversation.id)).events, conversation.channelId).map(event => ({...event, channelType: "dm"}));
    // Original Inbox includes ordinary incoming DMs, not only mentions or
    // replies. Sidebar hidden_at is not loss of read participation.
    const mentioned = (event: Event) => event.tags.some(tag => tag[0] === "p" && own.has(tag[1]));
    next.mentions.push(...events.filter(event => !own.has(event.pubkey) && mentioned(event)).map(event => ({...event,category:"mention" as const})));
    next.activity.push(...events.filter(event => !own.has(event.pubkey)));
  }
  // Original Relay mentions includes Forum comments outside the post
  // timeline. One feed read, not one thread read per post or mention.
  if (joined.length || conversations.length) {
    const page = await client.inboxMentions();
    if (!isCurrent()) return null;
    if (!Array.isArray(page.events)) throw new Error("Invalid Inbox mention feed");
    const scopes = new Map([...next.channelIds].map(([workspaceId, channelId]) => [channelId, {workspaceId, dm: false}]));
    for (const conversation of conversations) scopes.set(conversation.channelId, {workspaceId: conversation.channelId, dm: true});
    for (const value of page.events) {
      if (!value || ![9, 40002, 45001, 45003].includes(value.kind) || !Array.isArray(value.tags)) throw new Error("Invalid Inbox mention kind");
      const channelId = value.tags.find((tag: string[]) => tag[0] === "h")?.[1];
      const scope = scopes.get(channelId);
      if (!scope) continue; // Fresh directory no longer exposes this resource.
      const event = inboxEvents([value], channelId, value.kind)[0];
      const identities = scope.dm ? people : next.members.get(scope.workspaceId) ?? [];
      const own = new Set(identities.filter(member => member.principalId === principalId).flatMap(member => member.pubkeys));
      if (!event.tags.some(tag => tag[0] === "p" && own.has(tag[1]))) throw new Error("Unverifiable Inbox mention recipient");
      if (own.has(event.pubkey)) continue;
      next.mentions.push({...event, channelId: scope.workspaceId, category: "mention",
        ...(next.forumChannels.has(scope.workspaceId) ? {channelType: "forum"} : scope.dm ? {channelType: "dm"} : {})});
    }
  }
  // A scope removed during aggregation cannot survive as a cached row.
  if (!isCurrent()) return null;
  const visible = new Set((await client.workspaces()).filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id));
  const currentConversations = await loadInboxConversations(client, isCurrent);
  next.conversations = next.conversations.filter(item => currentConversations.some(current => current.id === item.id && current.channelId === item.channelId && current.participantPrincipalIds.includes(principalId)));
  next.conversations.forEach(item => visible.add(item.channelId));
  next.mentions = next.mentions.filter((event) => event.channelId!==null&&visible.has(event.channelId));
  next.activity = next.activity.filter((event) => event.channelId!==null&&visible.has(event.channelId));
  next.workspaces = next.workspaces.filter((workspace) => visible.has(workspace.id));
  if (!isCurrent()) return null;
  const projectSnapshot=await loadProjectWorkItems(projectsHost,signal);
  if (!isCurrent()) return null;
  next.projectItems=projectSnapshot.items;
  next.mentions.push(...projectInboxMentions(projectSnapshot));
  return next;
}

/** The original read context of an Inbox item: the native channel ID or its message/thread key. */
export function inboxReadItem(snapshot: InboxSnapshot, event: InboxEvent): InboxEvent {
  if (event.channelId === null) return event;
  const channelId = event.channelType === "dm" ? event.channelId : snapshot.channelIds.get(event.channelId);
  if (!channelId) throw new Error("Unverifiable Inbox read context binding");
  return { ...event, channelId };
}

/** The original Inbox rows over the currently visible channels. */
export function inboxRows(snapshot: InboxSnapshot, reads: InboxReads) {
  return aggregateInbox(
    {
      mentions: snapshot.mentions.filter((event) =>
        event.channelId === null || reads.visibleChannels.has(event.channelId),
      ),
      activity: snapshot.activity.filter((event) =>
        event.channelId === null || reads.visibleChannels.has(event.channelId),
      ),
    },
    (id) => reads.readAt(`msg:${id}`),
    (root) => reads.readAt(`thread:${root}`),
    reads.readAt,
  );
}

/** Rows with an item newer than its read context: the Home badge's Inbox part. */
export function inboxUnreadRowCount(snapshot: InboxSnapshot, rows: ReturnType<typeof inboxRows>, reads: Pick<InboxReads, "readAt">): number {
  return rows.filter((row) =>
    row.items.some((event) => event.createdAt > (reads.readAt(inboxReadContext(inboxReadItem(snapshot, event))!) ?? 0))).length;
}

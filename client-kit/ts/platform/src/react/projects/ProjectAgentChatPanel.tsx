// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectAgentChatPanel.tsx with
// ProjectsAgentPromptPage.tsx::{ConversationThread,useAgentCandidates} and its Agent picker (DD-130).
// The original opened a 1:1 DM with the selected Agent (starting an idle managed Agent first).
// Kailo posts the viewer's message in the selected Installation's bound channel and continues
// in that message's thread; every message is an ordinary @mention admitted by agent.invoke.
// The panel never starts, enables or installs an Agent and never opens an Agent DM.
import { ChevronDown, Trash2 } from "lucide-react";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AgentMentionOutcomeState, type AgentMentionOutcomeView, type WebMessageAttachment } from "@client-kit/contracts";

import { useUiT } from "../context";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import { AgentMentionStatus, type AgentMentionStatusEntry } from "../messages/AgentMentionStatus";
import { UserAvatar } from "../messages/UserAvatar";
import { RightAuxiliaryPane } from "../messages/thread/RightAuxiliaryPane";
import { resolveUserLabel } from "../messages/system/identity";
import { normalizePubkey } from "../conversations/pubkey";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { ForumComposer, usePulseHost, useUsersBatchQuery, type ChannelMember } from "../pulse/host";
import { AgentContextPayloadPreview } from "./AgentContextPayloadPreview";
import { ProjectAgentContextStrip } from "./ProjectAgentContextStrip";
import { ProjectAgentSelectionComposerBanner } from "./ProjectAgentSelectionComposerBanner";
import { ProjectAgentSubmittedContextPill } from "./ProjectAgentSubmittedContextPill";
import { useProjectAgentChatHost, useProjectAgentDirectory, type ProjectAgentChatHost } from "./projectAgentChatHost";
import {
  pickDefaultProjectsAgent,
  restoreProjectsAgentConversation,
  submitProjectAgentMessage,
  visibleConversationMessages,
  type ProjectAgentCandidate,
  type ProjectAgentConversation,
} from "./lib/projectAgentConversation";
import {
  clearStoredProjectsAgentConversation,
  projectsConversationScope,
  readStoredProjectsAgentConversation,
  writeStoredProjectsAgentConversation,
  type StoredProjectsAgentConversation,
} from "./lib/projectAgentConversationStorage";
import {
  projectDetailAgentContextBlock,
  splitProjectDetailAgentContext,
  type ProjectDetailAgentContext,
} from "./lib/projectDetailAgentContext";
import { formatExactTimestamp, relativeTime } from "./lib/projectsViewHelpers";

/** Live thread refresh while the panel is open; the read is the host's bounded thread read. */
const CONVERSATION_REFRESH_MS = 5_000;
/** DD-121: outcomes of recent own messages are polled; older ones without a row show nothing. */
const MENTION_POLL_MS = 4_000;
const MENTION_PENDING_WINDOW_SECONDS = 600;
const MENTION_QUERY_LIMIT = 50;

type PendingSend = { key: string; content: string; installationId: string; parentEventId: string | null };

export function ProjectAgentChatPanel({
  canResetWidth = false,
  constrainToAvailableSpace = true,
  context,
  detached = false,
  onClose,
  onResetWidth,
  onResizeStart,
  sharedHeaderBackdrop,
  widthPx = 0,
}: {
  canResetWidth?: boolean;
  constrainToAvailableSpace?: boolean;
  context: ProjectDetailAgentContext;
  detached?: boolean;
  onClose?: () => void;
  onResetWidth?: () => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  sharedHeaderBackdrop?: boolean;
  widthPx?: number;
}) {
  const host = useProjectAgentChatHost();
  if (!host) return null;
  return (
    <RightAuxiliaryPane
      canResetWidth={canResetWidth}
      constrainToAvailableSpace={constrainToAvailableSpace}
      detached={detached}
      onResetWidth={onResetWidth ?? (() => {})}
      onResizeStart={onResizeStart ?? (() => {})}
      testId="project-agent-chat-panel"
      widthPx={widthPx}
    >
      {/* Remount per identity and resource: a pointer or draft never crosses that boundary. */}
      <ProjectAgentChatBody
        context={context}
        detached={detached}
        host={host}
        key={`${host.identityScope}:${context.repoAddress}`}
        onClose={onClose}
        sharedHeaderBackdrop={sharedHeaderBackdrop}
      />
    </RightAuxiliaryPane>
  );
}

function ProjectAgentChatBody({ context, detached, host, onClose, sharedHeaderBackdrop }: {
  context: ProjectDetailAgentContext;
  detached: boolean;
  host: ProjectAgentChatHost;
  onClose?: () => void;
  sharedHeaderBackdrop?: boolean;
}) {
  const t = useUiT();
  const cache = useQueryClient();
  const storageScope = projectsConversationScope("detail", host.identityScope, context.repoAddress);
  const [storedConversation, setStoredConversation] = React.useState<StoredProjectsAgentConversation | null>(
    () => readStoredProjectsAgentConversation(storageScope));
  const [conversation, setConversation] = React.useState<ProjectAgentConversation | null>(null);
  const [selectedInstallationId, setSelectedInstallationId] = React.useState<string | null>(
    () => storedConversation?.installationId ?? null);
  const [isSending, setIsSending] = React.useState(false);
  const sending = React.useRef(false);
  const pending = React.useRef<PendingSend | null>(null);
  const lifetime = React.useMemo(() => ({ active: true }), []);
  React.useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);

  const directory = useProjectAgentDirectory(host);
  const candidates = directory.data?.candidates ?? [];
  const restorable = React.useMemo(
    () => directory.data ? restoreProjectsAgentConversation({ stored: storedConversation, candidates: directory.data.candidates }) : null,
    [directory.data, storedConversation],
  );
  React.useEffect(() => {
    if (conversation || !restorable) return;
    setConversation(restorable);
    setSelectedInstallationId(restorable.agent.installationId);
  }, [conversation, restorable]);

  const selectedAgent = conversation?.agent
    ?? candidates.find(candidate => candidate.installationId === selectedInstallationId)
    ?? pickDefaultProjectsAgent(candidates);
  const members = React.useMemo<ChannelMember[] | undefined>(() => {
    if (!selectedAgent) return undefined;
    return (directory.data?.membersByWorkspace.get(selectedAgent.workspaceId) ?? []).flatMap(member =>
      member.pubkeys.map(pubkey => ({ pubkey, role: "member", isAgent: false, joinedAt: "", displayName: member.displayName })));
  }, [directory.data, selectedAgent]);
  const candidateProfiles = useUsersBatchQuery(candidates.map(candidate => candidate.pubkey), { enabled: candidates.length > 0 });
  const avatarUrlFor = React.useCallback(
    (pubkey: string) => candidateProfiles.data?.profiles[normalizePubkey(pubkey)]?.avatarUrl ?? null,
    [candidateProfiles.data],
  );
  // Computed once per context so the pre-send preview and the appended payload are
  // byte-identical: the viewer inspects exactly what is signed under their key.
  const contextPayload = React.useMemo(() => projectDetailAgentContextBlock(context), [context]);

  const handleSubmit = React.useCallback(async (content: string, mentions: string[], attachments?: WebMessageAttachment[]) => {
    if (attachments && attachments.length > 0) {
      toast.error(t("projects.agentChat.attachmentsUnavailable"));
      throw new Error("Project Agent chat sends text only");
    }
    const trimmed = content.trim();
    if (!trimmed || !selectedAgent || sending.current) return;
    sending.current = true;
    setIsSending(true);
    const fullContent = `${trimmed}${contextPayload}`;
    const parentEventId = conversation?.opener.eventId ?? null;
    // DD-81: an unknown outcome keeps its key; the same message again only reconciles it.
    const previous = pending.current;
    const key = previous && previous.content === fullContent && previous.installationId === selectedAgent.installationId
      && previous.parentEventId === parentEventId ? previous.key : newIdempotencyKey();
    pending.current = { key, content: fullContent, installationId: selectedAgent.installationId, parentEventId };
    try {
      const sent = await submitProjectAgentMessage({
        agent: selectedAgent,
        conversation,
        content: fullContent,
        mentionPubkeys: mentions,
        send: request => host.send(request, key),
      });
      pending.current = null;
      if (!lifetime.active) return;
      if (!conversation) {
        // Anchor the conversation to the exact accepted opener event.
        const opener = { eventId: sent.eventId };
        const stored: StoredProjectsAgentConversation = {
          agentPubkey: selectedAgent.pubkey,
          channelId: selectedAgent.channelId,
          installationId: selectedAgent.installationId,
          opener,
          workspaceId: selectedAgent.workspaceId,
        };
        setConversation({ agent: selectedAgent, opener });
        setStoredConversation(stored);
        writeStoredProjectsAgentConversation(storageScope, stored);
      }
      void cache.invalidateQueries({ queryKey: ["projects", "agent-chat-conversation", host.identityScope] });
    } catch (error) {
      if (!isOutcomeUnknown(error)) pending.current = null;
      if (lifetime.active) toast.error(t(isOutcomeUnknown(error) ? "projects.agentChat.sendUnknown" : "projects.agentChat.sendFailed"));
      throw error;
    } finally {
      sending.current = false;
      if (lifetime.active) setIsSending(false);
    }
  }, [cache, contextPayload, conversation, host, lifetime, selectedAgent, storageScope, t]);

  const handleClear = React.useCallback(() => {
    clearStoredProjectsAgentConversation(storageScope);
    pending.current = null;
    setStoredConversation(null);
    setConversation(null);
  }, [storageScope]);

  const directoryPending = directory.isPending || directory.isFetching;
  const emptyState = directory.isError && !directory.isFetching ? (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 text-center" role="alert">
      <p className="text-sm font-medium text-foreground">{t("projects.agentChat.loadFailed")}</p>
      <Button onClick={() => { void directory.refetch(); }} size="sm" type="button" variant="outline">{t("projects.agentChat.retry")}</Button>
    </div>
  ) : directoryPending && !conversation ? (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-muted-foreground" role="status">
      {t("projects.agentChat.loading")}
    </div>
  ) : candidates.length === 0 && !conversation ? (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium text-foreground">{t("projects.agentChat.noAgents")}</p>
      <p className="max-w-72 text-xs text-muted-foreground">{t("projects.agentChat.noAgentsHint")}</p>
    </div>
  ) : (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-medium text-foreground">{t("projects.agentChat.askTitle")}</p>
      <p className="max-w-72 text-xs text-muted-foreground">{t("projects.agentChat.askHint")}</p>
    </div>
  );

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", detached && "bg-background")}>
      <ProjectAgentContextStrip context={context} onClose={onClose} sharedBackdrop={sharedHeaderBackdrop} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-4 pt-[4.25rem]"
          data-testid="project-agent-conversation-scroll">
          {conversation ? (
            <ConversationThread agent={conversation.agent} agentAvatarUrl={avatarUrlFor(conversation.agent.pubkey)}
              host={host} opener={conversation.opener} />
          ) : emptyState}
        </div>
        {context.selection?.length ? <ProjectAgentSelectionComposerBanner items={context.selection} /> : null}
        <div className="px-3 pb-3">
          <div className="flex min-w-0 items-center gap-1 pb-1.5" data-testid="project-agent-composer-toolbar">
            <ProjectAgentPicker avatarUrlFor={avatarUrlFor} candidates={candidates} disabled={conversation !== null || isSending}
              onSelect={setSelectedInstallationId} selected={selectedAgent} />
            <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground" data-testid="project-agent-channel-notice">
              {selectedAgent ? t("projects.agentChat.channelNotice", { channel: selectedAgent.channelName }) : null}
            </span>
            {selectedAgent ? <AgentContextPayloadPreview channelName={selectedAgent.channelName} iconOnly payload={contextPayload}
              triggerLabel={t("projects.agentChat.preview")} /> : null}
            {conversation ? (
              <Button aria-label={t("projects.agentChat.clearLabel")} className="h-7 w-7" onClick={handleClear} size="icon"
                title={t("projects.agentChat.clear")} type="button" variant="ghost">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <ForumComposer
            className="border border-border/60 bg-background/45"
            compact
            disabled={!selectedAgent || isSending}
            isSending={isSending}
            members={members}
            onSubmit={handleSubmit}
            placeholder={selectedAgent ? t("projects.agentChat.placeholder", { name: selectedAgent.name }) : t("projects.agentChat.noAgents")}
          />
        </div>
      </div>
    </div>
  );
}

/** Original ProjectsAgentPromptPage Agent picker; Kailo also names the bound channel. */
function ProjectAgentPicker({ avatarUrlFor, candidates, disabled, onSelect, selected }: {
  avatarUrlFor: (pubkey: string) => string | null;
  candidates: readonly ProjectAgentCandidate[];
  disabled: boolean;
  onSelect: (installationId: string) => void;
  selected: ProjectAgentCandidate | null;
}) {
  const t = useUiT();
  const locked = disabled || candidates.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("projects.agentChat.pickAgent")}
          className="h-7 max-w-48 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
          data-testid="projects-agent-picker"
          disabled={locked}
          size="sm"
          type="button"
          variant="ghost"
        >
          {selected ? <UserAvatar accent avatarUrl={avatarUrlFor(selected.pubkey)} className="shrink-0" displayName={selected.name}
            shape="squircle" size="xs" /> : null}
          <span className="min-w-0 truncate">{selected?.name ?? t("projects.agentChat.noAgents")}</span>
          {locked ? null : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup onValueChange={onSelect} value={selected?.installationId ?? ""}>
          {candidates.map(candidate => (
            <DropdownMenuRadioItem key={candidate.installationId} value={candidate.installationId}>
              <UserAvatar accent avatarUrl={avatarUrlFor(candidate.pubkey)} className="mr-2 shrink-0" displayName={candidate.name}
                shape="squircle" size="xs" />
              <span className="min-w-0 truncate">{t("projects.agentChat.agentInChannel", { name: candidate.name, channel: candidate.channelName })}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Original ConversationThread: the opener and its thread only (never the rest of the shared
 * channel), with the viewer's machine-appended context folded into a disclosure and the
 * DD-121 admission state under the viewer's own messages.
 */
function ConversationThread({ agent, agentAvatarUrl, host, opener }: {
  agent: ProjectAgentCandidate;
  agentAvatarUrl: string | null;
  host: ProjectAgentChatHost;
  opener: ProjectAgentConversation["opener"];
}) {
  const t = useUiT();
  const pulse = usePulseHost();
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const viewer = normalizePubkey(host.viewerPubkey);
  const query = useQuery({
    queryKey: ["projects", "agent-chat-conversation", host.identityScope, agent.workspaceId, agent.channelId, opener.eventId],
    retry: false,
    refetchInterval: CONVERSATION_REFRESH_MS,
    queryFn: ({ signal }) => host.readConversation({ workspaceId: agent.workspaceId, channelId: agent.channelId }, opener.eventId, signal),
  });
  const events = React.useMemo(() => visibleConversationMessages(query.data ?? [], opener), [query.data, opener]);
  const authors = React.useMemo(() => [...new Set(events.map(event => normalizePubkey(event.pubkey)))]
    .filter(pubkey => pubkey !== normalizePubkey(agent.pubkey)), [events, agent.pubkey]);
  const profiles = useUsersBatchQuery(authors, { enabled: authors.length > 0 }).data?.profiles;
  const ownIds = React.useMemo(() => events.filter(event => normalizePubkey(event.pubkey) === viewer)
    .slice(-MENTION_QUERY_LIMIT).map(event => event.id).sort(), [events, viewer]);
  const newestOwn = events.filter(event => normalizePubkey(event.pubkey) === viewer).at(-1)?.created_at ?? 0;
  const outcomes = useQuery({
    queryKey: ["projects", "agent-chat-outcomes", host.identityScope, agent.workspaceId, ownIds],
    enabled: Boolean(host.mentionOutcomes) && ownIds.length > 0,
    retry: false,
    queryFn: () => host.mentionOutcomes!(agent.workspaceId, ownIds),
    refetchInterval: current => {
      const rows = current.state.data?.outcomes ?? [];
      const open = ownIds.some(id => {
        const row = rows.find(outcome => outcome.eventId === id && outcome.installationId === agent.installationId);
        return !row || row.state === AgentMentionOutcomeState.Running;
      });
      return open && Date.now() / 1_000 - newestOwn < MENTION_PENDING_WINDOW_SECONDS ? MENTION_POLL_MS : false;
    },
  });
  const statusFor = (eventId: string, createdAt: number): AgentMentionStatusEntry[] | undefined => {
    if (!host.mentionOutcomes || !outcomes.isSuccess) return undefined;
    const row: AgentMentionOutcomeView | undefined = outcomes.data.outcomes.find(outcome =>
      outcome.eventId === eventId && outcome.installationId === agent.installationId);
    if (!row && Date.now() / 1_000 - createdAt >= MENTION_PENDING_WINDOW_SECONDS) return undefined;
    return [{ key: agent.installationId, name: agent.name, state: row?.state ?? "PENDING", reasonCode: row?.reasonCode }];
  };
  const lastId = events.at(-1)?.id ?? null;
  React.useEffect(() => {
    if (lastId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  if (query.isError && !query.data) {
    return <p className="px-4 text-sm text-muted-foreground" role="alert">{t("projects.agentChat.conversationFailed")}</p>;
  }
  return (
    <div data-project-agent-channel-id={agent.channelId} data-testid="project-agent-conversation">
      {events.map(event => {
        const author = normalizePubkey(event.pubkey);
        const own = author === viewer;
        const isAgent = author === normalizePubkey(agent.pubkey);
        const split = own ? splitProjectDetailAgentContext(event.content) : { context: null, message: event.content };
        const name = isAgent ? agent.name : resolveUserLabel({ pubkey: event.pubkey, currentPubkey: host.viewerPubkey, profiles, t });
        const avatarUrl = isAgent ? agentAvatarUrl : profiles?.[author]?.avatarUrl ?? null;
        const status = own ? statusFor(event.id, event.created_at) : undefined;
        return (
          <div data-testid="project-agent-message" data-author={isAgent ? "agent" : own ? "self" : "member"} key={event.id}>
            <div className="flex min-w-0 gap-3 px-3 py-1.5">
              <UserAvatar avatarUrl={avatarUrl} className="mt-0.5 shrink-0" displayName={name} shape={isAgent ? "squircle" : "circle"} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                  <time className="shrink-0 text-2xs text-muted-foreground" dateTime={new Date(event.created_at * 1_000).toISOString()}
                    title={formatExactTimestamp(event.created_at)}>{relativeTime(event.created_at)}</time>
                </div>
                <div className="min-w-0 break-words text-sm text-foreground">{pulse.renderContent(split.message, event.tags)}</div>
                {status ? <AgentMentionStatus entries={status} /> : null}
              </div>
            </div>
            {split.context ? <ProjectAgentSubmittedContextPill payload={split.context} /> : null}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

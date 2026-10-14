// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowMessagePicker.tsx::WorkflowMessagePicker/MessageOption.
// History, search and exact lookup cross the WorkflowMessageHost seam; each
// event is validated against the admitted workflow channel before display.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Search } from "lucide-react";
import * as React from "react";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Input } from "./composer/shared/ui/input";
import { UserAvatar } from "./messages/UserAvatar";
import { resolveUserLabel } from "./messages/system/identity";
import type { UserProfileSummary } from "./pulse/host";
import { parseChannelWindowResponse, type ChannelWindowCursor } from "./forum/channelWindowResponse";
import { useLocale, useT } from "./context";
import { useWorkflowAuthorProfiles, type WorkflowAuthorDirectory } from "./workflow-author-directory";
import {
  mergeMessageCandidateSources,
  normalizeMessageEventId,
  type WorkflowMessageCandidate,
  validatedWorkflowMessageCandidate,
  validateWorkflowMessageSearchResults,
} from "./workflow-message-candidates";
import { useWorkflowMessageHost, type WorkflowMessageScope } from "./workflow-message-host";

const PAGE_SIZE = 25;

export function WorkflowMessagePicker({ directory, disabled, id, onChange, onEscape, scope, value }: {
  directory: WorkflowAuthorDirectory;
  disabled?: boolean;
  id: string;
  onChange: (messageId: string) => void;
  onEscape?: () => void;
  scope: WorkflowMessageScope | null;
  value: string;
}) {
  const t = useT();
  const host = useWorkflowMessageHost();
  const channelId = host ? scope?.channelId ?? null : null;
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const trimmedQuery = query.trim();
  const deferredQuery = React.useDeferredValue(trimmedQuery);
  const normalizedQuery = deferredQuery.toLowerCase();
  const selectedId = normalizeMessageEventId(value);
  const directId = normalizeMessageEventId(query);
  const lookupId = directId ?? selectedId;

  const historyQuery = useInfiniteQuery({
    enabled: Boolean(host && scope),
    initialPageParam: null as ChannelWindowCursor | null,
    queryKey: ["workflow-message-picker", scope?.workspaceId, channelId],
    queryFn: async ({ pageParam }) => {
      if (!host || !scope) throw new Error("Choose a channel first.");
      return parseChannelWindowResponse(await host.history(scope, pageParam, PAGE_SIZE), scope.channelId, pageParam);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const searchQuery = useQuery({
    enabled: Boolean(host && scope && normalizedQuery && !directId),
    queryKey: ["workflow-message-picker-search", scope?.workspaceId, channelId, deferredQuery],
    queryFn: () => host!.search(scope!, deferredQuery, 30),
    retry: false,
    staleTime: 30_000,
  });
  const exactQuery = useQuery({
    enabled: Boolean(host && scope && lookupId),
    queryKey: ["workflow-message-picker-exact", scope?.workspaceId, channelId, lookupId],
    queryFn: () => host!.event(scope!, lookupId ?? ""),
    retry: false,
    staleTime: 60_000,
  });

  const selectedFallback = selectedId ? [{ id: selectedId, pubkey: null, content: null, createdAt: null }] : [];
  const directFallback = directId ? [{ id: directId, pubkey: null, content: null, createdAt: null }] : [];
  const historyCandidates = React.useMemo(() => (historyQuery.data?.pages ?? []).flatMap((page) =>
    page.rows.flatMap(({ event }) => {
      const candidate = channelId ? validatedWorkflowMessageCandidate(event, { channelId }) : null;
      return candidate ? [candidate] : [];
    })), [channelId, historyQuery.data?.pages]);
  const searchCandidates = channelId ? validateWorkflowMessageSearchResults(searchQuery.data ?? [], channelId) : [];
  const exactCandidate = React.useMemo(() => {
    if (!channelId || !lookupId) return null;
    return validatedWorkflowMessageCandidate(exactQuery.data, { channelId, requestedId: lookupId });
  }, [channelId, exactQuery.data, lookupId]);
  // Preserve the relay-provided history/search order. Exact lookups and raw-ID
  // fallbacks only fill gaps; selecting an existing row must not move it.
  const allCandidates = mergeMessageCandidateSources([
    historyCandidates, searchCandidates, exactCandidate ? [exactCandidate] : [], selectedFallback, directFallback,
  ]);
  const visibleCandidates = directId ? allCandidates.filter(({ id }) => id === directId)
    : !normalizedQuery ? allCandidates
    : allCandidates.filter((candidate) => candidate.id.includes(normalizedQuery)
      || candidate.content?.toLowerCase().includes(normalizedQuery));
  const profilePubkeys = [...new Set(visibleCandidates.flatMap(({ pubkey }) => (pubkey ? [pubkey] : [])))];
  const profiles = useWorkflowAuthorProfiles(scope?.workspaceId, profilePubkeys, directory);
  const listId = `${id}-list`;

  React.useEffect(() => {
    if (activeIndex !== null && activeIndex >= visibleCandidates.length) {
      setActiveIndex(visibleCandidates.length > 0 ? visibleCandidates.length - 1 : null);
    }
  }, [activeIndex, visibleCandidates.length]);
  React.useEffect(() => {
    if (activeIndex === null) return;
    const candidate = visibleCandidates[activeIndex];
    if (!candidate) return;
    optionRefs.current.get(candidate.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, visibleCandidates]);

  const loading = (historyQuery.isLoading || searchQuery.isFetching || exactQuery.isFetching) && visibleCandidates.length === 0;
  const failed = historyQuery.isError || searchQuery.isError || exactQuery.isError;
  const invalidDirectResult = Boolean(directId && lookupId === directId && exactQuery.isSuccess && !exactCandidate);

  return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/35"
    data-testid="workflow-message-picker">
    <div className="relative shrink-0 border-b border-border/70">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-activedescendant={activeIndex !== null && visibleCandidates[activeIndex] ? `${listId}-${visibleCandidates[activeIndex].id}` : undefined}
        aria-controls={listId}
        aria-label={t("workflows.messagePicker.search")}
        aria-expanded="true"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        className="h-11 rounded-none border-0 bg-transparent pl-9 focus-visible:ring-0"
        data-workflow-filter-picker-search="true"
        disabled={disabled || !channelId}
        id={id}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(null); }}
        onKeyDown={(event) => {
          const currentQuery = event.currentTarget.value.trim();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (visibleCandidates.length > 0) {
              setActiveIndex((current) => ((current ?? -1) + (event.key === "ArrowDown" ? 1 : -1)
                + visibleCandidates.length) % visibleCandidates.length);
            }
          } else if (event.key === "Enter") {
            const currentDirectId = normalizeMessageEventId(currentQuery);
            if (currentQuery !== deferredQuery && !currentDirectId) return;
            const candidate = currentDirectId ? allCandidates.find(({ id }) => id === currentDirectId)
              : visibleCandidates[activeIndex ?? 0];
            if (!candidate) return;
            event.preventDefault();
            if (invalidDirectResult) return;
            onChange(candidate.id === selectedId ? "" : candidate.id);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (query) { setQuery(""); setActiveIndex(null); } else onEscape?.();
          }
        }}
        placeholder={channelId ? t("workflows.messagePicker.placeholder") : t("workflows.messagePicker.chooseChannel")}
        role="combobox"
        spellCheck={false}
        value={query}
      />
      {historyQuery.isFetching || searchQuery.isFetching || exactQuery.isFetching ? <LoaderCircle
        aria-label={t("workflows.messagePicker.loading")}
        className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
    </div>
    {invalidDirectResult ? <p className="shrink-0 border-b border-border/70 px-3 py-2 text-xs text-destructive">
      {t("workflows.messagePicker.unavailable")}
    </p> : null}
    <div aria-label={t("workflows.messagePicker.messages")}
      className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2"
      data-testid="workflow-message-picker-results" id={listId}
      onScroll={(event) => {
        const list = event.currentTarget;
        if (!normalizedQuery && list.scrollHeight - list.scrollTop - list.clientHeight < 64
          && historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) void historyQuery.fetchNextPage();
      }}
      role="listbox">
      {visibleCandidates.map((candidate, index) => <MessageOption
        active={activeIndex !== null && index === activeIndex}
        candidate={candidate}
        disabled={disabled}
        fallbackName={candidate.pubkey ? directory.rows.find((row) => row.pubkey === candidate.pubkey)?.displayName : undefined}
        id={`${listId}-${candidate.id}`}
        key={candidate.id}
        onSelect={() => {
          setActiveIndex(null);
          if (!invalidDirectResult) onChange(candidate.id === selectedId ? "" : candidate.id);
        }}
        optionRef={(node) => {
          if (node) optionRefs.current.set(candidate.id, node);
          else optionRefs.current.delete(candidate.id);
        }}
        profiles={profiles.profiles}
        resolveMediaUrl={profiles.resolveMediaUrl}
        selected={candidate.id === selectedId} />)}
      {loading ? <p className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="h-4 w-4 animate-spin" /> {t("workflows.messagePicker.loadingMessages")}
      </p> : visibleCandidates.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        {failed ? t("workflows.messagePicker.failed") : normalizedQuery ? t("workflows.messagePicker.none") : t("workflows.messagePicker.empty")}
      </p> : null}
      {failed ? <button className="w-full rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/45 hover:text-foreground"
        onClick={() => { void historyQuery.refetch(); void searchQuery.refetch(); void exactQuery.refetch(); }} type="button">
        {t("workflows.messagePicker.retry")}
      </button> : null}
      {!normalizedQuery && historyQuery.hasNextPage ? <button
        className="w-full rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/45 hover:text-foreground"
        disabled={disabled || historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()} type="button">
        {historyQuery.isFetchingNextPage ? t("workflows.messagePicker.loadingOlder") : t("workflows.messagePicker.loadOlder")}
      </button> : null}
    </div>
  </div>;
}

function MessageOption({ active, candidate, disabled, fallbackName, id, onSelect, optionRef, profiles, resolveMediaUrl, selected }: {
  active: boolean;
  candidate: WorkflowMessageCandidate;
  disabled?: boolean;
  fallbackName?: string | null;
  id: string;
  onSelect: () => void;
  optionRef: (node: HTMLButtonElement | null) => void;
  profiles: Record<string, UserProfileSummary>;
  resolveMediaUrl: (url: string) => string | undefined;
  selected: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const author = candidate.pubkey
    ? resolveUserLabel({ profiles, pubkey: candidate.pubkey, fallbackName, t })
    : t("workflows.messagePicker.selected");
  const profile = candidate.pubkey ? profiles[candidate.pubkey.toLowerCase()] : undefined;
  const timestamp = candidate.createdAt === null ? null : new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(candidate.createdAt * 1_000));
  const normalized = candidate.content?.trim().replaceAll(/\s+/g, " ") ?? "";
  const body = !normalized ? t("workflows.messagePicker.noBody")
    : normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
  return <button aria-selected={selected}
    className={cn("relative flex min-w-0 w-full items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2.5 text-left transition-colors",
      selected ? "border-foreground/40 bg-muted/70" : "border-transparent hover:border-border hover:bg-muted/45",
      active && "ring-1 ring-ring")}
    disabled={disabled} id={id} onClick={onSelect} ref={optionRef} role="option" tabIndex={-1} type="button">
    {candidate.pubkey ? <UserAvatar avatarUrl={profile?.avatarUrl ?? null} resolveMediaUrl={resolveMediaUrl}
      displayName={author} shape={profile?.isAgent === true ? "squircle" : "circle"} size="sm" /> : null}
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{author}</span>
        {timestamp ? <span className="ml-auto shrink-0">{timestamp}</span> : null}
      </span>
      <span className="mt-1 block min-w-0 break-words text-sm leading-5 text-foreground [overflow-wrap:anywhere]">{body}</span>
      <span className="mt-1 block font-mono text-2xs text-muted-foreground">{candidate.id.slice(0, 12)}…{candidate.id.slice(-8)}</span>
    </span>
    <Check className={cn("mt-1 h-4 w-4 shrink-0", !selected && "opacity-0")} />
  </button>;
}

/** Original useWorkflowTriggerPresentation message lookup for a trigger_message_id condition. */
export function useWorkflowTriggerMessage(messageId: string | null, scope: WorkflowMessageScope | null) {
  const host = useWorkflowMessageHost();
  const enabled = Boolean(host && scope && messageId);
  const query = useQuery({
    enabled,
    queryKey: ["workflow-trigger-message", scope?.workspaceId, scope?.channelId, messageId],
    queryFn: () => host!.event(scope!, messageId!),
    retry: false,
    staleTime: 60_000,
  });
  const message = scope && messageId
    ? validatedWorkflowMessageCandidate(query.data, { channelId: scope.channelId, requestedId: messageId }) : null;
  return { messageLabel: message?.content?.trim() || null, messageLoading: enabled && query.isPending };
}

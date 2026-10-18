import { useBlocker, useCanGoBack, useLocation, useNavigate, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHistorySearchState, type HistorySearchNavigation, type HistorySearchSetterOptions } from "@client-kit/platform/react/use-history-search-state";
import { platformNavigationSections, type PlatformNavigationSection } from "@client-kit/platform/react/navigation";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { createSearchHighlightNavigation } from "@client-kit/platform/react/search/searchHighlightNavigation";
import { selectSearchHighlightRouteState } from "@client-kit/platform/react/search/searchHighlightRouteState";

export type PlatformSection = PlatformNavigationSection | "inbox" | "settings";
export type PlatformTab = PlatformSection | "channel" | "conversation" | "new-message" | "application";
export type PlatformDraftNavigation = { key: string; send: boolean; editEventId?: string };
const THREAD_SEARCH_KEYS = ["thread", "messageId", "threadRootId"] as const;
const INBOX_SEARCH_KEYS = ["item"] as const;
// Original /channels/$channelId/posts/$postId?replyId: Web keeps forum post references on the channel URL.
const FORUM_SEARCH_KEYS = ["post", "replyId"] as const;

export function isPlatformSection(value: string): value is PlatformSection {
  return value === "inbox" || value === "settings" || platformNavigationSections.some((section) => section === value);
}

// URL contains only navigation references. It never stores sessions, identities,
// cached membership, native credentials, commands, or an unfinished write intent.
export function platformLocationSearch(search: Record<string, unknown>): {
  workspaceId?: string; protocolBinding?: string; messageId?: string; threadRootId?: string; projectId?: string; repositoryId?:string;issueId?:string;pullRequestId?:string;tab?:string;commitHash?:string;filePath?:string;thread?: string; item?: string;
  post?: string; replyId?: string;
  view?: "edit" | "duplicate";
} {
  const reference = (key: string) => typeof search[key] === "string" && search[key].trim() ? search[key] : undefined;
  return {
    workspaceId: reference("workspaceId"),
    protocolBinding: reference("protocolBinding"),
    messageId: reference("messageId"),
    threadRootId: reference("threadRootId"),
    projectId: reference("projectId"),
    repositoryId: reference("repositoryId"),
    issueId: reference("issueId"),
    pullRequestId: reference("pullRequestId"),
    tab: reference("tab"),
    commitHash: reference("commitHash"),
    filePath: reference("filePath"),
    thread: reference("thread"),
    item: reference("item"),
    post: reference("post"),
    replyId: reference("replyId"),
    // Original /workflows/$workflowId ?view= editor target; any other value is dropped.
    view: search.view === "edit" || search.view === "duplicate" ? search.view : undefined,
  };
}

type RouterHistoryState = { __TSR_index?: number; __TSR_key?: string; key?: string };
const HISTORY_KEY_LIMIT = 200;

/**
 * Fixed Buzz 779af8886caae1317b4de962082429867ab61503
 * desktop/src/app/navigation/useBackForwardControls.ts: forward is available while this
 * session's router index is below the furthest entry still on the same branch.
 */
function useCanGoForward(): boolean {
  const locationState = useRouterState({ select: (state) => state.location.state }) as RouterHistoryState;
  const locationIndex = locationState.__TSR_index ?? 0;
  const locationKey = locationState.__TSR_key ?? locationState.key ?? String(locationIndex);
  const keysByIndexRef = useRef(new Map<number, string>());
  const [maxIndex, setMaxIndex] = useState(locationIndex);
  useEffect(() => {
    const keysByIndex = keysByIndexRef.current;
    const currentKey = keysByIndex.get(locationIndex);
    const branched = currentKey !== undefined && currentKey !== locationKey;
    if (branched) {
      for (const storedIndex of [...keysByIndex.keys()]) if (storedIndex >= locationIndex) keysByIndex.delete(storedIndex);
    }
    keysByIndex.set(locationIndex, locationKey);
    while (keysByIndex.size > HISTORY_KEY_LIMIT) {
      const oldest = keysByIndex.keys().next().value;
      if (oldest === undefined) break;
      keysByIndex.delete(oldest);
    }
    setMaxIndex((current) => branched ? locationIndex : Math.max(current, locationIndex));
  }, [locationIndex, locationKey]);
  return locationIndex < maxIndex;
}

export function usePlatformNavigation(scopeKey?: string) {
  const threadNavigationGuard = useRef<(() => boolean) | null>(null);
  const registerThreadNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    threadNavigationGuard.current = guard;
  }, []);
  useBlocker({
    shouldBlockFn: () => threadNavigationGuard.current ? !threadNavigationGuard.current() : false,
    withResolver: false,
    enableBeforeUnload: false,
  });
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const search = useSearch({ from: "/_platform" });
  const navigateSearch = useCallback((options: HistorySearchNavigation) => { void navigate(options as never); }, [navigate]);
  const threadHistory = useHistorySearchState(THREAD_SEARCH_KEYS, search, navigateSearch);
  const inboxHistory = useHistorySearchState(INBOX_SEARCH_KEYS, search, navigateSearch);
  const forumHistory = useHistorySearchState(FORUM_SEARCH_KEYS, search, navigateSearch);
  /** Original goForumPost: opening a post (or a reply in it) pushes a history entry. */
  const setForumPost = useCallback((post: string | null, replyId?: string | null, options?: HistorySearchSetterOptions) => {
    forumHistory.applyPatch({ post, replyId: post ? replyId ?? null : null }, options);
  }, [forumHistory.applyPatch]);
  const setInboxItemId = useCallback((item: string | null) => {
    inboxHistory.applyPatch({ item });
  }, [inboxHistory.applyPatch]);
  const setThreadHeadId = useCallback((thread: string | null, options?: HistorySearchSetterOptions) => {
    threadHistory.applyPatch({ thread }, options);
  }, [threadHistory.applyPatch]);
  const clearMessageRouteTarget = useCallback(() => {
    threadHistory.applyPatch({ messageId: null, threadRootId: null });
  }, [threadHistory.applyPatch]);
  const location = useLocation();
  const routeState = location.state as { searchHighlightScope?: unknown; draftNavigation?: PlatformDraftNavigation | null };
  const draftTarget = scopeKey && routeState.searchHighlightScope === scopeKey && (params.channelId || params.conversationId) &&
    typeof routeState.draftNavigation?.key === "string" && typeof routeState.draftNavigation.send === "boolean" ? routeState.draftNavigation : null;
  const highlight = selectSearchHighlightRouteState(location);
  // The original transient history state is presentation only. It neither
  // admits a resource nor survives a change of the trusted session scope.
  const searchHighlight = scopeKey && routeState.searchHighlightScope === scopeKey &&
    (params.channelId || params.conversationId) && highlight?.messageId === search.messageId
    ? highlight : null;
  const navigationState = (messageId?: string, query?: string, draft?: PlatformDraftNavigation) => {
    const next = scopeKey && messageId ? createSearchHighlightNavigation(messageId, query) : undefined;
    return (previousState: typeof location.state) => ({
      ...previousState, searchHighlight: next ?? null, searchHighlightScope: next || draft ? scopeKey : null,
      draftNavigation: draft ?? null,
    });
  };
  const newMessage = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/_platform/messages/new") });
  const tab: PlatformTab = params.channelId ? "channel" : params.conversationId ? "conversation"
    : params.bindingId ? "application" : newMessage ? "new-message" : params.workflowId ? "workflows" : params.section ?? "channel";
  // The original project home embeds a channel; its thread uses the same URL
  // history. Repository/work-item routes do not mount that channel consumer.
  const projectChannelRoute = tab === "projects" && Boolean(search.projectId) &&
    !search.repositoryId && !search.issueId && !search.pullRequestId && !search.tab;
  const replaceDefaultChannel = useCallback((channelId: string) => {
    // The host supplies a freshly admitted default. An explicit route is never
    // rewritten to a directory fallback, including after access is revoked.
    if (tab !== "channel" || params.channelId || (search.workspaceId && search.workspaceId !== channelId)) return;
    void navigate({
      to: "/channels/$channelId", params: { channelId }, replace: true, resetScroll: false,
      search: previous => platformLocationSearch(previous),
    });
  }, [navigate, params.channelId, search.workspaceId, tab]);
  return {
    canGoBack,
    canGoForward,
    goBack: () => { if (canGoBack) router.history.back(); },
    goForward: () => { if (canGoForward) router.history.forward(); },
    tab,
    inboxItemId: tab === "inbox" ? inboxHistory.values.item : null,
    setInboxItemId,
    replaceDefaultChannel,
    searchHighlight,
    draftTarget,
    consumeDraftSend: () => navigate({to:".", replace:true, resetScroll:false, state:(previous:typeof location.state) => {
      const current = previous as typeof routeState;
      return draftTarget && current.searchHighlightScope === scopeKey && current.draftNavigation?.key === draftTarget.key
        ? {...previous, draftNavigation:{...current.draftNavigation,send:false}} : previous;
    }} as never),
    forumPostId: params.channelId ? forumHistory.values.post : null,
    forumReplyId: params.channelId && forumHistory.values.post ? forumHistory.values.replyId : null,
    setForumPost,
    /** Original closeForumPost: step back through history when possible, else replace with the channel. */
    closeForumPost: () => { if (canGoBack) router.history.back(); else setForumPost(null, null, { replace: true }); },
    threadHeadId: params.channelId || params.conversationId || projectChannelRoute ? threadHistory.values.thread : null,
    setThreadHeadId,
    clearMessageRouteTarget,
    registerThreadNavigationGuard,
    workspaceId: params.channelId ?? search.workspaceId ?? null,
    conversationId: params.conversationId ?? null,
    applicationBindingId: params.bindingId ?? null,
    projectId: tab === "projects" ? search.projectId ?? null : null,
    projectWorkItemTarget: tab === "projects" ? {repositoryId:search.repositoryId,issueId:search.issueId,pullRequestId:search.pullRequestId,tab:search.tab,commitHash:search.commitHash,filePath:search.filePath} : undefined,
    workflowRoute: params.workflowId ? { workflowId: params.workflowId, view: search.view, workspaceId: search.workspaceId } : null,
    openWorkflow: (route: { workflowId: string; view?: "edit" | "duplicate"; workspaceId?: string } | null, workspaceId?: string) => route
      ? navigate({ to: "/workflows/$workflowId", params: { workflowId: route.workflowId },
        search: { workspaceId: route.workspaceId, view: route.view }, state: navigationState() })
      : navigate({ to: "/$section", params: { section: "workflows" }, search: { workspaceId }, state: navigationState() }),
    openProject: (projectId: string | null,target?:import("@client-kit/platform/react/projects").ProjectWorkItemTarget) => navigate({to:"/$section",params:{section:"projects"},search:{projectId:projectId??undefined,...target},state:navigationState()}),
    messageTarget: (params.channelId || params.conversationId) && search.messageId ? {
      channelId: (params.channelId ?? params.conversationId)!, messageId: search.messageId, threadRootId: search.threadRootId ?? null,
    } : null,
    openChannel: (channelId: string, target?: ParsedMessageLink, query?: string, draft?: PlatformDraftNavigation) => navigate({
      to: "/channels/$channelId", params: { channelId },
      search: target ? { messageId: target.messageId, threadRootId: target.threadRootId ?? undefined } : {},
      state: navigationState(target?.messageId, query, draft),
    }),
    openConversation: (conversationId: string, target?: {messageId:string;threadRootId?:string|null}, query?: string, draft?: PlatformDraftNavigation) => navigate({ to: "/conversations/$conversationId", params: { conversationId }, search: target ? {messageId:target.messageId,threadRootId:target.threadRootId ?? undefined} : {}, state: navigationState(target?.messageId, query, draft) }),
    openApplication: (bindingId: string, workspaceId?: string) => navigate({ to: "/applications/$bindingId", params: { bindingId }, search: { workspaceId }, state:navigationState() }),
    openTab: (next: Exclude<PlatformTab, "conversation" | "application">, workspaceId?: string | null) => {
      if (next === "channel") return workspaceId
        ? navigate({ to: "/channels/$channelId", params: { channelId: workspaceId }, search: {}, state:navigationState() })
        : navigate({ to: "/", search: {}, state:navigationState() });
      if (next === "new-message") return navigate({ to: "/messages/new", search: { workspaceId: workspaceId ?? undefined }, state:navigationState() });
      return navigate({ to: "/$section", params: { section: next }, search: { workspaceId: workspaceId ?? undefined }, state:navigationState() });
    },
  };
}

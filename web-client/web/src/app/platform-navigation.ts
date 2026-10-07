import { useCanGoBack, useNavigate, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import { platformNavigationSections, type PlatformNavigationSection } from "@client-kit/platform/react/navigation";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";

export type PlatformSection = PlatformNavigationSection | "inbox" | "settings";
export type PlatformTab = PlatformSection | "channel" | "conversation" | "new-message" | "application";

export function isPlatformSection(value: string): value is PlatformSection {
  return value === "inbox" || value === "settings" || platformNavigationSections.some((section) => section === value);
}

// URL contains only navigation references. It never stores sessions, identities,
// cached membership, native credentials, commands, or an unfinished write intent.
export function platformLocationSearch(search: Record<string, unknown>): {
  workspaceId?: string; protocolBinding?: string; messageId?: string; threadRootId?: string; projectId?: string;
} {
  const reference = (key: string) => typeof search[key] === "string" && search[key].trim() ? search[key] : undefined;
  return {
    workspaceId: reference("workspaceId"),
    protocolBinding: reference("protocolBinding"),
    messageId: reference("messageId"),
    threadRootId: reference("threadRootId"),
    projectId: reference("projectId"),
  };
}

export function usePlatformNavigation() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const search = useSearch({ from: "/_platform" });
  const newMessage = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/_platform/messages/new") });
  const tab: PlatformTab = params.channelId ? "channel" : params.conversationId ? "conversation"
    : params.bindingId ? "application" : newMessage ? "new-message" : params.section ?? "channel";
  return {
    goBack: () => { if (canGoBack) router.history.back(); },
    goForward: () => router.history.forward(),
    tab,
    workspaceId: params.channelId ?? search.workspaceId ?? null,
    conversationId: params.conversationId ?? null,
    applicationBindingId: params.bindingId ?? null,
    projectId: tab === "projects" ? search.projectId ?? null : null,
    openProject: (projectId: string | null) => navigate({to:"/$section",params:{section:"projects"},search:{projectId:projectId??undefined}}),
    messageTarget: (params.channelId || params.conversationId) && search.messageId ? {
      channelId: (params.channelId ?? params.conversationId)!, messageId: search.messageId, threadRootId: search.threadRootId ?? null,
    } : null,
    openChannel: (channelId: string, target?: ParsedMessageLink) => navigate({
      to: "/channels/$channelId", params: { channelId },
      search: target ? { messageId: target.messageId, threadRootId: target.threadRootId ?? undefined } : {},
    }),
    openConversation: (conversationId: string, target?: {messageId:string;threadRootId?:string|null}) => navigate({ to: "/conversations/$conversationId", params: { conversationId }, search: target ? {messageId:target.messageId,threadRootId:target.threadRootId ?? undefined} : {} }),
    openApplication: (bindingId: string, workspaceId?: string) => navigate({ to: "/applications/$bindingId", params: { bindingId }, search: { workspaceId } }),
    openTab: (next: Exclude<PlatformTab, "conversation" | "application">, workspaceId?: string | null) => {
      if (next === "channel") return workspaceId
        ? navigate({ to: "/channels/$channelId", params: { channelId: workspaceId }, search: {} })
        : navigate({ to: "/", search: {} });
      if (next === "new-message") return navigate({ to: "/messages/new", search: { workspaceId: workspaceId ?? undefined } });
      return navigate({ to: "/$section", params: { section: next }, search: { workspaceId: workspaceId ?? undefined } });
    },
  };
}

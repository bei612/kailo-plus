import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { platformNavigationSections, type PlatformNavigationSection } from "@client-kit/platform/react/navigation";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";

export type PlatformSection = PlatformNavigationSection | "inbox" | "settings";
export type PlatformTab = PlatformSection | "channel" | "conversation" | "new-message";

export function isPlatformSection(value: string): value is PlatformSection {
  return value === "inbox" || value === "settings" || platformNavigationSections.some((section) => section === value);
}

// URL contains only navigation references. It never stores sessions, identities,
// cached membership, native credentials, commands, or an unfinished write intent.
export function platformLocationSearch(search: Record<string, unknown>): {
  workspaceId?: string; protocolBinding?: string; messageId?: string; threadRootId?: string;
} {
  const reference = (key: string) => typeof search[key] === "string" && search[key].trim() ? search[key] : undefined;
  return {
    workspaceId: reference("workspaceId"),
    protocolBinding: reference("protocolBinding"),
    messageId: reference("messageId"),
    threadRootId: reference("threadRootId"),
  };
}

export function usePlatformNavigation() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const search = useSearch({ from: "/_platform" });
  const newMessage = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/_platform/messages/new") });
  const tab: PlatformTab = params.channelId ? "channel" : params.conversationId ? "conversation"
    : newMessage ? "new-message" : params.section ?? "channel";
  return {
    tab,
    workspaceId: params.channelId ?? search.workspaceId ?? null,
    conversationId: params.conversationId ?? null,
    messageTarget: params.channelId && search.messageId ? {
      channelId: params.channelId, messageId: search.messageId, threadRootId: search.threadRootId ?? null,
    } : null,
    openChannel: (channelId: string, target?: ParsedMessageLink) => navigate({
      to: "/channels/$channelId", params: { channelId },
      search: target ? { messageId: target.messageId, threadRootId: target.threadRootId ?? undefined } : {},
    }),
    openConversation: (conversationId: string) => navigate({ to: "/conversations/$conversationId", params: { conversationId }, search: {} }),
    openTab: (next: Exclude<PlatformTab, "conversation">, workspaceId?: string | null) => {
      if (next === "channel") return workspaceId
        ? navigate({ to: "/channels/$channelId", params: { channelId: workspaceId }, search: {} })
        : navigate({ to: "/", search: {} });
      if (next === "new-message") return navigate({ to: "/messages/new", search: { workspaceId: workspaceId ?? undefined } });
      return navigate({ to: "/$section", params: { section: next }, search: { workspaceId: workspaceId ?? undefined } });
    },
  };
}

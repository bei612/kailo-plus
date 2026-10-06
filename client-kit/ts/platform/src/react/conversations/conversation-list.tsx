// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/SidebarSection.tsx.
// Reuses the original row/group/context menu; only Core's admitted references are listed.
import { useEffect, useState } from "react";
import { CircleDot, X } from "lucide-react";
import { toast } from "sonner";
import type { ConversationView } from "@client-kit/contracts";
import { useT } from "../context";
import { ChannelGroupSection } from "../sidebar/channel-group";
import { ChannelRow } from "../sidebar/channel-row";
import { TooltipProvider } from "../sidebar/tooltip";
import { sortChannelsForSidebar } from "../sidebar/channel-sort";
import { useConversationDirectory } from "./use-conversations";
import { useConversationState } from "./use-conversation-state";
import { ChannelContextMenuItems } from "../sidebar/channel-context-menu";

export function ConversationList({ currentPrincipalId, items, loading, error, selectedId, onSelect, onNewMessage, onReload, onCloseSelected }: {
  currentPrincipalId: string;
  items: ConversationView[];
  loading: boolean;
  error: Error | null;
  selectedId: string | null;
  onSelect: (conversation: ConversationView) => void;
  onNewMessage: () => void;
  onReload: () => void;
  onCloseSelected?: () => void;
}) {
  const t = useT();
  const directory = useConversationDirectory(currentPrincipalId);
  const [collapsed, setCollapsed] = useState(false);
  const [starredCollapsed, setStarredCollapsed] = useState(false);
  const userState = useConversationState(items);
  const selectedChannel = items.find((item) => item.id === selectedId)?.channelId;
  useEffect(() => {
    if (selectedChannel && userState.hidden?.has(selectedChannel)) onCloseSelected?.();
  }, [selectedChannel, userState.hidden, onCloseSelected]);
  const names = new Map(directory.items.map((person) => [person.principalId, person.displayName]));
  const rows = items.filter((conversation) => userState.hidden !== null && !userState.hidden.has(conversation.channelId)).map((conversation) => ({
    ...conversation,
    name: conversation.participantPrincipalIds.filter((id) => id !== currentPrincipalId).map((id) => names.get(id) ?? id).join(", "),
  }));
  const group = (starred: boolean) => <ChannelGroupSection
      title={t(starred ? "sidebar.starred" : "sidebar.messages")}
      items={error ? [] : sortChannelsForSidebar(rows.filter((row) => Boolean(userState.preferences[row.id]?.starred) === starred), "alpha")}
      hasUnread={false} isCollapsed={starred ? starredCollapsed : collapsed}
      onToggleCollapsed={() => starred ? setStarredCollapsed(!starredCollapsed) : setCollapsed(!collapsed)}
      listTestId={starred ? "starred-conversation-list" : "conversation-list"} actionsTestId="conversation-actions"
      onCreateChannel={starred ? undefined : onNewMessage} createChannelLabel={t("sidebar.newMessage")} createTestId="new-conversation"
      renderContextMenu={(conversation) => <ChannelContextMenuItems channel={{...conversation, id: conversation.channelId}} hasUnread={false}
        isStarred={userState.preferences[conversation.id]?.starred} isMuted={userState.preferences[conversation.id]?.muted}
        onCopy={(text, success) => { void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => toast.success(success), () => toast.error(t("platform.loadFailed"))); }}
        onStarChannel={userState.canWrite ? () => userState.preference(conversation.id, {starred: true}) : undefined}
        onUnstarChannel={userState.canWrite ? () => userState.preference(conversation.id, {starred: false}) : undefined}
        onMuteChannel={userState.canWrite ? () => userState.preference(conversation.id, {muted: true}) : undefined}
        onUnmuteChannel={userState.canWrite ? () => userState.preference(conversation.id, {muted: false}) : undefined} />}
      renderRow={(conversation) => <>
        <ChannelRow channel={{...conversation, id: conversation.channelId}} isActive={selectedId === conversation.id}
          isMuted={userState.preferences[conversation.id]?.muted}
          hasUnread={false} hasThreadUnread={false} onSelectChannel={() => onSelect(conversation)}
          glyph={() => <CircleDot className="h-4 w-4" />} />
        <button aria-label={t("sidebar.closeMessage")} disabled={!userState.canWrite}
          className="absolute right-1 top-1/2 z-10 -translate-y-1/2 after:absolute after:-inset-2 after:md:hidden group-data-[collapsible=icon]:hidden flex size-6 items-center justify-center p-1 text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring peer-data-[active=true]/menu-button:text-sidebar-active-foreground/75 peer-data-[active=true]/menu-button:hover:text-sidebar-active-foreground [&>svg]:size-4 [&>svg]:shrink-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 md:opacity-0 disabled:cursor-wait"
          data-sidebar="menu-action" data-testid={`hide-dm-${conversation.name}`} type="button"
          onClick={(event) => { event.stopPropagation(); userState.hide(conversation); }}><X className="h-4 w-4" /></button>
      </>} />;
  return <TooltipProvider>
    {error || userState.failed || userState.unknown ? <p role={userState.unknown ? "status" : "alert"} className="px-4 text-sm">
      {t(userState.unknown ? "sidebar.visibilityUnknown" : "platform.loadFailed")}
      <button type="button" disabled={userState.pending} onClick={() => { if (error) onReload(); else void userState.retry(); }}>{t("platform.retry")}</button>
    </p> : loading || !userState.ready ? <p role="status" className="px-4 text-sm">{t("platform.loading")}</p> : null}
    {rows.some((row) => userState.preferences[row.id]?.starred) ? group(true) : null}
    {group(false)}
  </TooltipProvider>;
}

// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/SidebarSection.tsx.
// Retains the original row/group and DM glyph presentation; only Core's admitted references are listed.
import { useState } from "react";
import { CircleDot } from "lucide-react";
import type { ConversationView } from "@client-kit/contracts";
import { useT } from "../context";
import { ChannelGroupSection } from "../sidebar/channel-group";
import { ChannelRow } from "../sidebar/channel-row";
import { TooltipProvider } from "../sidebar/tooltip";
import { sortChannelsForSidebar } from "../sidebar/channel-sort";
import { useConversationDirectory } from "./use-conversations";

export function ConversationList({ currentPrincipalId, items, loading, error, selectedId, onSelect, onNewMessage, onReload }: {
  currentPrincipalId: string;
  items: ConversationView[];
  loading: boolean;
  error: Error | null;
  selectedId: string | null;
  onSelect: (conversation: ConversationView) => void;
  onNewMessage: () => void;
  onReload: () => void;
}) {
  const t = useT();
  const directory = useConversationDirectory(currentPrincipalId);
  const [collapsed, setCollapsed] = useState(false);
  const names = new Map(directory.items.map((person) => [person.principalId, person.displayName]));
  const rows = items.map((conversation) => ({
    ...conversation,
    name: conversation.participantPrincipalIds.filter((id) => id !== currentPrincipalId).map((id) => names.get(id) ?? id).join(", "),
  }));
  return <TooltipProvider>
    {error ? <p role="alert" className="px-4 text-sm">{t("platform.loadFailed")} <button type="button" onClick={onReload}>{t("platform.retry")}</button></p>
      : loading ? <p role="status" className="px-4 text-sm">{t("platform.loading")}</p> : null}
    <ChannelGroupSection title={t("sidebar.messages")} items={error ? [] : sortChannelsForSidebar(rows, "alpha")}
      hasUnread={false} isCollapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)}
      listTestId="conversation-list" actionsTestId="conversation-actions"
      onCreateChannel={onNewMessage} createChannelLabel={t("sidebar.newMessage")} createTestId="new-conversation"
      renderRow={(conversation) => <ChannelRow channel={conversation} isActive={selectedId === conversation.id}
        hasUnread={false} hasThreadUnread={false} onSelectChannel={() => onSelect(conversation)}
        glyph={() => <CircleDot className="h-4 w-4" />} />} />
  </TooltipProvider>;
}

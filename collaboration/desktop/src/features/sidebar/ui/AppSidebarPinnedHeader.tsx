import { AppSidebarPinnedHeaderFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
export { AppSidebarPrimaryMenu } from "@client-kit/platform/react/sidebar/app-sidebar-primary-menu";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import type { Channel, SearchHit } from "@/shared/api/types";
type AppSidebarPinnedHeaderProps = {
  currentChannelId?: string | null;
  currentPubkey?: string;
  onOpenSearchResult: (hit: SearchHit, query: string) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  scopeSearchFocusRequest: number;
  suggestionChannels: Channel[];
};


export function AppSidebarPinnedHeader({
  currentChannelId,
  currentPubkey,
  onOpenSearchResult,
  onSelectChannel,
  searchChannels,
  searchFocusRequest,
  scopeSearchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  const { openProfilePanel } = useProfilePanel();
  return (
    <AppSidebarPinnedHeaderFrame>
      <TopbarSearch
        channels={searchChannels}
        currentChannelId={currentChannelId}
        currentPubkey={currentPubkey}
        focusRequest={searchFocusRequest}
        onOpenChannel={onSelectChannel}
        onOpenResult={onOpenSearchResult}
        onOpenUser={(user) => openProfilePanel?.(user.pubkey)}
        scopeFocusRequest={scopeSearchFocusRequest}
        suggestionChannels={suggestionChannels}
      />
    </AppSidebarPinnedHeaderFrame>
  );
}

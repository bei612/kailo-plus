import { AppSidebarPinnedHeaderFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
export { AppSidebarPrimaryMenu } from "@client-kit/platform/react/sidebar/app-sidebar-primary-menu";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import type { Channel, SearchHit } from "@/shared/api/types";
type AppSidebarPinnedHeaderProps = {
  currentChannelId?: string | null;
  currentPubkey?: string;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit, query: string) => void;
  onSelectChannel: (channelId: string) => void;
  onBrowseChannels: () => void;
  onCreateChannel: () => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  scopeSearchFocusRequest: number;
  suggestionChannels: Channel[];
};


export function AppSidebarPinnedHeader({
  currentChannelId,
  currentPubkey,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  onBrowseChannels,
  onCreateChannel,
  searchChannels,
  searchFocusRequest,
  scopeSearchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  const participantPubkeys = [...new Set(searchChannels.filter((channel) => channel.channelType === "dm")
    .flatMap((channel) => channel.participantPubkeys))];
  const profiles = useUsersBatchQuery(participantPubkeys, { enabled: participantPubkeys.length > 0 });
  const channelLabels = Object.fromEntries(searchChannels.map((channel) => [channel.id,
    resolveChannelDisplayLabel(channel, currentPubkey, profiles.data?.profiles)]));
  return (
    <AppSidebarPinnedHeaderFrame>
      <TopbarSearch
        channelLabels={channelLabels}
        channels={searchChannels}
        currentChannelId={currentChannelId}
        currentPubkey={currentPubkey}
        focusRequest={searchFocusRequest}
        onOpenChannel={onSelectChannel}
        onBrowseChannels={onBrowseChannels}
        onCreateChannel={onCreateChannel}
        onOpenResult={onOpenSearchResult}
        onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
        scopeFocusRequest={scopeSearchFocusRequest}
        suggestionChannels={suggestionChannels}
      />
    </AppSidebarPinnedHeaderFrame>
  );
}

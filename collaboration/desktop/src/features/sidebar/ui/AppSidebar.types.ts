import type { Community } from "@/features/platform/activeCommunity";
import type { ApplicationBindingView } from "@client-kit/contracts";
import type { PlatformSection } from "@/features/platform/platformSections";
import type { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import type { Channel, Profile, SearchHit } from "@/shared/api/types";

export type CollapsibleSidebarGroup = "starred" | "channels";

export type AppSidebarProps = {
  activeCommunity: Community;
  channels: Channel[];
  currentPubkey?: string;
  currentPrincipalId?: string;
  fallbackDisplayName?: string;
  homeBadgeCount: number;
  isLoading: boolean;
  profile?: Profile;
  relayConnectionCard: ReturnType<typeof useSidebarRelayConnectionCard>;
  errorMessage?: string;
  selectedChannelId: string | null;
  selectedView: "home" | "channel" | "platform" | "new-message";
  onNewMessage: () => void;
  selectedPlatformSection: PlatformSection | null;
  unreadChannelIds: ReadonlySet<string>;
  highPriorityUnreadChannelIds: ReadonlySet<string>;
  previewActivityChannelIds: ReadonlySet<string>;
  onMarkChannelUnread: (channelId: string) => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkAllChannelsRead: () => void;
  onSelectHome: () => void;
  onSelectChannel: (channelId: string) => void;
  onOpenSearchResult: (hit: SearchHit, query: string) => void;
  /** Full channel set for global search, including channels outside the joined sidebar list. */
  searchChannels: Channel[];
  searchFocusRequests: readonly [global: number, channel: number];
  onSelectSettings: () => void;
  onSelectPlatformSection: (section: PlatformSection) => void;
  onSelectApplication: (binding: ApplicationBindingView) => void;
  selectedApplicationBindingId?: string;
  applicationWorkspaceId?: string;
  onSignOut: () => void;
  onBackgroundClick?: () => void;
  mutedChannelIds?: ReadonlySet<string>;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  starredChannelIds?: ReadonlySet<string>;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
};

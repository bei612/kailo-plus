import { translate, resolveLocale } from "@kailo/platform/i18n";
import {
  ClipboardCheck,
  History,
  Inbox,
  ListChecks,
  MonitorSmartphone,
  Users,
} from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import {
  PLATFORM_SECTION_LABEL,
  PLATFORM_SECTIONS,
  type PlatformSection,
} from "@/features/kailo/platformSections";

type SidebarSelectedView = "home" | "channel" | "platform";

const PLATFORM_SECTION_ICON = {
  members: Users,
  tasks: ListChecks,
  approvals: ClipboardCheck,
  audit: History,
  devices: MonitorSmartphone,
} satisfies Record<PlatformSection, unknown>;

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

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onSelectHome: () => void;
  onSelectPlatformSection: (section: PlatformSection) => void;
  selectedPlatformSection: PlatformSection | null;
  selectedView: SidebarSelectedView;
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
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-3"
      data-testid="sidebar-pinned-header"
    >
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
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectHome,
  onSelectPlatformSection,
  selectedPlatformSection,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  const locale = resolveLocale();
  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="sidebar-primary-menu pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            className="data-[active=true]:font-normal"
            isActive={selectedView === "home"}
            onClick={onSelectHome}
            tooltip="Inbox"
            type="button"
          >
            <Inbox className="h-4 w-4" />
            <SidebarMenuLabel>Inbox</SidebarMenuLabel>
          </SidebarMenuButton>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge
              className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
              data-testid="sidebar-home-count"
            >
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        {PLATFORM_SECTIONS.map((section) => {
          const Icon = PLATFORM_SECTION_ICON[section];
          const label = translate(locale, PLATFORM_SECTION_LABEL[section]);
          return (
            <SidebarMenuItem key={section}>
              <SidebarMenuButton
                className="data-[active=true]:font-normal"
                data-testid={`sidebar-platform-${section}`}
                isActive={
                  selectedView === "platform" &&
                  selectedPlatformSection === section
                }
                onClick={() => onSelectPlatformSection(section)}
                tooltip={label}
                type="button"
              >
                <Icon className="h-4 w-4" />
                <SidebarMenuLabel>{label}</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarHeader>
  );
}

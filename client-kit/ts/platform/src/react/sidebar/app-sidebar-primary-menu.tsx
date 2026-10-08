// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; host authority remains outside this presentation module.
import { translate } from "../../i18n";
import { useUiLocale } from "../context";
import { PlatformNavigation, type PlatformNavigationSection as PlatformSection } from "../navigation";
import { Activity, Folders, Bot, ClipboardCheck, History, Inbox, ListChecks, MonitorSmartphone, Users, Zap } from "lucide-react";
import { SidebarHeader, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "./sidebar";
import { SidebarMenuLabel } from "./sidebar-menu-label";
import type { ReactNode } from "react";
type SidebarSelectedView = "home" | "channel" | "platform" | "new-message";

const PLATFORM_SECTION_ICON = {
  pulse: <Activity className="h-4 w-4" />,
  projects: <Folders className="h-4 w-4" />,
  members: <Users className="h-4 w-4" />,
  agents: <Bot className="h-4 w-4" />,
  workflows: <Zap className="h-4 w-4" />,
  tasks: <ListChecks className="h-4 w-4" />,
  approvals: <ClipboardCheck className="h-4 w-4" />,
  audit: <History className="h-4 w-4" />,
  devices: <MonitorSmartphone className="h-4 w-4" />,
} satisfies Record<PlatformSection, unknown>;


type AppSidebarPrimaryMenuProps = {
  homeBadgeCount?: number;
  onSelectHome: () => void;
  onSelectPlatformSection: (section: PlatformSection) => void;
  selectedPlatformSection: PlatformSection | null;
  selectedView: SidebarSelectedView;
  projectsSection?: ReactNode;
  projectsOverviewActive?: boolean;
};


export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectHome,
  onSelectPlatformSection,
  selectedPlatformSection,
  selectedView,
  projectsSection,
  projectsOverviewActive = true,
}: AppSidebarPrimaryMenuProps) {
  const locale = useUiLocale();
  return (
    <><SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <PlatformNavigation
        ButtonComponent={SidebarMenuButton}
        icons={PLATFORM_SECTION_ICON}
        locale={locale}
        onSelectSection={onSelectPlatformSection}
        selectedSection={
          selectedView === "platform" && (selectedPlatformSection !== "projects" || projectsOverviewActive) ? selectedPlatformSection : null
        }
        firstRow={
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              isActive={selectedView === "home"}
              onClick={onSelectHome}
              tooltip={translate(locale, "inbox.title")}
              type="button"
            >
              <Inbox className="h-4 w-4" />
              <SidebarMenuLabel>{translate(locale, "inbox.title")}</SidebarMenuLabel>
            </SidebarMenuButton>
            {homeBadgeCount !== undefined && homeBadgeCount > 0 ? (
              <SidebarMenuBadge
                className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
                data-testid="sidebar-home-count"
              >
                {Math.min(homeBadgeCount, 99)}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        }
      />
    </SidebarHeader>{projectsSection}</>
  );
}

import * as React from "react";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { SettingsNavigation, SettingsBackButton, SettingsContentSurface, CommunityInvitationSettings, useInvitationSettingsState } from "@client-kit/platform/react/settings";
import { getVersion } from "@tauri-apps/api/app";

import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  useSidebar,
} from "@/shared/ui/sidebar";
import {
  renderSettingsSection,
  type SettingsPanelProps,
  type SettingsSection,
} from "./SettingsPanels";

type SettingsViewProps = SettingsPanelProps & {
  active: boolean;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
};

export function SettingsView({
  active,
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  onClose,
  onSectionChange,
  onSetDesktopNotificationsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetAllSlotAlertsEnabled,
  onSetSoundForSlot,
  section,
}: SettingsViewProps) {
  const locale = useDeviceLocale();
  const invitations=useInvitationSettingsState();
  const { isMobile, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsLoaded(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  React.useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  React.useEffect(() => {
    if (active && !isMobile && !sidebarOpen) {
      setSidebarOpen(true);
    }
  }, [active, isMobile, setSidebarOpen, sidebarOpen]);

  return (
    <>
      {active?<Sidebar
        className="!border-r-0"
        collapsible="offcanvas"
        data-testid="settings-sidebar"
        variant="sidebar"
      >
        <div
          aria-hidden="true"
          className={cn(
            "shrink-0 cursor-default select-none",
            topChromeBackdrop.height,
          )}
          data-tauri-drag-region
          data-testid="settings-sidebar-top-chrome"
        />
        <SidebarHeader
          className="cursor-default select-none pb-0 pt-3"
          data-tauri-drag-region
        >
          <SettingsBackButton locale={locale} onClose={onClose} sidebarState={sidebarOpen ? "expanded" : "collapsed"} isMobile={isMobile} />
        </SidebarHeader>

        <SidebarContent>
          <SettingsNavigation locale={locale} section={section} onSelect={onSectionChange} sidebarState={sidebarOpen ? "expanded" : "collapsed"} isMobile={isMobile} invitationAccess={invitations.access} onRetryInvitations={invitations.reload} />
        </SidebarContent>

        <SidebarFooter>
          {appVersion ? (
            <p
              className="px-2 pb-1 text-xs text-sidebar-foreground/45"
              data-buzz-sidebar-secondary
              data-testid="settings-version"
            >
              v{appVersion}
            </p>
          ) : null}
        </SidebarFooter>
      </Sidebar>:null}

      <SidebarInset
        className={cn(
          "isolate relative min-h-0 min-w-0 overflow-hidden bg-sidebar motion-safe:transition-opacity motion-safe:duration-200",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        data-buzz-shadow-viewport
        data-testid="settings-view"
      >
        <div
          aria-hidden="true"
          className={cn(
            "relative z-10 shrink-0 cursor-default select-none",
            topChromeBackdrop.height,
          )}
          data-tauri-drag-region
          data-testid="settings-top-chrome"
        />
        <SettingsContentSurface section={section}>
              <CommunityInvitationSettings active={section==="community-members"} onAccessChange={invitations.onAccessChange}/>
              {active?renderSettingsSection(section, {
                isUpdatingDesktopNotifications,
                notificationErrorMessage,
                notificationPermission,
                notificationSettings,
                onSetDesktopNotificationsEnabled,
                onSetHomeBadgeEnabled,
                onSetSlotAlertsEnabled,
                onSetNotifyWhileViewing,
                onSetAllSlotAlertsEnabled,
                onSetSoundForSlot,
              }):null}
        </SettingsContentSurface>
      </SidebarInset>
    </>
  );
}

import * as React from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft } from "lucide-react";

import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import {
  renderSettingsSection,
  settingsSections,
  type SettingsPanelProps,
  type SettingsSection,
} from "./SettingsPanels";

type SettingsViewProps = SettingsPanelProps & {
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
};

const settingsNavGroups = [{ label: "Personal", sections: settingsSections }];

function SettingsSectionButton({
  active,
  onSelect,
  section,
}: {
  active: boolean;
  onSelect: (section: SettingsSection) => void;
  section: (typeof settingsSections)[number];
}) {
  const Icon = section.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-pressed={active}
        data-testid={`settings-nav-${section.value}`}
        isActive={active}
        onClick={() => onSelect(section.value)}
        tooltip={section.label}
        type="button"
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active
              ? "text-sidebar-active-foreground"
              : "text-sidebar-foreground/70",
          )}
        />
        <SidebarMenuLabel>{section.label}</SidebarMenuLabel>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SettingsView({
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
    if (!isMobile && !sidebarOpen) {
      setSidebarOpen(true);
    }
  }, [isMobile, setSidebarOpen, sidebarOpen]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <Sidebar
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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="settings-back-to-app"
                onClick={onClose}
                tooltip="Back to app"
                type="button"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to app</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {settingsNavGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu aria-label={`${group.label} settings sections`}>
                  {group.sections.map((entry) => (
                    <SettingsSectionButton
                      active={entry.value === section}
                      key={entry.value}
                      onSelect={onSectionChange}
                      section={entry}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
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
      </Sidebar>

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
        <div
          className="relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge"
          data-buzz-content-surface
          data-testid="settings-content-surface"
        >
          <section
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 sm:px-6"
            data-testid="settings-content-scroll"
          >
            <div
              className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4"
              data-testid={`settings-panel-${section}`}
            >
              {renderSettingsSection(section, {
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
              })}
            </div>
          </section>
        </div>
      </SidebarInset>
    </>
  );
}

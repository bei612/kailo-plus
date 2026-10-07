// Original Buzz SettingsView is shared with Web; only native app-version lookup stays here.
import * as React from "react";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { SettingsPage, CommunityInvitationSettings, useInvitationSettingsState } from "@client-kit/platform/react/settings";
import { getVersion } from "@tauri-apps/api/app";
import { renderSettingsSection, type SettingsPanelProps, type SettingsSection } from "./SettingsPanels";

type SettingsViewProps = SettingsPanelProps & {
  active: boolean;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
};

export function SettingsView({ active, onClose, onSectionChange, section, ...panelProps }: SettingsViewProps) {
  const locale = useDeviceLocale();
  const invitations = useInvitationSettingsState();
  const [appVersion, setAppVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    let disposed = false;
    void getVersion().then((version) => { if (!disposed) setAppVersion(version); });
    return () => { disposed = true; };
  }, []);
  return <SettingsPage active={active} locale={locale} section={section} onSelect={onSectionChange}
    onClose={onClose} appVersion={appVersion} invitationAccess={invitations.access} onRetryInvitations={invitations.reload}>
    <CommunityInvitationSettings active={section === "community-members"} onAccessChange={invitations.onAccessChange} />
    {renderSettingsSection(section, panelProps)}
  </SettingsPage>;
}

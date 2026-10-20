// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanelHeaderContent.tsx.
// Kailo: the original header actions for an Agent profile were the memory refresh (the governed
// memory surface carries its own refresh), the settings menu (null for Agents in the original),
// the local-agent Edit button and the harness-log copy (DD-26), so an Agent header holds only the
// title, back navigation and nothing on the trailing side. The "other setup" provenance marker
// is a device-local key custody fact with no Kailo equivalent (DD-75).
import type { ReactNode } from "react";

import type { Translate } from "../../../../../context";
import {
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "../../../../../messages/thread/auxiliary";
import {
  PROFILE_PANEL_VIEW_TITLES,
  type ProfilePanelView,
} from "./UserProfilePanelUtils";

export function getUserProfilePanelHeaderContent({
  onBack,
  t,
  view,
}: {
  onBack: () => void;
  t: Translate;
  view: ProfilePanelView;
}): { headerActions: ReactNode; headerLeftContent: ReactNode } {
  const title = t(PROFILE_PANEL_VIEW_TITLES[view]);
  const headerLeftContent = (
    <AuxiliaryPanelHeaderGroup
      align="center"
      backButtonAriaLabel={t("platform.profile.backToProfile")}
      backButtonTestId="user-profile-panel-back"
      onBack={view !== "summary" ? onBack : undefined}
    >
      <AuxiliaryPanelHeaderTitleBlock title={title} />
    </AuxiliaryPanelHeaderGroup>
  );

  return { headerActions: null, headerLeftContent };
}

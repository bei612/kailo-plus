import { useUserProfileQuery } from "@/features/profile/hooks";
import { ProfileSummaryView } from "@/features/profile/ui/UserProfilePanelSections";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";
import { truncateNpub } from "@/shared/lib/pubkey";
import type * as React from "react";

export type UserProfilePanelProps = {
  canResetWidth?: boolean;
  isSinglePanelView?: boolean;
  layout?: "standalone" | "split";
  onClose: () => void;
  onResetWidth?: () => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  pubkey: string;
  splitPaneClamp?: boolean;
  widthPx: number;
  transparentChrome?: boolean;
};

/** Read-only profile of a community member: avatar, name, about, identifiers. */
export function UserProfilePanel({
  canResetWidth,
  isSinglePanelView = false,
  layout = "standalone",
  onClose,
  onResetWidth,
  onResizeStart,
  pubkey,
  splitPaneClamp = false,
  widthPx,
  transparentChrome = false,
}: UserProfilePanelProps) {
  const isOverlay = useIsThreadPanelOverlay();
  const isSplitLayout = layout === "split";
  useEscapeKey(onClose, isOverlay || isSinglePanelView);
  const profileQuery = useUserProfileQuery(pubkey);
  const profile = profileQuery.data;
  const displayName = profile?.displayName ?? truncateNpub(pubkey);

  return (
    <AuxiliaryPanel
      canResetWidth={canResetWidth}
      className="relative"
      isSinglePanelView={isSinglePanelView}
      layout={isSplitLayout ? "split" : "standalone"}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      resizeHandleAriaLabel="Resize profile panel"
      resizeHandleTestId="user-profile-resize-handle"
      splitPaneClamp={splitPaneClamp}
      testId="user-profile-panel"
      transparentChrome={transparentChrome}
      widthPx={widthPx}
      header={
        <AuxiliaryPanelHeader
          data-testid="user-profile-panel-header"
          inset={!isSplitLayout ? "wide" : "default"}
          resizeBorder={!isSinglePanelView && !isOverlay && !isSplitLayout}
        >
          <AuxiliaryPanelHeaderGroup>
            <AuxiliaryPanelHeaderTitleBlock title="Profile" />
          </AuxiliaryPanelHeaderGroup>
        </AuxiliaryPanelHeader>
      }
    >
      <AuxiliaryPanelBody
        className="overflow-y-auto px-4 pb-6"
        data-testid="user-profile-scroll-body"
      >
        <ProfileSummaryView
          displayName={displayName}
          profile={profile}
          pubkey={pubkey}
        />
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}

// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/IdleAuxiliaryPanel.tsx.
import type * as React from "react";
import {useUiT} from "../../context";

import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelTitle,
} from "./auxiliary";

export type IdleAuxiliaryHeaderControls = {
  actions?: React.ReactNode;
  backLabel?: string;
  onBack?: () => void;
};

export function IdleAuxiliaryPanel({
  canResetWidth,
  children,
  headerControls,
  isFocusDrawer = false,
  isSinglePanelView,
  onClose,
  onResetWidth,
  onResizeStart,
  title,
  useSplitAuxiliaryPane,
  widthPx,
}: {
  canResetWidth: boolean;
  children: React.ReactNode;
  headerControls?: IdleAuxiliaryHeaderControls;
  isFocusDrawer?: boolean;
  isSinglePanelView: boolean;
  onClose: () => void;
  onResetWidth: () => void;
  onResizeStart: React.PointerEventHandler<HTMLButtonElement>;
  title: string;
  useSplitAuxiliaryPane: boolean;
  widthPx: number;
}) {
  const t=useUiT();
  const split = useSplitAuxiliaryPane && !isFocusDrawer;
  return (
    <AuxiliaryPanel
      canResetWidth={canResetWidth}
      enterMotion={!isFocusDrawer}
      isSinglePanelView={
        isFocusDrawer ? true : split ? false : isSinglePanelView
      }
      layout={split ? "split" : "standalone"}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      resizeHandleAriaLabel={t("thread.resizePanel")}
      resizeHandleTestId="idle-auxiliary-resize-handle"
      testId="idle-auxiliary-panel"
      transparentChrome={split}
      widthPx={widthPx}
      header={
        <AuxiliaryPanelHeader backdrop={isFocusDrawer} transparent={split}>
          <AuxiliaryPanelHeaderGroup
            backButtonAriaLabel={headerControls?.backLabel}
            backButtonTestId="idle-auxiliary-back"
            onBack={headerControls?.onBack}
          >
            <AuxiliaryPanelTitle>{title}</AuxiliaryPanelTitle>
          </AuxiliaryPanelHeaderGroup>
          {headerControls?.actions ? (
            <AuxiliaryPanelHeaderActions>
              {headerControls.actions}
            </AuxiliaryPanelHeaderActions>
          ) : null}
        </AuxiliaryPanelHeader>
      }
    >
      <AuxiliaryPanelBody className="overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-8">
        {children}
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}

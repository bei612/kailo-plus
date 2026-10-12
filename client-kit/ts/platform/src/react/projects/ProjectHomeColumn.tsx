// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectHomeColumn.tsx.
import type * as React from "react";

import { RightAuxiliaryPane } from "../messages/thread/RightAuxiliaryPane";
import { AuxiliaryPanelBody } from "../messages/thread/AuxiliaryPanelBody";
import { cn } from "../profile/buzz/shared/lib/cn";

export function ProjectHomeColumn({
  bodyClassName,
  canResetWidth,
  children,
  onResetWidth,
  onResizeStart,
  testId,
  widthPx,
}: {
  bodyClassName?: string;
  canResetWidth: boolean;
  children: React.ReactNode;
  onResetWidth: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  testId: string;
  widthPx: number;
}) {
  return (
    <RightAuxiliaryPane
      canResetWidth={canResetWidth}
      className="bg-sidebar text-sidebar-foreground"
      constrainToAvailableSpace={false}
      detached
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      showResizeIndicator={false}
      testId={testId}
      widthPx={widthPx}
    >
      <div className="relative z-30 flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
        <AuxiliaryPanelBody
          className={cn("min-h-0 flex-1 overflow-hidden", bodyClassName)}
          mode="panel"
        >
          {children}
        </AuxiliaryPanelBody>
      </div>
    </RightAuxiliaryPane>
  );
}

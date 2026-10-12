import * as React from "react";

import { FocusThreadDrawer } from "@/features/channels/ui/FocusThreadDrawer";

type ThreadPanelSurfaceProps = {
  channelName: string;
  children: React.ReactNode;
  isFocusDrawer: boolean;
  covered: boolean;
  hasActiveEdit: boolean;
  onClose: () => void;
};

/** Keeps a thread mounted while controlling its focus-drawer presentation. */
export const ThreadPanelSurface = React.forwardRef<HTMLDivElement,ThreadPanelSurfaceProps>(function ThreadPanelSurface({
  channelName,
  children,
  isFocusDrawer,
  covered,
  hasActiveEdit,
  onClose,
}: ThreadPanelSurfaceProps,ref) {
  return (
    <div className="contents" data-testid="thread-surface" ref={ref} aria-hidden={covered||undefined} inert={covered||undefined}>
      {isFocusDrawer ? (
        <FocusThreadDrawer channelName={channelName} onClose={onClose} escapeEnabled={!covered} hasActiveEdit={hasActiveEdit}>
          {children}
        </FocusThreadDrawer>
      ) : (
        children
      )}
    </div>
  );
});

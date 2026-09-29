import type * as React from "react";

import { FocusThreadDrawer } from "@/features/channels/ui/FocusThreadDrawer";

type ThreadPanelSurfaceProps = {
  channelName: string;
  children: React.ReactNode;
  isFocusDrawer: boolean;
  onClose: () => void;
};

/** Keeps a thread mounted while controlling its focus-drawer presentation. */
export function ThreadPanelSurface({
  channelName,
  children,
  isFocusDrawer,
  onClose,
}: ThreadPanelSurfaceProps) {
  return (
    <div className="contents" data-testid="thread-surface">
      {isFocusDrawer ? (
        <FocusThreadDrawer channelName={channelName} onClose={onClose}>
          {children}
        </FocusThreadDrawer>
      ) : (
        children
      )}
    </div>
  );
}

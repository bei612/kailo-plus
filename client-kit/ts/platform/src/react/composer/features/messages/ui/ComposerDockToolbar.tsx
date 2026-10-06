// Extracted from the pinned Buzz fork; original authority 779af8886caae1317b4de962082429867ab61503, desktop/src/features/messages/ui/ComposerDockToolbar.tsx.
import type { ComponentProps } from "react";

import { MessageComposerToolbar } from "./MessageComposerToolbar";

type ComposerDockToolbarProps = ComponentProps<
  typeof MessageComposerToolbar
> & {
  layoutMode: "dock" | "standalone";
};

/**
 * Keeps the composer dock's total height stable by trading a quiet-state spacer
 * for the equal-height activity rail outside the composer.
 */
export function ComposerDockToolbar({
  layoutMode,
  ...toolbarProps
}: ComposerDockToolbarProps) {
  return (
    <>
      {layoutMode === "dock" ? (
        <div
          aria-hidden="true"
          className="composer-dock-quiet-spacer shrink-0"
        />
      ) : null}
      <MessageComposerToolbar {...toolbarProps} />
    </>
  );
}

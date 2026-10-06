// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; host authority remains outside this presentation module.
import * as React from "react";

import { cn } from "../profile/buzz/shared/lib/cn";

/**
 * Keeps a menu label's inline footprint stable when its parent changes font
 * weight for the active state. The invisible semibold copy reserves the
 * widest state while the visible copy remains the accessible label.
 */
const SidebarMenuLabel = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span">
>(({ children, className, ...props }, ref) => (
  <span
    className={cn("grid min-w-0 overflow-hidden", className)}
    data-sidebar="menu-label"
    ref={ref}
    {...props}
  >
    <span
      aria-hidden="true"
      className="invisible col-start-1 row-start-1 truncate font-semibold"
    >
      {children}
    </span>
    <span className="col-start-1 row-start-1 truncate">{children}</span>
  </span>
));
SidebarMenuLabel.displayName = "SidebarMenuLabel";

export { SidebarMenuLabel };

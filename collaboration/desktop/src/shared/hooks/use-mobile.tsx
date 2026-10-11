import * as React from "react";
export { useElementWidth } from "@client-kit/platform/react/sidebar/use-mobile";

import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@/shared/layout/AuxiliaryPanel";

const MOBILE_BREAKPOINT = 768;

/**
 * Returns `true` when the viewport is narrower than `breakpointPx`.
 * Uses `matchMedia` for efficient change detection.
 */
export function useMediaBreakpoint(breakpointPx: number): boolean {
  const [isBelow, setIsBelow] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpointPx : false,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = () => {
      setIsBelow(window.innerWidth < breakpointPx);
    };
    mql.addEventListener("change", onChange);
    setIsBelow(window.innerWidth < breakpointPx);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return isBelow;
}

export function useIsMobile() {
  return useMediaBreakpoint(MOBILE_BREAKPOINT);
}

export function useIsAuxiliaryPanelOverlay() {
  return useMediaBreakpoint(AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX);
}

export function useIsThreadPanelOverlay() {
  return useIsAuxiliaryPanelOverlay();
}

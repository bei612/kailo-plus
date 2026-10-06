import { useMediaBreakpoint } from "../../sidebar/use-mobile";
import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "./auxiliaryPanelLayout";
export function useIsAuxiliaryPanelOverlay() { return useMediaBreakpoint(AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX); }
export const useIsThreadPanelOverlay = useIsAuxiliaryPanelOverlay;

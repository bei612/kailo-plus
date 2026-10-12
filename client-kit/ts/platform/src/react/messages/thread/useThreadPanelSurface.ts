// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/ThreadPanelSurface.tsx::useThreadPanelSurface.
import * as React from "react";
import {usePresenceCoverage} from "./useFocusDrawerPresence";

export function useThreadPanelSurface(open:boolean,onExitComplete:()=>void) {
  const ref=React.useRef<HTMLDivElement>(null);
  const coverage=usePresenceCoverage(open);
  const markExitComplete=React.useCallback(()=>{coverage.markExitComplete();onExitComplete();},[coverage.markExitComplete,onExitComplete]);
  const restoreFocusTarget=React.useCallback(()=>ref.current?.querySelector<HTMLElement>('[data-testid="auxiliary-panel-close"]')??null,[]);
  return {...coverage,markExitComplete,ref,restoreFocusTarget};
}

import * as React from "react";
import { hasPrimaryShortcutModifier } from "../keyboard-platform";

// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/app/useAppShellKeyboardShortcuts.ts::handleKeyDown.
export function useSearchShortcuts({canSearchCurrentChannel,disabled,onSearchCurrentChannel,onSearchEverything}: {
  canSearchCurrentChannel:boolean;disabled:boolean;onSearchCurrentChannel:()=>void;onSearchEverything:()=>void;
}) {
  React.useLayoutEffect(()=>{
    if(disabled)return;
    function handleKeyDown(event:KeyboardEvent) {
      if(!hasPrimaryShortcutModifier(event)||event.altKey||event.repeat||event.defaultPrevented)return;
      const key=event.key.toLowerCase();
      if(key==="f"&&!event.shiftKey&&canSearchCurrentChannel){event.preventDefault();onSearchCurrentChannel();return;}
      if(key==="k"&&!event.shiftKey){event.preventDefault();onSearchEverything();}
    }
    window.addEventListener("keydown",handleKeyDown);
    return()=>window.removeEventListener("keydown",handleKeyDown);
  },[canSearchCurrentChannel,disabled,onSearchCurrentChannel,onSearchEverything]);
}

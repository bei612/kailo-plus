// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/app/useAppShellKeyboardShortcuts.ts::handleKeyDown (Home)
// desktop/src/app/navigation/backForwardChords.ts::matchBackForwardChord
// desktop/src/app/navigation/useBackForwardControls.ts::handleKeyDown
import { useEffect, useLayoutEffect } from "react";
import { hasPrimaryShortcutModifier, isMacPlatform } from "../keyboard-platform";
import { matchBackForwardChord } from "../backForwardChords";

export function useHomeShortcut({ disabled, onGoHome }: { disabled: boolean; onGoHome: () => unknown }) {
  useLayoutEffect(() => {
    if (disabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (!hasPrimaryShortcutModifier(event) || event.altKey || event.repeat || event.defaultPrevented) return;
      if (event.key.toLowerCase() === "a" && event.shiftKey) {
        event.preventDefault();
        void onGoHome();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onGoHome]);
}

export function useHistoryShortcuts({ goBack, goForward }: { goBack: () => void; goForward: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Original chords intentionally remain active inside the autofocused
      // composer. Neither platform chord carries text-editing semantics.
      const direction = matchBackForwardChord(event, isMacPlatform());
      if (direction === "back") {
        event.preventDefault();
        goBack();
        return;
      }
      if (direction === "forward") {
        event.preventDefault();
        goForward();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goBack, goForward]);
}

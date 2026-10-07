import * as React from "react";
import { useHomeShortcut } from "@client-kit/platform/react/use-navigation-shortcuts";

import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

type AppShellKeyboardShortcutsOptions = {
  canSearchCurrentChannel: boolean;
  disabled: boolean;
  onGoHome: () => unknown;
  onSearchCurrentChannel: () => void;
  onSearchEverything: () => void;
};

export function useAppShellKeyboardShortcuts({
  canSearchCurrentChannel,
  disabled,
  onGoHome,
  onSearchCurrentChannel,
  onSearchEverything,
}: AppShellKeyboardShortcutsOptions) {
  useHomeShortcut({ disabled, onGoHome });
  React.useLayoutEffect(() => {
    if (disabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        !hasPrimaryShortcutModifier(event) ||
        event.altKey ||
        event.repeat ||
        event.defaultPrevented
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "f" && !event.shiftKey && canSearchCurrentChannel) {
        event.preventDefault();
        onSearchCurrentChannel();
        return;
      }

      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        onSearchEverything();
        return;
      }

    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    canSearchCurrentChannel,
    disabled,
    onSearchCurrentChannel,
    onSearchEverything,
  ]);
}

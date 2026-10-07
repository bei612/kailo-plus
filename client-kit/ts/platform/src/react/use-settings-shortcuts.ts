import * as React from "react";
import { hasPrimaryShortcutModifier } from "../keyboard-platform";
import { useEscapeKey } from "./messages/thread/useEscapeKey";

type UseSettingsShortcutsOptions = {
  onClose: () => void;
  onOpenSettings: () => void;
  open?: boolean;
};

// Original Buzz shortcut; hosts retain their own navigation state.
export function useSettingsShortcuts({
  onClose,
  onOpenSettings,
  open,
}: UseSettingsShortcutsOptions) {
  // SettingsView owns Escape only while visible. Keep the original nested
  // surface priority and let background mark-as-read handlers yield.
  useEscapeKey(onClose, open === true);
  React.useLayoutEffect(() => {
    if (open === undefined) return;
    function handleKeyDown(event: KeyboardEvent) {
      const isSettingsShortcut =
        hasPrimaryShortcutModifier(event) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "," || event.code === "Comma");
      if (!isSettingsShortcut) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (open) {
        onClose();
        return;
      }
      onOpenSettings();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, onOpenSettings, open]);
}

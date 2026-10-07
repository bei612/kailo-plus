import * as React from "react";
import { hasPrimaryShortcutModifier } from "../keyboard-platform";

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/app/useAppShellKeyboardShortcuts.ts::handleKeyDown (channel navigation).
// Hosts supply their existing governed dialogs/navigation; the shortcut does not write.
export function useChannelNavigationShortcuts({
  disabled,
  onBrowseChannels,
  onCreateChannel,
  onNewMessage,
}: {
  disabled: boolean;
  onBrowseChannels: () => void;
  onCreateChannel: () => void;
  onNewMessage: () => void;
}) {
  React.useLayoutEffect(() => {
    if (disabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (!hasPrimaryShortcutModifier(event) || event.altKey || event.repeat || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (key === "k" && event.shiftKey) {
        event.preventDefault();
        onNewMessage();
        return;
      }
      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        onCreateChannel();
        return;
      }
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        onBrowseChannels();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onBrowseChannels, onCreateChannel, onNewMessage]);
}

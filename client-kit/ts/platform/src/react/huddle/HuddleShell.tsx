// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/app/AppHuddleShell.tsx::{AppHuddleShell,HuddleShortcutHandler}
// desktop/src/app/useAppShellKeyboardShortcuts.ts::handleHuddleShortcut (capture phase)
// DD-125(3): the original app shell around a Huddle: the provider, the lifted app surface with
// the drawer slot and backdrop, Ctrl+Shift+Space dispatched for the focused channel (start or
// join there; leave when connected). Kailo differences: one window (no companion), and the
// drawer opens from the shared provider's state.
import * as React from "react";
import { cn } from "../profile/buzz/shared/lib/cn";
import { HUDDLE_SHORTCUT_EVENT, type HuddleShortcutDetail } from "../../keyboard-shortcuts";
import { HuddleProvider, useHuddle } from "./HuddleContext";
import { HuddleBar } from "./HuddleBar";

function HuddleShortcutHandler({ children }: { children: React.ReactNode }) {
  const { activeEphemeralChannelId, leaveHuddle } = useHuddle();
  React.useEffect(() => {
    if (!activeEphemeralChannelId) return;
    function handleHuddleShortcut() {
      void leaveHuddle();
    }
    window.addEventListener(HUDDLE_SHORTCUT_EVENT, handleHuddleShortcut);
    return () => window.removeEventListener(HUDDLE_SHORTCUT_EVENT, handleHuddleShortcut);
  }, [activeEphemeralChannelId, leaveHuddle]);
  return children;
}

/** Original capture-phase Ctrl+Shift+Space: works even when a composer has focus. */
function useHuddleShortcutDispatch(activeChannelId: string | null, disabled: boolean) {
  React.useLayoutEffect(() => {
    if (disabled) return;
    function handleHuddleShortcut(event: KeyboardEvent) {
      const isHuddleShortcut = event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && event.code === "Space";
      if (!isHuddleShortcut) return;
      if (event.repeat || event.defaultPrevented || !activeChannelId) return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent<HuddleShortcutDetail>(HUDDLE_SHORTCUT_EVENT, { detail: { channelId: activeChannelId } }));
    }
    window.addEventListener("keydown", handleHuddleShortcut, true);
    return () => window.removeEventListener("keydown", handleHuddleShortcut, true);
  }, [activeChannelId, disabled]);
}

export function HuddleShell({
  children,
  activeChannelId,
  currentPubkey,
  shortcutsDisabled = false,
  onShowHuddleInMainApp,
  onViewHuddleChannel,
  className,
}: {
  children: React.ReactNode;
  /** The Relay channel of the focused channel or conversation, for the original shortcut. */
  activeChannelId: string | null;
  currentPubkey?: string | null;
  shortcutsDisabled?: boolean;
  onShowHuddleInMainApp?: (ephemeralChannelId: string) => void;
  onViewHuddleChannel?: (ephemeralChannelId: string) => void;
  className?: string;
}) {
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  useHuddleShortcutDispatch(activeChannelId, shortcutsDisabled);
  return (
    <HuddleProvider onShowHuddleInMainApp={onShowHuddleInMainApp} onViewHuddleChannel={onViewHuddleChannel}>
      <HuddleShortcutHandler>
        <div className={cn("buzz-huddle-shell relative h-dvh overflow-hidden overscroll-none", className)}
          data-huddle-open={isDrawerOpen} data-huddle-window={false}>
          <div aria-hidden="true" className={cn("buzz-huddle-drawer-backdrop", isDrawerOpen && "buzz-huddle-drawer-backdrop-open")} />
          <div className={cn("buzz-huddle-app-surface z-10 flex min-h-0 flex-row overflow-hidden bg-background",
            isDrawerOpen && "buzz-huddle-app-surface-open")}>
            {children}
          </div>
          <div className="buzz-huddle-drawer-slot absolute inset-x-0 bottom-0 z-[2] h-(--buzz-huddle-drawer-height)">
            <HuddleBar className="h-full" currentPubkey={currentPubkey} onVisibilityChange={setIsDrawerOpen} />
          </div>
        </div>
      </HuddleShortcutHandler>
    </HuddleProvider>
  );
}

// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; host authority remains outside this presentation module.
import type * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { isMacPlatform } from "../../keyboard-platform";

interface ProfilePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  avatar: React.ReactNode;
  onOpenSettings: () => void;
  children: React.ReactNode;
  // Optional outer container whose clicks should NOT close the popover.
  // Used when auxiliary triggers (avatar) live alongside the primary
  // PopoverTrigger and toggle the popover via controlled `open`.
  triggerContainerRef?: React.RefObject<HTMLElement | null>;
  // Platform sign-out: revokes the platform session, then drops this device's
  // tokens (the device key itself stays registered).
  onSignOut: () => void;
}

const MENU_ITEM_CLASS =
  "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-popover-foreground outline-hidden transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none";

export function ProfilePopover({
  open,
  onOpenChange,
  displayName,
  avatar,
  onOpenSettings,
  children,
  triggerContainerRef,
  onSignOut,
}: ProfilePopoverProps) {
  const settingsShortcutLabel = isMacPlatform() ? "⌘," : "Ctrl+,";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={-32}
        className="w-[280px] p-1"
        data-testid="profile-popover"
        onInteractOutside={(event) => {
          const target = event.target as Node | null;
          if (target && triggerContainerRef?.current?.contains(target)) {
            // Click on an auxiliary trigger inside the same card (e.g. the
            // avatar) — let that trigger toggle the controlled state instead
            // of auto-closing here.
            event.preventDefault();
          }
        }}
      >
        <div aria-label="Profile menu" role="menu">
          <div className="flex items-center gap-2 px-3 pt-2 pb-2">
            {avatar}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-popover-foreground">
              {displayName}
            </p>
          </div>

          <hr className="my-1 h-px border-0 bg-border/60" />

          <button
            className={MENU_ITEM_CLASS}
            data-testid="profile-popover-settings"
            onClick={() => {
              onOpenChange(false);
              window.requestAnimationFrame(() => {
                onOpenSettings();
              });
            }}
            role="menuitem"
            type="button"
          >
            <span className="flex-1">Settings</span>
            <kbd className="text-xs text-muted-foreground">
              {settingsShortcutLabel}
            </kbd>
          </button>
          <button
            className={MENU_ITEM_CLASS}
            data-testid="profile-popover-sign-out"
            onClick={() => {
              onOpenChange(false);
              onSignOut();
            }}
            role="menuitem"
            type="button"
          >
            <span className="flex-1">Sign out</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

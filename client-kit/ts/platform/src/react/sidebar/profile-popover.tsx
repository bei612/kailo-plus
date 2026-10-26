import { useHasPlatform, useUiT } from "../context";
// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; host authority remains outside this presentation module.
// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/profile/ui/ProfilePopover.tsx:
// identity block with presence badge, presence chip and online/away/offline chooser, the
// Slack-style "Update your status" entry and SetStatusDialog (DD-120), then Settings. The
// platform Sign out stays; feedback follows the Core-owned DD-158 contract.
import * as React from "react";
import { SendFeedbackDialog } from "../feedback/SendFeedbackDialog";
import { Smile } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { isMacPlatform } from "../../keyboard-platform";
import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "../messages/thread/MaskedAvatarBadgeFrame";
import {
  getPresenceChipClassName,
  getPresenceLabelKey,
  type PresenceStatus,
} from "../presence/lib/presence";
import { PresenceDot } from "../presence/ui/PresenceBadge";
import { cn } from "../profile/buzz/shared/lib/cn";
import type { UserStatusInput } from "../user-status/types";
import { SetStatusDialog } from "../user-status/ui/SetStatusDialog";
import { DEFAULT_USER_STATUS_EMOJI, StatusEmoji } from "../user-status/ui/StatusEmoji";

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
  /** DD-120: the person's own presence session; omitted when the host has none. */
  currentStatus?: PresenceStatus;
  isStatusPending?: boolean;
  onSetStatus?: (status: PresenceStatus) => void;
  userStatusText?: string;
  userStatusEmoji?: string;
  userStatusExpiresAt?: number;
  userStatusUpdatedAt?: number;
  onSetUserStatus?: (status: UserStatusInput) => void;
  onClearUserStatus?: () => void;
}

const MENU_ITEM_CLASS =
  "flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-popover-foreground outline-hidden transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none";

const ALL_STATUSES: PresenceStatus[] = ["online", "away", "offline"];

export function ProfilePopover({
  open,
  onOpenChange,
  displayName,
  avatar,
  onOpenSettings,
  children,
  triggerContainerRef,
  onSignOut,
  currentStatus,
  isStatusPending,
  onSetStatus,
  userStatusText,
  userStatusEmoji,
  userStatusExpiresAt,
  userStatusUpdatedAt,
  onSetUserStatus,
  onClearUserStatus,
}: ProfilePopoverProps) {
  const translateUi = useUiT();
  const hasPlatform = useHasPlatform();
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const settingsShortcutLabel = isMacPlatform() ? "⌘," : "Ctrl+,";
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [presenceMenuOpen, setPresenceMenuOpen] = React.useState(false);
  const hasUserStatus = Boolean(userStatusText || userStatusEmoji);
  const canSetUserStatus = Boolean(onSetUserStatus && onClearUserStatus);

  function handlePopoverOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPresenceMenuOpen(false);
    }
    onOpenChange(nextOpen);
  }

  function closePopover() {
    setPresenceMenuOpen(false);
    onOpenChange(false);
  }

  function handlePresenceSelect(status: PresenceStatus) {
    onSetStatus?.(status);
    closePopover();
  }

  return (
    <>
      <Popover open={open} onOpenChange={handlePopoverOpenChange}>
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
          <div aria-label={translateUi("buzz.profileMenu")} role="menu">
            {/* ── Identity block ─────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3 pt-2 pb-2">
              {currentStatus ? (
                <MaskedAvatarBadgeFrame
                  badge={
                    <span
                      aria-label={translateUi(getPresenceLabelKey(currentStatus))}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
                      data-testid="profile-popover-current-status"
                      role="img"
                    >
                      <PresenceDot className="h-2 w-2" status={currentStatus} />
                    </span>
                  }
                  badgeBox={{ bottom: -2, height: 14, right: -2, width: 14 }}
                  className="h-8 w-8"
                  curve={STATUS_DOT_MASK_CURVE}
                  cutout={{ cx: 28, cy: 28, r: 7.5 }}
                  size={32}
                >
                  {avatar}
                </MaskedAvatarBadgeFrame>
              ) : avatar}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-popover-foreground">
                  {displayName}
                </p>
                {currentStatus && onSetStatus ? (
                  /* ── Presence chip (opens status chooser) ─────────── */
                  <Popover
                    onOpenChange={setPresenceMenuOpen}
                    open={presenceMenuOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        aria-expanded={presenceMenuOpen}
                        aria-haspopup="menu"
                        className={cn(
                          "mt-0.5 inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium outline-hidden transition-opacity hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                          getPresenceChipClassName(currentStatus),
                        )}
                        data-testid="profile-popover-presence-trigger"
                        disabled={isStatusPending}
                        onClick={() => setPresenceMenuOpen((prev) => !prev)}
                        role="menuitem"
                        type="button"
                      >
                        <span className="truncate">
                          {translateUi(getPresenceLabelKey(currentStatus))}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-52 p-1"
                      side="bottom"
                      sideOffset={4}
                    >
                      <div aria-label={translateUi("presence.chooser")} role="menu">
                        {ALL_STATUSES.map((status) => (
                          <button
                            className={MENU_ITEM_CLASS}
                            data-testid={`profile-popover-status-${status}`}
                            disabled={isStatusPending}
                            key={status}
                            onClick={() => handlePresenceSelect(status)}
                            role="menuitem"
                            type="button"
                          >
                            <PresenceDot
                              className="h-2.5 w-2.5"
                              status={status}
                            />
                            <span>{translateUi(getPresenceLabelKey(status))}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </div>

            {hasPlatform ? <SendFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen}/> : null}
      {canSetUserStatus ? (
              /* ── Status input (Slack-style) ──────────────────────── */
              <div className="px-2 pt-0 pb-1">
                <button
                  className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-transparent px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
                  data-testid="profile-popover-set-status"
                  onClick={() => {
                    closePopover();
                    window.requestAnimationFrame(() => {
                      setStatusDialogOpen(true);
                    });
                  }}
                  role="menuitem"
                  type="button"
                >
                  {hasUserStatus ? (
                    <StatusEmoji
                      className="size-4 shrink-0 text-base"
                      showTitle={false}
                      value={userStatusEmoji || DEFAULT_USER_STATUS_EMOJI}
                    />
                  ) : (
                    <Smile
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  {hasUserStatus ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-popover-foreground">
                      <span className="truncate">{userStatusText}</span>
                    </span>
                  ) : (
                    <span className="flex-1 truncate text-muted-foreground">
                      {translateUi("userStatus.update")}
                    </span>
                  )}
                </button>
              </div>
            ) : null}

            <hr className="my-1 h-px border-0 bg-border/60" />

            {hasPlatform ? <button className={MENU_ITEM_CLASS} role="menuitem" type="button" data-testid="profile-popover-feedback"
              onClick={() => { closePopover(); window.requestAnimationFrame(() => setFeedbackOpen(true)); }}>
              <span className="flex-1">{translateUi("platform.feedback.title")}</span>
            </button> : null}
            {/* ── Settings ───────────────────────────────────────── */}
            <button
              className={MENU_ITEM_CLASS}
              data-testid="profile-popover-settings"
              onClick={() => {
                closePopover();
                window.requestAnimationFrame(() => {
                  onOpenSettings();
                });
              }}
              role="menuitem"
              type="button"
            >
              <span className="flex-1">{translateUi("platform.settings.title")}</span>
              <kbd className="text-xs text-muted-foreground">
                {settingsShortcutLabel}
              </kbd>
            </button>
            <button
              className={MENU_ITEM_CLASS}
              data-testid="profile-popover-sign-out"
              onClick={() => {
                closePopover();
                onSignOut();
              }}
              role="menuitem"
              type="button"
            >
              <span className="flex-1">{translateUi("platform.signOut")}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {hasPlatform ? <SendFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen}/> : null}
      {canSetUserStatus ? (
        <SetStatusDialog
          hasExistingStatus={hasUserStatus}
          initialEmoji={userStatusEmoji}
          initialExpiresAt={userStatusExpiresAt}
          initialText={userStatusText}
          initialUpdatedAt={userStatusUpdatedAt}
          onClear={() => onClearUserStatus?.()}
          onOpenChange={setStatusDialogOpen}
          onSave={(status) => onSetUserStatus?.(status)}
          open={statusDialogOpen}
        />
      ) : null}
    </>
  );
}

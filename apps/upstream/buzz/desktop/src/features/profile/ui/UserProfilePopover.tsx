import * as React from "react";

import { useUserProfileQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { cn } from "@/shared/lib/cn";
import { truncateNpub } from "@/shared/lib/pubkey";
import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";

type UserProfilePopoverProps = {
  children: React.ReactNode;
  pubkey: string;
  triggerElement?: "div" | "span";
  /**
   * Extra classes for the focusable trigger wrapper, which defaults to
   * inline-flex. Use `min-w-0 max-w-full` when truncating flex content must
   * shrink, or `inline` when prose content must fragment across lines.
   */
  triggerClassName?: string;
  /** Test id applied to the focusable profile trigger shell. */
  triggerTestId?: string;
  /** Accessible name for interactive trigger content that is visually hidden. */
  triggerAriaLabel?: string;
  /** Set false when the trigger is inside another interactive control. */
  enableProfilePanel?: boolean;
  /** Set false when a smaller, context-specific hover treatment is provided. */
  enableHoverPopover?: boolean;
};

const HOVER_CLOSE_DELAY_MS = 200;

const TEXT_SWAP_BASE_CLASS =
  "col-start-1 row-start-1 min-w-0 truncate transition-[opacity,filter] duration-[250ms] ease-in-out motion-reduce:transition-none";
const TEXT_SWAP_VISIBLE_CLASS = "opacity-100 blur-0";
const TEXT_SWAP_HIDDEN_CLASS = "opacity-0 blur-0";
const TEXT_SWAP_HOVER_VISIBLE_CLASS =
  "group-hover/name:opacity-100 group-hover/name:blur-0";
const TEXT_SWAP_HOVER_HIDDEN_CLASS =
  "group-hover/name:opacity-0 group-hover/name:blur-[2px]";

function HoverPubkeyName({
  displayName,
  pubkey,
}: {
  displayName: string;
  pubkey: string;
}) {
  return (
    <span className="group/name inline-grid h-5 min-w-0 flex-1 overflow-hidden text-sm font-semibold leading-5">
      <span
        className={`${TEXT_SWAP_BASE_CLASS} ${TEXT_SWAP_VISIBLE_CLASS} ${TEXT_SWAP_HOVER_HIDDEN_CLASS}`}
      >
        {displayName}
      </span>
      <span
        className={`${TEXT_SWAP_BASE_CLASS} ${TEXT_SWAP_HIDDEN_CLASS} ${TEXT_SWAP_HOVER_VISIBLE_CLASS}`}
      >
        {truncateNpub(pubkey)}
      </span>
    </span>
  );
}

export function UserProfilePopover({
  children,
  pubkey,
  triggerElement = "div",
  triggerAriaLabel,
  triggerClassName,
  triggerTestId,
  enableProfilePanel = true,
  enableHoverPopover = true,
}: UserProfilePopoverProps) {
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { openProfilePanel } = useProfilePanel();
  const canOpenProfilePanel = enableProfilePanel && Boolean(openProfilePanel);

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleTriggerMouseEnter = React.useCallback(() => {
    if (!enableHoverPopover) {
      return;
    }
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, enableHoverPopover]);

  const handleMouseLeave = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);

  const handleContentMouseEnter = React.useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  const handleTriggerClick = React.useCallback(
    (event: React.MouseEvent) => {
      clearHoverTimer();
      if (canOpenProfilePanel && openProfilePanel) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        openProfilePanel(pubkey);
      }
    },
    [canOpenProfilePanel, clearHoverTimer, openProfilePanel, pubkey],
  );

  React.useEffect(() => {
    return clearHoverTimer;
  }, [clearHoverTimer]);

  const TriggerElement = triggerElement;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverAnchor asChild>
        <TriggerElement
          aria-label={triggerAriaLabel}
          data-testid={triggerTestId}
          role={canOpenProfilePanel ? "button" : undefined}
          tabIndex={canOpenProfilePanel ? 0 : undefined}
          onClick={handleTriggerClick}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              canOpenProfilePanel &&
              openProfilePanel
            ) {
              e.preventDefault();
              e.stopPropagation();
              clearHoverTimer();
              setOpen(false);
              openProfilePanel(pubkey);
            }
          }}
          onMouseEnter={handleTriggerMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            "inline-flex",
            triggerClassName,
            canOpenProfilePanel && "cursor-pointer [&_*]:cursor-pointer",
          )}
        >
          {children}
        </TriggerElement>
      </PopoverAnchor>
      {open ? (
        <UserProfilePopoverBody
          canOpenProfilePanel={canOpenProfilePanel}
          onContentMouseEnter={handleContentMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTriggerClick={handleTriggerClick}
          pubkey={pubkey}
        />
      ) : null}
    </Popover>
  );
}

/**
 * Everything behind the popover surface. Mounted only while the popover is
 * open — the trigger shell above stays cheap enough for grids that render
 * hundreds of instances.
 */
function UserProfilePopoverBody({
  canOpenProfilePanel,
  onContentMouseEnter,
  onMouseLeave,
  onTriggerClick,
  pubkey,
}: {
  canOpenProfilePanel: boolean;
  onContentMouseEnter: () => void;
  onMouseLeave: () => void;
  onTriggerClick: (event: React.MouseEvent) => void;
  pubkey: string;
}) {
  const profileQuery = useUserProfileQuery(pubkey);
  const profile = profileQuery.data;
  const displayName = profile?.displayName ?? truncateNpub(pubkey);
  const profileDescription = profile?.about?.trim() ?? "";
  const profileSubheader = profileDescription || profile?.nip05Handle?.trim();

  const profileHeaderContent = (
    <>
      <ProfileAvatar
        avatarUrl={profile?.avatarUrl ?? null}
        className="h-10 w-10 text-xs"
        iconClassName="h-5 w-5"
        label={displayName}
        testId="user-profile-popover-avatar"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <HoverPubkeyName displayName={displayName} pubkey={pubkey} />
        </div>
        {profileSubheader ? (
          <p
            className="mt-0.5 truncate text-xs leading-4 text-muted-foreground"
            data-testid="user-profile-description"
          >
            {profileSubheader}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <PopoverContent
      align="start"
      className="w-80"
      data-testid="user-profile-popover"
      onMouseEnter={onContentMouseEnter}
      onMouseLeave={onMouseLeave}
      // This is a hover card: moving focus into its first button on open
      // makes the profile header look keyboard-selected before the user has
      // interacted with it. Keep focus on the trigger; Tab still enters the
      // card and shows its normal focus treatment when needed.
      onOpenAutoFocus={(event) => event.preventDefault()}
      side="top"
      sideOffset={8}
    >
      {canOpenProfilePanel ? (
        <button
          className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg text-left text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&_*]:cursor-pointer"
          onClick={onTriggerClick}
          type="button"
        >
          {profileHeaderContent}
        </button>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-3 text-left text-foreground">
          {profileHeaderContent}
        </div>
      )}
    </PopoverContent>
  );
}

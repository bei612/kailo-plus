import * as React from "react";

import { useUserProfileQuery } from "./host";
import { usePresenceHost } from "../presence/context";
import { usePresenceQuery } from "../presence/hooks";
import { aggregatePresence } from "../presence/lib/presence";
import { ProfileAvatarWithStatus } from "../presence/ui/ProfileAvatarWithStatus";
import { newestVisibleUserStatus, useUserStatusQuery } from "../user-status/hooks";
import { StatusEmoji } from "../user-status/ui/StatusEmoji";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "../profile/avatar-host";
import { useUiLocale, useUiT } from "../context";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../profile/buzz/shared/ui/button";
import { Spinner } from "../profile/buzz/shared/ui/spinner";
import { useProfileDirectMessage } from "./profile-direct-message";
import type { WebProfileView } from "@client-kit/contracts";
import { usePulseHost } from "./host";
import { cn } from "../profile/buzz/shared/lib/cn";
import { truncateNpub } from "./host";
import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../conversations/popover";

type UserProfilePopoverProps = {
  children: React.ReactNode;
  role?: string;
  botIdenticonValue?: string;
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

export function UserProfilePopover(props: UserProfilePopoverProps) {
  const host = usePulseHost();
  return <UserProfilePopoverSurface {...props} onOpenProfile={host.openProfile}
    renderBody={(body) => <PulseProfilePopoverBody {...body} />} />;
}

export function UserProfilePopoverSurface({
  children,
  pubkey,
  role,
  triggerElement = "div",
  triggerAriaLabel,
  triggerClassName,
  triggerTestId,
  enableProfilePanel = true,
  enableHoverPopover = true,
  onOpenProfile: openProfilePanel,
  renderBody,
}: UserProfilePopoverProps & {
  onOpenProfile?: (pubkey: string) => void;
  renderBody: (props: ProfilePopoverBodyProps) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
        renderBody({canOpenProfilePanel,onContentMouseEnter:handleContentMouseEnter,
          onMouseLeave:handleMouseLeave,onTriggerClick:handleTriggerClick,pubkey,role,
          onClose:()=>{clearHoverTimer();setOpen(false);}})
      ) : null}
    </Popover>
  );
}

/**
 * Everything behind the popover surface. Mounted only while the popover is
 * open — the trigger shell above stays cheap enough for grids that render
 * hundreds of instances.
 */
export type ProfilePopoverBodyProps = {
  canOpenProfilePanel: boolean;
  onContentMouseEnter: () => void;
  onMouseLeave: () => void;
  onTriggerClick: (event: React.MouseEvent) => void;
  pubkey: string;
  role?: string;
  /** Closes the hover card (original handleMessage closes it after navigating). */
  onClose?: () => void;
};

function PulseProfilePopoverBody(props: ProfilePopoverBodyProps) {
  const host=usePulseHost();
  const profile=useUserProfileQuery(props.pubkey);
  return <UserProfilePopoverBody {...props} profile={profile.data} mediaUrl={host.mediaUrl}/>;
}

// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePopover.tsx::StatusLine.
function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex w-full min-w-0 items-center gap-1 py-1 text-xs leading-4 text-muted-foreground"
      data-testid="user-profile-status"
    >
      {children}
    </div>
  );
}

/**
 * DD-120 (5): a Human is online if any bound key is online; a key without a fact is not
 * painted offline. Agents keep their installation-active presence elsewhere, so a bot
 * profile shows no Relay presence here.
 */
function PresenceProfileAvatar({ pubkeys, ...avatar }: {
  pubkeys: readonly string[];
  avatarUrl: string | null;
  label: string;
}) {
  const presence = usePresenceQuery(pubkeys);
  return (
    <ProfileAvatarWithStatus
      avatarClassName="text-xs"
      avatarUrl={avatar.avatarUrl}
      className="h-10 w-10"
      iconClassName="h-5 w-5"
      label={avatar.label}
      size={40}
      status={aggregatePresence(presence.isSuccess ? presence.data : undefined, pubkeys)}
      statusTestId="user-profile-popover-presence-badge"
      testId="user-profile-popover-avatar"
    />
  );
}

function ProfileStatusLine({ pubkeys, actions }: { pubkeys: readonly string[]; actions?: React.ReactNode }) {
  const userStatusQuery = useUserStatusQuery(pubkeys);
  const userStatus = newestVisibleUserStatus(userStatusQuery.data, pubkeys);
  const userStatusText = userStatus?.text.trim() ?? "";
  const hasUserStatus = Boolean(userStatusText || userStatus?.emoji);
  if (!hasUserStatus && !actions) return null;
  return (
    <>
      <div aria-hidden="true" className="my-1 border-t border-border/60" />
      {hasUserStatus ? <StatusLine>
        {userStatus?.emoji ? (
          <StatusEmoji className="h-3.5 w-3.5 shrink-0" value={userStatus.emoji} />
        ) : null}
        {userStatusText ? <span className="truncate">{userStatusText}</span> : null}
      </StatusLine> : null}
      {actions}
    </>
  );
}

/**
 * Original hover-card Wave and Message actions (useProfileInteractionActions): one action at a
 * time; DD-125(3) Wave sends the marked DM kind:9 through the host's DM publication.
 */
function ProfileMessageAction({ pubkey, onClose }: { pubkey: string; onClose?: () => void }) {
  const t = useUiT();
  const directMessage = useProfileDirectMessage();
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [pendingAction, setPendingAction] = React.useState<"message" | "wave" | null>(null);
  if (!directMessage) return null;
  const wave = directMessage.wave;
  const canWave = wave !== undefined && directMessage.canWave?.(pubkey) !== false;
  return (
    <div className="flex gap-2">
      {wave && canWave ? (
        <Button aria-label={t("platform.profile.wave")}
          className="buzz-wave-hover-trigger shrink-0 px-3 transition-transform duration-100 ease-out motion-reduce:transition-none motion-safe:active:scale-[0.97]"
          data-testid={`user-profile-popover-wave-${pubkey}`} disabled={pendingAction !== null}
          onClick={() => {
            if (pendingAction !== null) return;
            setPendingAction("wave");
            void wave(pubkey, () => { if (mounted.current) onClose?.(); }).catch(
              (error: unknown) => { toast.error(error instanceof Error && error.message ? error.message : t("platform.profile.waveFailed")); },
            ).finally(() => { if (mounted.current) setPendingAction(null); });
          }}
          size="sm" type="button" variant="outline">
          {pendingAction === "wave" ? <Spinner aria-hidden="true" className="h-3.5 w-3.5 border-2" />
            : <span aria-hidden="true" className="buzz-wave-hand text-sm leading-none">👋</span>}
        </Button>
      ) : null}
      <Button className="min-w-0 flex-1" data-testid={`user-profile-popover-message-${pubkey}`} disabled={pendingAction !== null}
        onClick={() => {
          if (pendingAction !== null) return;
          setPendingAction("message");
          void directMessage.open(pubkey).then(
            () => { if (mounted.current) onClose?.(); },
            (error: unknown) => { toast.error(error instanceof Error ? error.message : t("platform.profile.openDmFailed")); },
          ).finally(() => { if (mounted.current) setPendingAction(null); });
        }}
        size="sm" type="button" variant="outline">
        {pendingAction === "message" ? <Spinner aria-hidden="true" className="h-3.5 w-3.5 border-2" /> : <MessageSquare />}
        {t("platform.profile.message")}
      </Button>
    </div>
  );
}

export function UserProfilePopoverBody({
  canOpenProfilePanel,
  onContentMouseEnter,
  onMouseLeave,
  onTriggerClick,
  onClose,
  pubkey,
  role,
  profile,
  mediaUrl,
  status,
  presencePubkeys,
}: ProfilePopoverBodyProps & {
  profile: Pick<WebProfileView, "displayName" | "avatarUrl" | "about" | "nip05Handle"> | undefined;
  mediaUrl: (url: string) => string;
  status?: React.ReactNode;
  /** Every admitted key of this person (WorkspaceMemberView.pubkeys); defaults to `pubkey`. */
  presencePubkeys?: readonly string[];
}) {
  const locale=useUiLocale();
  const presenceHost = usePresenceHost();
  const directMessage = useProfileDirectMessage();
  // Original showMessageAction: other people only, once the profile is loaded; agents are not DM targets (03 L122).
  const messageAction = directMessage && profile && role !== "bot" && directMessage.canMessage(pubkey)
    ? <ProfileMessageAction onClose={onClose} pubkey={pubkey} /> : null;
  const identityKeys = presencePubkeys && presencePubkeys.length > 0 ? presencePubkeys : [pubkey];
  const displayName = profile?.displayName ?? truncateNpub(pubkey);
  const profileDescription = profile?.about?.trim() ?? "";
  const profileSubheader = profileDescription || profile?.nip05Handle?.trim();

  const profileHeaderContent = (
    <>
      <AvatarHostProvider value={{locale,rewriteMediaUrl:mediaUrl}}>{presenceHost && role !== "bot" ? <PresenceProfileAvatar
        avatarUrl={profile?.avatarUrl ?? null}
        label={displayName}
        pubkeys={identityKeys}
      /> : <ProfileAvatar
        avatarUrl={profile?.avatarUrl ?? null}
        className="h-10 w-10 text-xs"
        iconClassName="h-5 w-5"
        label={displayName}
        shape={role === "bot" ? "squircle" : "circle"}
        testId="user-profile-popover-avatar"
      />}</AvatarHostProvider>

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
      {status}
      <div className="flex flex-col gap-3">
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
      {presenceHost ? <ProfileStatusLine actions={messageAction} pubkeys={identityKeys} />
        : messageAction ? <><div aria-hidden="true" className="my-1 border-t border-border/60" />{messageAction}</> : null}
      </div>
    </PopoverContent>
  );
}

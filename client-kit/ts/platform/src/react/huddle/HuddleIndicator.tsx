// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/HuddleIndicator.tsx::HuddleIndicator
// desktop/src/features/channels/ui/ChannelMembersBar.tsx (huddleIndicator, onStart)
// desktop/src/features/channels/lib/huddleAvailability.ts::canStartHuddleInChannel
// DD-125(3): the original channel-header Start/Join control. The live session is the parent's
// ACTIVE HuddleBuzzBinding whose verified lifecycle still reconstructs as active (original
// reconstruct); join goes through the host with that binding. Start submits the governed
// huddle.start for this parent (Core admits it). The original Ctrl+Shift+Space shortcut
// event starts or joins for the focused channel. Agents are not pre-selected from the header,
// matching the original channel start (Agents join through Add agent).
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Headphones } from "lucide-react";
import { toast } from "sonner";
import { useT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { HUDDLE_SHORTCUT_EVENT, type HuddleShortcutDetail } from "../../keyboard-shortcuts";
import { useFormatHuddleError, useHuddle } from "./HuddleContext";
import { useHuddlePlural } from "./plural";
import { type HuddleParent, useHuddleHost } from "./host";
import { huddleParentQueryKey, useActiveParentHuddle } from "./queries";

type HuddleIndicatorProps = {
  parent: HuddleParent;
  /** Original buildHuddleChannelName for this parent. */
  channelName: string;
  className?: string;
  renderMode?: "button" | "menu-item";
  /** Original canStartHuddleInChannel and the member-loading gate. */
  startDisabled?: boolean;
};

export function HuddleIndicator({ parent, channelName, className, renderMode = "button", startDisabled = false }: HuddleIndicatorProps) {
  const t = useT();
  const plural = useHuddlePlural();
  const host = useHuddleHost();
  const formatHuddleError = useFormatHuddleError();
  const { activeEphemeralChannelId, joinHuddle, startHuddle, isStarting } = useHuddle();
  const queryClient = useQueryClient();
  const { binding, active } = useActiveParentHuddle(parent);
  const [isJoining, setIsJoining] = React.useState(false);
  const unavailable = host.unavailableReason !== null;
  const unavailableLabel = host.unavailableReason === "insecure-context"
    ? t("huddle.unavailable.insecure")
    : host.unavailableReason === "codec-unsupported" ? t("huddle.unavailable.codec") : null;

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: huddleParentQueryKey(parent) });
  }, [parent, queryClient]);

  const doStart = React.useCallback(async () => {
    try {
      await startHuddle(parent, [], channelName);
      refresh();
    } catch (error) {
      console.error("Failed to start huddle:", error);
      toast.error(formatHuddleError(error, "start"));
    }
  }, [channelName, formatHuddleError, parent, refresh, startHuddle]);

  const doJoin = React.useCallback(async () => {
    if (!active || !binding || isJoining) return;
    setIsJoining(true);
    try {
      await joinHuddle(parent, active.ephemeralChannelId, binding.huddleId);
      refresh();
    } catch (error) {
      console.error("Failed to join huddle:", error);
      toast.error(formatHuddleError(error, "join"));
    } finally {
      setIsJoining(false);
    }
  }, [active, binding, formatHuddleError, isJoining, joinHuddle, parent, refresh]);

  React.useEffect(() => {
    function handleHuddleShortcut(event: Event) {
      const { channelId } = (event as CustomEvent<HuddleShortcutDetail>).detail;
      if (channelId !== parent.channelId || activeEphemeralChannelId || isStarting || isJoining || unavailable) return;
      if (active) {
        void doJoin();
        return;
      }
      if (!startDisabled) void doStart();
    }
    window.addEventListener(HUDDLE_SHORTCUT_EVENT, handleHuddleShortcut);
    return () => window.removeEventListener(HUDDLE_SHORTCUT_EVENT, handleHuddleShortcut);
  }, [active, activeEphemeralChannelId, doJoin, doStart, isJoining, isStarting, parent.channelId, startDisabled, unavailable]);

  if (!active) {
    const disabled = startDisabled || isStarting || unavailable || Boolean(activeEphemeralChannelId);
    if (renderMode === "menu-item") {
      return (
        <DropdownMenuItem className={className} data-testid="channel-start-huddle-trigger" disabled={disabled}
          onSelect={() => void doStart()}>
          <Headphones />
          <span>{t("huddle.start")}</span>
        </DropdownMenuItem>
      );
    }
    return (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <span className="inline-flex" data-testid="channel-huddle-tooltip-trigger">
            <Button aria-label={t("huddle.start")} className={className} data-testid="channel-start-huddle-trigger"
              disabled={disabled} onClick={() => void doStart()} size="icon" type="button" variant="outline">
              <Headphones />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{unavailableLabel ?? t("huddle.label")}</TooltipContent>
      </Tooltip>
    );
  }

  // At least one participant exists while a huddle is active; floor at 1 when the start event
  // fell out of the window (original).
  const participantCount = Math.max(1, active.participants.size);
  const joinDisabled = isJoining || isStarting || unavailable || activeEphemeralChannelId === active.ephemeralChannelId;

  if (renderMode === "menu-item") {
    return (
      <DropdownMenuItem className={className} data-testid="channel-start-huddle-trigger" disabled={joinDisabled}
        onSelect={() => void doJoin()}>
        <Headphones />
        <span>{t("huddle.join")}</span>
        <span className="ml-auto text-xs text-muted-foreground">{participantCount}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={plural("huddle.joinActive", participantCount)} className={cn("relative", className)}
          disabled={joinDisabled} onClick={() => void doJoin()} size="icon" type="button" variant="outline">
          <Headphones />
          <span className="absolute inset-0 animate-pulse rounded-lg ring-2 ring-border/70" />
          {participantCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-border bg-background px-0.5 text-2xs font-bold text-muted-foreground">
              {participantCount}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{unavailableLabel ?? plural("huddle.activeTooltip", participantCount)}</TooltipContent>
    </Tooltip>
  );
}

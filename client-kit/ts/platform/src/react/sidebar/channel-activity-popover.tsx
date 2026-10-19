// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/ChannelActivityPopover.tsx: the hover/focus popover on a working
// channel row with the original WorkingAgentRows (DD-125(6)). Kailo differences:
// - Agent rows come from the shared agentWorkingSignal (audited turns primary, Agent 20002 typing
//   fallback); the elapsed clock and the "View activity" entry are only offered for Installation
//   `audit` holders, members get the same row without either.
// - The original unread-thread rows (buildInboxItems over the desktop home feed) have no channel
//   scoped source on the Web sidebar yet; the Web keeps them in Inbox, so the popover opens only for
//   working channels.
import * as React from "react";
import { Loader2 } from "lucide-react";

import { useUiT } from "../context";
import { DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS, Popover, PopoverAnchor, PopoverContent } from "../conversations/popover";
import { UserAvatar } from "../messages/UserAvatar";
import { truncateNpub } from "../conversations/pubkey";
import { useNow } from "../useNow";
import { formatElapsed, useOpenAgentActivity } from "../agent-transcript";
import { getWorkingAgentInfo, normalizePubkey, type ActiveChannelTurnSummary, type WorkingChannelSummary } from "../agent-activity/agentWorkingSignal";
import { hasAuditedAnchor } from "../agent-activity/ChannelWorkingBadge";

const HOVER_CLOSE_DELAY_MS = 180;
const ACTIVITY_POPOVER_MOTION_STYLE = {
  "--tw-enter-scale": "1",
  "--tw-exit-scale": "1",
} as React.CSSProperties;

function WorkingAgentRow({
  avatarUrl,
  elapsed,
  initialsLabel,
  name,
  onOpen,
  pubkey,
}: {
  avatarUrl: string | null;
  elapsed: string | null;
  initialsLabel: string;
  name: string;
  onOpen?: () => void;
  pubkey: string;
}) {
  const t = useUiT();
  const content = <>
    <UserAvatar
      avatarUrl={avatarUrl}
      className="h-9 w-9 shrink-0"
      displayName={name}
      initialsLabel={initialsLabel}
      shape="squircle"
      size="md"
    />
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-4 text-foreground">
          {name}
        </span>
        {elapsed !== null ? (
          <span className="shrink-0 text-xs leading-4 text-muted-foreground/70">
            {elapsed}
          </span>
        ) : null}
      </div>
      <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70" />
        {t("agentActivity.popover.working")}
      </span>
    </div>
  </>;
  // Members without Installation audit see the same row, but there is no activity to open.
  return onOpen ? (
    <button
      className="flex w-full min-w-0 items-start gap-2.5 border-t border-border/50 px-3 py-3 text-left transition-colors first:border-t-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-hidden"
      data-testid={`channel-activity-agent-${pubkey}`}
      onClick={onOpen}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div
      className="flex w-full min-w-0 items-start gap-2.5 border-t border-border/50 px-3 py-3 text-left first:border-t-0"
      data-testid={`channel-activity-agent-${pubkey}`}
    >
      {content}
    </div>
  );
}

/** Original WorkingAgentRows: generated `Agent npub1…` fallback label feeds the avatar initials. */
export function WorkingAgentRows({
  activeWorking,
  channelId,
  onOpen,
}: {
  activeWorking: ActiveChannelTurnSummary | WorkingChannelSummary;
  channelId: string;
  onOpen: (pubkey: string, channelId: string) => void;
}) {
  const t = useUiT();
  const now = useNow(1000);
  const elapsed = hasAuditedAnchor(activeWorking) ? formatElapsed(now - activeWorking.anchorAt) : null;
  const alignedAgentNames =
    activeWorking.agentNames?.length === activeWorking.agentPubkeys.length
      ? activeWorking.agentNames
      : null;

  return activeWorking.agentPubkeys.map((pubkey, index) => {
    const info = getWorkingAgentInfo(channelId, pubkey);
    const authoredName = info?.name.trim() || alignedAgentNames?.[index];
    const keyLabel = truncateNpub(pubkey);
    const name = authoredName || t("agentActivity.agentFallbackName", { key: keyLabel });
    return (
      <WorkingAgentRow
        avatarUrl={null}
        elapsed={elapsed}
        initialsLabel={authoredName || keyLabel}
        key={pubkey}
        name={name}
        onOpen={info?.canOpenActivity ? () => onOpen(normalizePubkey(pubkey), channelId) : undefined}
        pubkey={pubkey}
      />
    );
  });
}

export function ChannelActivityPopover({
  activeWorking,
  channel,
  children,
}: {
  activeWorking?: ActiveChannelTurnSummary | WorkingChannelSummary;
  channel: { id: string; name: string };
  children: React.ReactNode;
}) {
  const t = useUiT();
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { openAgentActivity } = useOpenAgentActivity();
  const hasContent = (activeWorking?.agentPubkeys.length ?? 0) > 0;

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const openWithDelay = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, hasContent]);
  const openImmediately = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    setOpen(true);
  }, [clearHoverTimer, hasContent]);
  const closeWithDelay = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);
  const keepOpen = React.useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  React.useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);
  React.useEffect(() => {
    if (!hasContent) {
      setOpen(false);
    }
  }, [hasContent]);

  if (!hasContent || !activeWorking) {
    return <>{children}</>;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {/* Hover/focus events bubble from the nested channel button while the wrapper keeps the preview interactive. */}
      <div
        className="w-full min-w-0"
        onBlur={closeWithDelay}
        onContextMenu={() => setOpen(false)}
        onFocus={openImmediately}
        onMouseEnter={openWithDelay}
        onMouseLeave={closeWithDelay}
      >
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      </div>
      <PopoverContent
        align="start"
        className="w-96 overflow-hidden p-0"
        data-testid={`channel-activity-popover-${channel.name}`}
        onFocusCapture={keepOpen}
        onMouseEnter={keepOpen}
        onMouseLeave={closeWithDelay}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={0}
        style={ACTIVITY_POPOVER_MOTION_STYLE}
      >
        <section
          aria-label={t("agentActivity.popover.title")}
          className="flex max-h-96 min-h-0 flex-col overflow-hidden"
        >
          <h3
            className="relative z-20 shrink-0 border-b border-border/70 bg-background/95 px-3 py-2 text-sm font-semibold text-foreground backdrop-blur-md supports-[backdrop-filter]:bg-background/90"
            data-testid="channel-activity-header"
          >
            {t("agentActivity.popover.title")}
          </h3>
          <div
            className="buzz-channel-activity-scrollbar min-h-0 overflow-y-auto overscroll-contain"
            data-testid="channel-activity-scroll"
          >
            <WorkingAgentRows
              activeWorking={activeWorking}
              channelId={channel.id}
              onOpen={(pubkey, channelId) => {
                setOpen(false);
                openAgentActivity(pubkey, { channelId });
              }}
            />
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

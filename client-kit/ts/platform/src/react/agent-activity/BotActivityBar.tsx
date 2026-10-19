// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/BotActivityBar.tsx::BotActivityComposerAction, original DOM/classes.
// DD-125(6): the rotating activity headline comes from the Agent's session transcript, which only an
// Installation `audit` holder may read; everyone else sees "<name>: Working" / "<n> agents working"
// from the Agent's 20002 signal. "View activity" is offered only where the transcript is readable.
// An Installation lives in exactly one Workspace channel, so its transcript needs no channel filter.
import * as React from "react";
import { Loader2 } from "lucide-react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS, Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { Shimmer } from "../messages/Shimmer";
import { UserAvatar } from "../messages/UserAvatar";
import { getActivityHeadline, isMeaningfulItem, isSpineItem, useAgentTranscript } from "../agent-transcript";

export type BotActivityAgent = {
  pubkey: string;
  name: string;
  /** Present only with Installation `audit`: the transcript and "View activity" are readable. */
  auditInstallationId?: string;
  avatarUrl?: string | null;
};

type BotActivityBarProps = {
  agents: BotActivityAgent[];
  channelId?: string | null;
  onOpenAgentSession: (pubkey: string, channelId?: string | null) => void;
  openAgentSessionPubkey: string | null;
  workingBotPubkeys: string[];
  variant?: "toolbar" | "inline";
  resolveMediaUrl?: (url: string) => string | undefined;
};

const HOVER_CLOSE_DELAY_MS = 180;
const HEADLINE_ROTATION_MS = 2200;

export function BotActivityComposerAction({
  agents,
  channelId = null,
  onOpenAgentSession,
  openAgentSessionPubkey,
  workingBotPubkeys,
  variant = "toolbar",
  resolveMediaUrl,
}: BotActivityBarProps) {
  const t = useUiT();
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const workingAgents = React.useMemo(() => {
    const workingSet = new Set(workingBotPubkeys.map((pubkey) => pubkey.toLowerCase()));
    return agents.filter((agent) => workingSet.has(agent.pubkey.toLowerCase()));
  }, [agents, workingBotPubkeys]);
  const singleWorkingAgent = workingAgents.length === 1 ? (workingAgents[0] ?? null) : null;
  const transcriptInstallation = singleWorkingAgent?.auditInstallationId ?? null;
  const transcript = useAgentTranscript(transcriptInstallation, transcriptInstallation !== null);
  const activityHeadlines = React.useMemo(() => {
    if (!singleWorkingAgent || transcriptInstallation === null) return [];
    const seen = new Set<string>();
    const headlines: string[] = [];
    // Two-tier scan: spine items first (reads recede when real work is present). If no spine
    // headlines are found (session start / idle), fall back to all meaningful items.
    const passFilter: (item: (typeof transcript)[number]) => boolean =
      transcript.some(isSpineItem) ? isSpineItem : isMeaningfulItem;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const item = transcript[i];
      if (!item || !passFilter(item)) continue;
      const headline = getActivityHeadline(item);
      if (!headline || seen.has(headline)) continue;
      seen.add(headline);
      headlines.unshift(headline);
      if (headlines.length >= 5) break;
    }
    return headlines;
  }, [singleWorkingAgent, transcriptInstallation, transcript]);
  const [headlineIndex, setHeadlineIndex] = React.useState(0);

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const openWithDelay = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer]);
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
    if (activityHeadlines.length <= 1) return;
    const interval = window.setInterval(() => {
      setHeadlineIndex((current) => (current + 1) % activityHeadlines.length);
    }, HEADLINE_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [activityHeadlines.length]);

  if (workingAgents.length === 0) return null;

  const fallbackName = t("agentActivity.agentFallback");
  const selectedPubkey = openAgentSessionPubkey?.toLowerCase() ?? null;
  const triggerLabel = workingAgents.length === 1
    ? t("agentActivity.composer.triggerOne", { name: workingAgents[0]?.name ?? fallbackName })
    : t("agentActivity.composer.triggerMany", { count: workingAgents.length });
  const isInline = variant === "inline";
  const visibleStatusLabel = workingAgents.length === 1
    ? t("agentActivity.composer.statusOne", {
      name: workingAgents[0]?.name ?? fallbackName,
      headline: activityHeadlines[headlineIndex % activityHeadlines.length] ?? t("agentActivity.composer.working"),
    })
    : t("agentActivity.composer.statusMany", { name: workingAgents[0]?.name ?? fallbackName, count: workingAgents.length - 1 });

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("agentActivity.composer.viewActivityAria", { label: triggerLabel })}
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-border/60 bg-background font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:border-primary/40 data-[state=open]:bg-primary/10 data-[state=open]:text-primary",
            isInline
              ? "min-w-0 gap-1.5 overflow-visible border-transparent bg-transparent px-0 text-xs font-normal leading-normal shadow-none hover:border-transparent hover:bg-transparent data-[state=open]:border-transparent data-[state=open]:bg-transparent"
              : "h-9 min-w-9 gap-1.5 px-2 text-xs",
          )}
          data-testid="bot-activity-composer-trigger"
          onBlur={closeWithDelay}
          onClick={() => {
            clearHoverTimer();
            setOpen((current) => !current);
          }}
          onFocus={() => setOpen(true)}
          onMouseEnter={openWithDelay}
          onMouseLeave={closeWithDelay}
          type="button"
        >
          <span className="flex h-4.5 items-center overflow-visible -space-x-1">
            {workingAgents.slice(0, 2).map((agent) => (
              <UserAvatar
                avatarUrl={agent.avatarUrl ?? null}
                className={cn(
                  "border border-background",
                  isInline ? "!h-4.5 !w-4.5 text-3xs" : "shrink-0",
                )}
                displayName={agent.name}
                shape="squircle"
                fallbackDelayMs={isInline ? 0 : undefined}
                key={agent.pubkey}
                resolveMediaUrl={resolveMediaUrl}
                size="xs"
                testId={`bot-activity-composer-avatar-${agent.pubkey}`}
              />
            ))}
          </span>
          {workingAgents.length > 2 ? (
            <span className="text-2xs leading-none">+{workingAgents.length - 2}</span>
          ) : null}
          <span
            className={cn(
              isInline
                ? "flex h-4.5 min-w-0 flex-1 items-center overflow-visible leading-none"
                : "sr-only",
            )}
          >
            {isInline ? (
              <Shimmer className="-my-px truncate py-px">{visibleStatusLabel}</Shimmer>
            ) : (
              t("agentActivity.composer.srWorking")
            )}
          </span>
          {isInline ? null : <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={isInline ? "start" : "end"}
        className="w-64 p-1"
        onMouseEnter={keepOpen}
        onMouseLeave={closeWithDelay}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
      >
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {t("agentActivity.composer.popoverTitle")}
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {workingAgents.map((agent) => {
            const isSelected = selectedPubkey === agent.pubkey.toLowerCase();
            const canOpen = agent.auditInstallationId !== undefined;
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default",
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
                data-testid={`bot-activity-composer-item-${agent.pubkey}`}
                disabled={!canOpen}
                key={agent.pubkey}
                onClick={() => {
                  if (!canOpen) return;
                  clearHoverTimer();
                  setOpen(false);
                  onOpenAgentSession(agent.pubkey, channelId);
                }}
                type="button"
              >
                <UserAvatar
                  avatarUrl={agent.avatarUrl ?? null}
                  className="shrink-0"
                  displayName={agent.name}
                  resolveMediaUrl={resolveMediaUrl}
                  shape="squircle"
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                {canOpen ? (
                  <span className="shrink-0 whitespace-nowrap text-xs font-medium opacity-80">
                    {t("agentActivity.viewActivity")}
                  </span>
                ) : null}
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground/70" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

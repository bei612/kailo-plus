// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/SidebarSection.tsx::ChannelWorkingBadge/formatWorkingTooltip.
// Original DOM/classes; the anchor is the audited native turn start or, for members, first-seen
// Agent 20002 typing (agentWorkingSignal).
import { useUiT, type Translate } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useNow } from "../useNow";
import { formatElapsed } from "../agent-transcript";
import type { ActiveChannelTurnSummary, WorkingChannelSummary } from "./agentWorkingSignal";

/**
 * The elapsed clock is the turn start, which only Installation `audit` holders receive
 * (DD-125(6)); a typing-only summary (members) shows the original "Working" text instead.
 */
export function hasAuditedAnchor(summary: ActiveChannelTurnSummary | WorkingChannelSummary): boolean {
  return !("source" in summary) || summary.source === "turn";
}

function formatAgentCount(count: number, t: Translate): string {
  return t(count === 1 ? "agentActivity.agentCount.one" : "agentActivity.agentCount.other", { count });
}

export function formatWorkingTooltip(summary: ActiveChannelTurnSummary, t: Translate): string {
  const leadName = summary.agentNames?.[0];
  if (!leadName) return t("agentActivity.tooltip.anonymous", { agents: formatAgentCount(summary.agentCount, t) });
  const remainingAgentCount = summary.agentCount - 1;
  if (remainingAgentCount <= 0) return t("agentActivity.tooltip.lead", { name: leadName });
  return t("agentActivity.tooltip.leadAndMore", { name: leadName, agents: formatAgentCount(remainingAgentCount, t) });
}

export function ChannelWorkingBadge({
  channelName,
  isActive,
  summary,
}: {
  channelName: string;
  isActive: boolean;
  summary: ActiveChannelTurnSummary | WorkingChannelSummary;
}) {
  const t = useUiT();
  const now = useNow(1000);
  const elapsed = hasAuditedAnchor(summary) ? formatElapsed(now - summary.anchorAt) : t("agentActivity.popover.working");
  const label = summary.agentCount > 1 ? `${elapsed} (${summary.agentCount})` : elapsed;
  const title = formatWorkingTooltip(summary, t);

  return (
    <span
      className={cn(
        "max-w-32 shrink-0 truncate rounded-full px-1.5 py-0.5 text-2xs font-medium leading-none tabular-nums motion-safe:animate-pulse group-data-[collapsible=icon]:hidden",
        "hidden sm:inline-flex",
        isActive
          ? "bg-sidebar-active-foreground/20 text-sidebar-active-foreground"
          : "bg-primary/10 text-primary",
      )}
      data-testid={`channel-working-${channelName}`}
      title={title}
    >
      {label}
    </span>
  );
}

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/AgentSessionTranscriptList.tsx (original DOM,
// classes and motion). Liveness comes from the Session's active turn or a live
// turn/started frame instead of the ACP active-turn store; the prompt-context
// dialog and ACP source badges have no Kailo input (see agentTranscriptAdapter).
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clock, Radio } from "lucide-react";

import { useUiLocale, useUiT } from "../context";
import type { UserProfileLookup } from "../messages/system/identity";
import { AnimatedCount } from "../pulse/AnimatedCount";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  ActivityRow,
  ActivityRowContent,
  ActivityRowLabel,
  splitActivityRowCountedObject,
  splitActivityRowLabel,
  type ActivityRowStats,
} from "./ActivityRow";
import {
  type AgentTranscriptIdentityProps,
  TranscriptActivityItem,
  TranscriptTimestamp,
  UserMessageBubble,
} from "./activityRenderers";
import {
  AgentSessionTranscriptVariantProvider,
  type AgentSessionTranscriptVariant,
  useAgentSessionTranscriptVariant,
} from "./agentSessionTranscriptContext";
import type { TranscriptItem } from "./agentSessionTypes";
import type { FileEditDiff } from "./agentSessionFileEditDiff";
import {
  buildTranscriptDisplayBlocks,
  getDisplayBlockKey,
  type TranscriptDisplayBlock,
  type TranscriptTurnSegment,
} from "./agentSessionTranscriptGrouping";
import { buildCompactToolSummary } from "./agentSessionToolSummary";
import { shouldShowTranscriptRowTimestamp } from "./agentSessionTranscriptPresentation";
import { formatTranscriptTimestampTitle } from "./agentSessionUtils";
import { hasFileEditLineDiff } from "./FileContentBlock";
import { FuzzyLogo, TurnLivenessIndicator } from "./TurnLivenessIndicator";
import {
  useTranscriptAnimationEnabled,
  useTranscriptTimestampsEnabled,
} from "./transcriptPreferences";

const ROW_ENTER_SPRING = {
  damping: 38,
  stiffness: 480,
  type: "spring",
} as const;
const ROW_ENTER_FROM = { opacity: 0, y: 12 } as const;
const ROW_ENTER_TO = { opacity: 1, y: 0 } as const;

/**
 * False during the mount commit, true afterwards. Children mounted with the
 * initial batch (history load) read false and skip their enter animation;
 * children appended later read true and animate in.
 */
function useHasCompletedInitialRender() {
  const ref = React.useRef(false);
  React.useEffect(() => {
    ref.current = true;
  }, []);
  return ref;
}

export type AgentSessionTranscriptEmptyState = "idle" | "loading";

export function AgentSessionTranscriptList({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  emptyDescription,
  emptyState = "idle",
  isTurnLive = false,
  items,
  latestLiveSessionId = null,
  profiles,
  contentContainerClassName,
  variant = "default",
}: AgentTranscriptIdentityProps & {
  emptyDescription: string;
  emptyState?: AgentSessionTranscriptEmptyState;
  /** A running turn of this Session (active Invocation or live turn/started). */
  isTurnLive?: boolean;
  items: TranscriptItem[];
  /** AgentSession key of the live-observed turn, for the boundary label. */
  latestLiveSessionId?: string | null;
  profiles?: UserProfileLookup;
  contentContainerClassName?: string;
  variant?: AgentSessionTranscriptVariant;
}) {
  const t = useUiT();
  const displayBlocks = React.useMemo(
    () => buildTranscriptDisplayBlocks(items, latestLiveSessionId),
    [items, latestLiveSessionId],
  );
  const isCompactPreview = variant === "compactPreview";
  const animationPreferenceEnabled = useTranscriptAnimationEnabled();
  const shouldReduceMotion = useReducedMotion();
  const animationsDisabled =
    Boolean(shouldReduceMotion) || !animationPreferenceEnabled;
  const hasCompletedInitialRenderRef = useHasCompletedInitialRender();
  const hasRenderableContent =
    items.length > 0 && hasRenderableDisplayContent(displayBlocks, variant);

  if (!hasRenderableContent) {
    const isLoading = emptyState === "loading" || isTurnLive;

    return (
      <div className="w-full">
        <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 py-10 text-center">
          {isLoading ? (
            <FuzzyLogo
              ariaLabel={t("agentTranscript.waiting")}
              className="mx-auto text-muted-foreground"
              fuzz={false}
              loop
            />
          ) : (
            <>
              <Radio className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                {t("agentTranscript.empty")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {emptyDescription}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <motion.div className="w-full" layoutScroll>
      <div
        aria-label={t("agentTranscript.liveTranscript")}
        aria-live="polite"
        className={cn(
          "flex w-full flex-col",
          isCompactPreview ? "gap-1" : "gap-4",
          contentContainerClassName,
        )}
        role="log"
      >
        <AgentSessionTranscriptVariantProvider value={variant}>
          {displayBlocks.map((block) => {
            const blockKey = getDisplayBlockKey(block);
            return (
              <motion.div
                animate={ROW_ENTER_TO}
                data-message-id={blockKey}
                initial={
                  animationsDisabled || !hasCompletedInitialRenderRef.current
                    ? false
                    : ROW_ENTER_FROM
                }
                key={blockKey}
                transition={ROW_ENTER_SPRING}
              >
                <div className="content-visibility-auto">
                  <TranscriptDisplayBlockView
                    agentAvatarUrl={agentAvatarUrl}
                    agentName={agentName}
                    agentPubkey={agentPubkey}
                    block={block}
                    profiles={profiles}
                  />
                </div>
              </motion.div>
            );
          })}
          {isTurnLive && !isCompactPreview ? <TurnLivenessIndicator /> : null}
        </AgentSessionTranscriptVariantProvider>
      </div>
    </motion.div>
  );
}

function hasRenderableDisplayContent(
  displayBlocks: TranscriptDisplayBlock[],
  variant: AgentSessionTranscriptVariant,
) {
  if (variant !== "compactPreview") {
    return displayBlocks.length > 0;
  }

  return displayBlocks.some(hasRenderableCompactBlock);
}

function hasRenderableCompactBlock(block: TranscriptDisplayBlock) {
  if (block.kind === "single") {
    return isRenderableCompactItem(block.item);
  }
  if (block.kind === "session-boundary") {
    return false;
  }

  return block.segments.some((segment) => {
    if (segment.kind === "item") {
      return isRenderableCompactItem(segment.item);
    }
    if (segment.kind === "prompt") {
      return true;
    }
    if (segment.kind === "summary") {
      return segment.summary.items.some(isRenderableCompactItem);
    }
    return false;
  });
}

function isRenderableCompactItem(item: TranscriptItem) {
  return item.renderClass !== "raw-rail" && item.renderClass !== "suppressed";
}

function TranscriptDisplayBlockView({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  block,
  profiles,
}: AgentTranscriptIdentityProps & {
  block: TranscriptDisplayBlock;
  profiles?: UserProfileLookup;
}) {
  const variant = useAgentSessionTranscriptVariant();
  const isCompactPreview = variant === "compactPreview";
  const animationPreferenceEnabled = useTranscriptAnimationEnabled();
  const shouldReduceMotion = useReducedMotion();
  const hasCompletedInitialRenderRef = useHasCompletedInitialRender();
  const animateSegmentEnter = animationPreferenceEnabled && !shouldReduceMotion;

  if (block.kind === "session-boundary") {
    return (
      <SessionBoundaryDivider
        labelState={block.labelState}
        sessionStartTimestamp={block.sessionStartTimestamp}
      />
    );
  }

  if (block.kind === "single") {
    return (
      <TranscriptItemRow
        agentAvatarUrl={agentAvatarUrl}
        agentName={agentName}
        agentPubkey={agentPubkey}
        item={block.item}
        profiles={profiles}
      />
    );
  }

  return (
    <div
      className={cn("flex flex-col", isCompactPreview ? "gap-2.5" : "gap-4")}
      data-testid="transcript-turn-group"
      data-turn-id={block.turnId}
    >
      {block.segments.map((segment) => (
        <motion.div
          animate={ROW_ENTER_TO}
          initial={
            animateSegmentEnter && hasCompletedInitialRenderRef.current
              ? ROW_ENTER_FROM
              : false
          }
          key={getTurnSegmentKey(block.turnId, segment)}
          transition={ROW_ENTER_SPRING}
        >
          <TranscriptTurnSegmentView
            agentAvatarUrl={agentAvatarUrl}
            agentName={agentName}
            agentPubkey={agentPubkey}
            profiles={profiles}
            segment={segment}
          />
        </motion.div>
      ))}
    </div>
  );
}

function getTurnSegmentKey(turnId: string, segment: TranscriptTurnSegment) {
  if (segment.kind === "setup") {
    return `turn:${turnId}:setup`;
  }
  if (segment.kind === "prompt") {
    return `turn:${turnId}:prompt:${segment.user.id}`;
  }
  if (segment.kind === "summary") {
    return segment.summary.id;
  }
  return segment.item.id;
}

function TranscriptTurnSegmentView({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  profiles,
  segment,
}: AgentTranscriptIdentityProps & {
  profiles?: UserProfileLookup;
  segment: TranscriptTurnSegment;
}) {
  if (segment.kind === "prompt") {
    return (
      <div data-testid="transcript-prompt-bundle">
        <UserMessageBubble
          bubbleClassName="p-2.5"
          footer={<TranscriptTimestamp timestamp={segment.user.timestamp} />}
          item={segment.user}
          profiles={profiles}
        />
      </div>
    );
  }

  if (segment.kind === "setup") {
    return null;
  }

  if (segment.kind === "summary") {
    return (
      <SameKindSummaryItem
        agentAvatarUrl={agentAvatarUrl}
        agentName={agentName}
        agentPubkey={agentPubkey}
        profiles={profiles}
        summary={segment.summary}
      />
    );
  }

  return (
    <TranscriptItemRow
      agentAvatarUrl={agentAvatarUrl}
      agentName={agentName}
      agentPubkey={agentPubkey}
      item={segment.item}
      profiles={profiles}
    />
  );
}

function SameKindSummaryItem({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  profiles,
  summary,
}: AgentTranscriptIdentityProps & {
  profiles?: UserProfileLookup;
  summary: Extract<TranscriptTurnSegment, { kind: "summary" }>["summary"];
}) {
  const groupedFileEditDiffs = React.useMemo(
    () =>
      summary.renderClass === "file-edit" || summary.variant === "mixed"
        ? getGroupedFileEditDiffs(summary.items)
        : [],
    [summary.items, summary.renderClass, summary.variant],
  );
  const groupedFileEditStats = summarizeFileEditDiffs(groupedFileEditDiffs);
  const expandsToToolItems = summary.items.every(
    (item) => item.type === "tool",
  );
  const variant = useAgentSessionTranscriptVariant();
  const timestampsEnabled = useTranscriptTimestampsEnabled();
  const showTimestamp = timestampsEnabled && variant !== "compactPreview";
  const childSegments = summary.segments ?? null;

  return (
    <>
      <ActivityRow
        className="flex flex-col gap-0.5"
        openToneScope="summary"
        testId="transcript-same-kind-summary"
        title={formatTranscriptTimestampTitle(summary.timestamp)}
      >
        <ToolRunSummaryLabel
          label={summary.label}
          stats={groupedFileEditStats}
        />
        <ActivityRowContent
          className={cn(
            "flex flex-col",
            expandsToToolItems || childSegments ? "gap-0.5" : "gap-1 pl-5",
          )}
        >
          {childSegments
            ? childSegments.map((child) =>
                child.kind === "summary" ? (
                  <SameKindSummaryItem
                    agentAvatarUrl={agentAvatarUrl}
                    agentName={agentName}
                    agentPubkey={agentPubkey}
                    key={child.summary.id}
                    profiles={profiles}
                    summary={child.summary}
                  />
                ) : (
                  <TranscriptActivityItem
                    agentAvatarUrl={agentAvatarUrl}
                    agentName={agentName}
                    agentPubkey={agentPubkey}
                    item={child.item}
                    key={child.item.id}
                    profiles={profiles}
                  />
                ),
              )
            : expandsToToolItems
              ? summary.items.map((item) => (
                  <TranscriptActivityItem
                    agentAvatarUrl={agentAvatarUrl}
                    agentName={agentName}
                    agentPubkey={agentPubkey}
                    item={item}
                    key={item.id}
                    profiles={profiles}
                  />
                ))
              : summary.items.map((item) => (
                  <p
                    className="truncate text-xs text-muted-foreground"
                    key={item.id}
                  >
                    {item.type === "tool"
                      ? item.descriptor.preview || item.descriptor.label
                      : item.title}
                  </p>
                ))}
        </ActivityRowContent>
      </ActivityRow>
      {showTimestamp ? (
        <TranscriptRowTimestamp timestamp={summary.timestamp} />
      ) : null}
    </>
  );
}

function getGroupedFileEditDiffs(items: TranscriptItem[]): FileEditDiff[] {
  return items.flatMap((item) => {
    if (item.type !== "tool" || item.isError) {
      return [];
    }

    const diff = buildCompactToolSummary(item).fileEditDiff;
    return diff && hasFileEditLineDiff(diff) ? [diff] : [];
  });
}

function summarizeFileEditDiffs(
  diffs: FileEditDiff[],
): ActivityRowStats | null {
  if (diffs.length === 0) {
    return null;
  }

  return diffs.reduce(
    (stats, diff) => ({
      additions: stats.additions + diff.additions,
      deletions: stats.deletions + diff.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function ToolRunSummaryLabel({
  label,
  stats,
}: {
  label: string;
  stats?: ActivityRowStats | null;
}) {
  const animationPreferenceEnabled = useTranscriptAnimationEnabled();
  const parts = splitActivityRowLabel(label);

  if (!parts) {
    return <span className="truncate text-sm font-medium">{label}</span>;
  }

  // Streaming bursts grow their count in place; rolling the digits makes the
  // increment legible, with a static value under reduced motion.
  const countedObject =
    animationPreferenceEnabled && typeof parts.object === "string"
      ? splitActivityRowCountedObject(parts.object)
      : null;
  const object = countedObject ? (
    <>
      <AnimatedCount value={countedObject.count} />
      {countedObject.rest}
    </>
  ) : (
    parts.object
  );

  return (
    <ActivityRowLabel
      object={object}
      openToneScope="summary"
      stats={stats}
      verb={parts.verb}
    />
  );
}

function TranscriptItemRow({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  item,
  profiles,
}: AgentTranscriptIdentityProps & {
  item: TranscriptItem;
  profiles?: UserProfileLookup;
}) {
  const variant = useAgentSessionTranscriptVariant();
  const timestampsEnabled = useTranscriptTimestampsEnabled();
  const showTimestamp = shouldShowTranscriptRowTimestamp(item, {
    enabled: timestampsEnabled,
    variant,
  });

  return (
    <div>
      <TranscriptActivityItem
        agentAvatarUrl={agentAvatarUrl}
        agentName={agentName}
        agentPubkey={agentPubkey}
        item={item}
        profiles={profiles}
      />
      {showTimestamp ? (
        <TranscriptRowTimestamp timestamp={item.timestamp} />
      ) : null}
    </div>
  );
}

/** Opt-in per-row timestamp, anchored bottom-left under the row content. */
function TranscriptRowTimestamp({ timestamp }: { timestamp: string }) {
  return (
    <div
      className="mt-0.5 flex justify-start"
      data-testid="transcript-row-timestamp"
    >
      <TranscriptTimestamp timestamp={timestamp} />
    </div>
  );
}

/**
 * Horizontal rule rendered between AgentSessions: the one with a live turn,
 * the most recent one, or an earlier one.
 */
function SessionBoundaryDivider({
  labelState,
  sessionStartTimestamp,
}: {
  labelState: "current" | "most-recent" | "earlier";
  sessionStartTimestamp: string;
}) {
  const t = useUiT();
  const locale = useUiLocale();
  const label =
    labelState === "current"
      ? t("agentTranscript.session.current")
      : labelState === "most-recent"
        ? t("agentTranscript.session.mostRecent")
        : t("agentTranscript.session.earlier");
  const started = new Date(sessionStartTimestamp);
  const formattedDate = Number.isNaN(started.getTime()) || started.getTime() <= 0
    ? null
    : started.toLocaleString(locale);
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      data-testid="session-boundary-divider"
    >
      <div className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {labelState === "current" ? (
          <Radio aria-hidden="true" className="h-3 w-3" />
        ) : (
          <Clock aria-hidden="true" className="h-3 w-3" />
        )}
        {label}
        {formattedDate ? ` · ${formattedDate}` : null}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

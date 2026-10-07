// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/TimelineMessageList.tsx virtual rows.
import * as React from "react";
import { VList, type VListHandle } from "virtua";
import { formatDayGroupLabel } from "../datetime";
import type { TimelineDayGroup, TimelineNonDayItem } from "./timelineItems";
import { buildVirtualizedItems, didPrependVirtualizedTimeline, estimateVirtualizedTimelineItemHeight, type VirtualizedTimelineItem, virtualizedItemKey } from "./virtualizedTimelineItems";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { channelChrome } from "../chromeLayout";
import { DayDivider } from "../DayDivider";
import { TimelineRowShell } from "./TimelineRowShell";
import { useTimelineRetention } from "./useTimelineRetention";
import { useUpwardPaginationWheel } from "./useUpwardPaginationWheel";
import { useVirtualizedBottomSettle } from "./useVirtualizedBottomSettle";
export type TimelineVirtualizerApi = {
  cancelBottomIntent: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  settleAtBottom: () => void;
  scrollToMessage: (
    messageId: string,
    options?: { behavior?: ScrollBehavior },
  ) => boolean;
};

function timelineItemMessageIds(item: TimelineNonDayItem): string[] {
  if (item.kind === "system-group") {
    return item.entries.map((entry) => entry.message.id);
  }
  return item.kind === "message" || item.kind === "system"
    ? [item.entry.message.id]
    : [];
}

type VirtualizedTimelineRowsProps = {
  dayGroups: TimelineDayGroup[];
  historyExhausted: boolean;
  leadingContent?: React.ReactNode;
  onAtBottomStateChange?: (atBottom: boolean) => void;
  onStartReached?: () => boolean;
  onVirtualizerApiChange?: (api: TimelineVirtualizerApi | null) => void;
  onVirtualizerRangeChanged?: () => void;
  onVirtualizerScrollerChange?: (element: HTMLDivElement | null) => void;
  renderItem: (item: TimelineNonDayItem) => React.ReactNode;
};

type VirtualizedTimelineItemShellProps = {
  children: React.ReactNode;
  index: number;
  ref?: React.LegacyRef<HTMLDivElement>;
  style: React.CSSProperties;
};

const PreserveVirtualizedItemVisibilityContext = React.createContext(false);

function VirtualizedTimelineItemShell({
  children,
  ref,
  style,
}: VirtualizedTimelineItemShellProps) {
  const preserveVisibility = React.useContext(
    PreserveVirtualizedItemVisibilityContext,
  );
  return (
    <div
      ref={ref}
      style={preserveVisibility ? style : { ...style, visibility: undefined }}
    >
      {children}
    </div>
  );
}

export function VirtualizedTimelineRows({
  dayGroups,
  historyExhausted,
  leadingContent,
  onAtBottomStateChange,
  onStartReached,
  onVirtualizerApiChange,
  onVirtualizerRangeChanged,
  onVirtualizerScrollerChange,
  renderItem,
}: VirtualizedTimelineRowsProps) {
  const listRef = React.useRef<VListHandle>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const itemsLengthRef = React.useRef(0);
  const messageItemIndexByIdRef = React.useRef<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [offscreenBufferSize, setOffscreenBufferSize] = React.useState(() =>
    typeof window === "undefined" ? 1_000 : window.innerHeight,
  );
  const hasInitialPositionedRef = React.useRef(false);
  const pinnedDayLabelRef = React.useRef<HTMLDivElement>(null);
  const pinnedDayTranslateYRef = React.useRef(0);
  const estimateCallCountRef = React.useRef(0);
  const estimateItemSize = React.useCallback(
    (item: VirtualizedTimelineItem) => {
      estimateCallCountRef.current += 1;
      const scroller = hostRef.current?.firstElementChild;
      if (scroller instanceof HTMLDivElement) {
        scroller.dataset.virtuaEstimateCallCount = String(
          estimateCallCountRef.current,
        );
      }
      return estimateVirtualizedTimelineItemHeight(item);
    },
    [],
  );
  const items = React.useMemo(
    () => buildVirtualizedItems(dayGroups, leadingContent, historyExhausted),
    [dayGroups, historyExhausted, leadingContent],
  );
  const keys = React.useMemo(() => items.map(virtualizedItemKey), [items]);
  const dayDividerItems = React.useMemo(
    () =>
      items.flatMap((item, index) =>
        item.kind === "day-divider" ? [{ index, item }] : [],
      ),
    [items],
  );
  const [pinnedDay, setPinnedDay] = React.useState<{
    label: string | null;
    incomingLabel: string | null;
  }>({ label: null, incomingLabel: null });
  itemsLengthRef.current = items.length;
  const previousKeysRef = React.useRef<readonly string[]>([]);
  const [prependShiftEpoch, clearPrependShift] = React.useReducer(
    (version: number) => version + 1,
    0,
  );
  const { cancel: cancelBottomSettle, settle: settleAtBottom } =
    useVirtualizedBottomSettle(hostRef, listRef, itemsLengthRef);
  const { arm: armUpwardMomentum } = useUpwardPaginationWheel(
    hostRef,
    cancelBottomSettle,
  );

  const updatePinnedDayLabel = React.useCallback(
    (offset: number) => {
      const list = listRef.current;
      const scroller = hostRef.current?.firstElementChild;
      const pinnedLabel = pinnedDayLabelRef.current;
      if (!list || !(scroller instanceof HTMLDivElement) || !pinnedLabel) {
        return;
      }

      const pinnedTop =
        pinnedLabel.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        pinnedDayTranslateYRef.current;
      const [pinnedPill, incomingPinnedPill] =
        pinnedLabel.querySelectorAll<HTMLParagraphElement>("p");
      const pinnedPillHeight = pinnedPill?.offsetHeight ?? 0;
      if (pinnedPillHeight === 0) return;
      const renderedDividerPillTop = (
        divider: (typeof dayDividerItems)[number],
      ) => {
        const label = formatDayGroupLabel(divider.item.headingTimestamp);
        const source = [
          ...scroller.querySelectorAll<HTMLElement>(
            '[data-testid="message-timeline-day-divider"]',
          ),
        ].find((element) => element.dataset.dayLabel === label);
        const pill = source?.querySelector<HTMLElement>("p");
        return pill
          ? pill.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top
          : null;
      };
      const sourcePills = [
        ...scroller.querySelectorAll<HTMLElement>(
          '[data-testid="message-timeline-day-divider"] p',
        ),
      ];
      // Source dividers are normally visible in the feed. Only hide the one
      // that physically overlaps the floating chip at the handoff point.
      for (const pill of sourcePills) {
        pill.style.removeProperty("visibility");
      }

      let activeDividerIndex = -1;
      for (const [index, divider] of dayDividerItems.entries()) {
        if (list.getItemOffset(divider.index) > offset + pinnedTop) break;
        activeDividerIndex = index;
      }
      const candidateDivider = dayDividerItems[activeDividerIndex];
      // Retain the previous date while the next in-flow divider is still
      // above the sticky slot. This avoids changing the label before the
      // moving chip reaches its handoff point.
      if (
        activeDividerIndex > 0 &&
        candidateDivider &&
        (renderedDividerPillTop(candidateDivider) ?? -Infinity) > pinnedTop
      ) {
        activeDividerIndex -= 1;
      }
      const activeDivider = dayDividerItems[activeDividerIndex];
      const nextDivider = dayDividerItems[activeDividerIndex + 1];
      const nextDividerTop = nextDivider
        ? (renderedDividerPillTop(nextDivider) ??
          list.getItemOffset(nextDivider.index) - offset)
        : null;
      const nextTranslateY =
        nextDividerTop === null
          ? 0
          : Math.max(
              -pinnedPillHeight,
              Math.min(0, nextDividerTop - pinnedTop - pinnedPillHeight),
            );
      if (pinnedDayTranslateYRef.current !== nextTranslateY) {
        pinnedDayTranslateYRef.current = nextTranslateY;
        pinnedLabel.style.transform = `translateY(${nextTranslateY}px)`;
      }
      const nextLabel = activeDivider
        ? formatDayGroupLabel(activeDivider.item.headingTimestamp)
        : null;
      const incomingLabel =
        nextDivider && nextTranslateY < 0
          ? formatDayGroupLabel(nextDivider.item.headingTimestamp)
          : null;
      const activeSourcePill = sourcePills.find(
        (pill) => pill.parentElement?.dataset.dayLabel === nextLabel,
      );
      if (activeSourcePill) {
        const sourceTop =
          activeSourcePill.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top;
        const overlayTop = pinnedTop;
        const sourceBottom = sourceTop + activeSourcePill.offsetHeight;
        const overlayBottom = overlayTop + pinnedPillHeight;
        if (sourceBottom > overlayTop && sourceTop < overlayBottom) {
          activeSourcePill.style.visibility = "hidden";
        }
      }
      const incomingSourcePill = sourcePills.find(
        (pill) => pill.parentElement?.dataset.dayLabel === incomingLabel,
      );
      if (incomingSourcePill) {
        incomingSourcePill.style.visibility = "hidden";
      }
      if (pinnedPill) {
        pinnedPill.textContent = nextLabel ?? "";
        pinnedPill.style.visibility = nextLabel ? "visible" : "hidden";
      }
      if (incomingPinnedPill) {
        incomingPinnedPill.textContent = incomingLabel ?? "";
        incomingPinnedPill.style.visibility = incomingLabel
          ? "visible"
          : "hidden";
      }
      setPinnedDay((current) =>
        current.label === nextLabel && current.incomingLabel === incomingLabel
          ? current
          : { label: nextLabel, incomingLabel },
      );
    },
    [dayDividerItems],
  );

  React.useEffect(
    () => () => {
      cancelBottomSettle();
    },
    [cancelBottomSettle],
  );

  const isPrepend = React.useMemo(() => {
    void prependShiftEpoch;
    return didPrependVirtualizedTimeline(previousKeysRef.current, keys);
  }, [keys, prependShiftEpoch]);

  React.useLayoutEffect(() => {
    previousKeysRef.current = keys;
    if (isPrepend) {
      clearPrependShift();
    }
    if (!hasInitialPositionedRef.current && items.length > 0) {
      hasInitialPositionedRef.current = true;
      settleAtBottom();
    }
  }, [isPrepend, items.length, keys, settleAtBottom]);

  const messageItemIndexById = React.useMemo(() => {
    const byId = new Map<string, number>();
    items.forEach((item, index) => {
      if (item.kind !== "timeline-item") return;
      for (const messageId of timelineItemMessageIds(item.item)) {
        byId.set(messageId, index);
      }
    });
    return byId;
  }, [items]);
  messageItemIndexByIdRef.current = messageItemIndexById;

  React.useLayoutEffect(() => {
    const scroller = hostRef.current?.firstElementChild;
    const element = scroller instanceof HTMLDivElement ? scroller : null;
    if (element) {
      element.dataset.buzzConversationScroll = "true";
      element.dataset.testid = "message-timeline";
      element.dataset.virtuaEstimateCallCount = String(
        estimateCallCountRef.current,
      );
    }
    onVirtualizerScrollerChange?.(element);
    return () => onVirtualizerScrollerChange?.(null);
  }, [onVirtualizerScrollerChange]);

  React.useLayoutEffect(() => {
    updatePinnedDayLabel(listRef.current?.scrollOffset ?? 0);
  }, [updatePinnedDayLabel]);

  React.useLayoutEffect(() => {
    if (!onVirtualizerApiChange) return;
    const api: TimelineVirtualizerApi = {
      cancelBottomIntent: cancelBottomSettle,
      scrollToBottom() {
        settleAtBottom();
      },
      settleAtBottom,
      scrollToMessage(messageId) {
        cancelBottomSettle();
        const index = messageItemIndexByIdRef.current.get(messageId);
        if (index === undefined) return false;
        listRef.current?.scrollToIndex(index, { align: "center" });
        return true;
      },
    };
    onVirtualizerApiChange(api);
    return () => onVirtualizerApiChange(null);
  }, [cancelBottomSettle, onVirtualizerApiChange, settleAtBottom]);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateBufferSize = () => {
      // Measure rows three viewports ahead of the reader. Virtua deliberately
      // hides each newly mounted row until its first ResizeObserver result; a
      // one-viewport lead can be consumed by WebKit trackpad momentum before
      // that result commits, producing a first-pass-only blank flash. The
      // measured size is cached, which is why revisiting the same range is
      // already stable.
      setOffscreenBufferSize(host.clientHeight * 3);
    };
    updateBufferSize();
    const resizeObserver = new ResizeObserver(updateBufferSize);
    resizeObserver.observe(host);
    return () => resizeObserver.disconnect();
  }, []);

  const { retainedIndices, onScrollEnd: handleScrollEnd } =
    useTimelineRetention(keys, listRef, isPrepend);

  const handleScroll = React.useCallback(
    (offset: number) => {
      const list = listRef.current;
      const scroller = hostRef.current?.firstElementChild;
      if (!list || !(scroller instanceof HTMLDivElement)) return;
      onVirtualizerRangeChanged?.();
      const distanceFromBottom = list.scrollSize - list.viewportSize - offset;
      // Do not infer reader intent from an intermediate virtualizer offset.
      // Initial channel positioning deliberately chases the floor while rows
      // are measured; those measurements can briefly report a large gap and
      // emit `onScroll` without any user input. Cancelling here strands the
      // channel above its newest message. The settle hook's wheel, pointer,
      // touch, and key listeners are the authoritative user-interaction gate.
      onAtBottomStateChange?.(distanceFromBottom <= 32);
      updatePinnedDayLabel(offset);
      if (offset <= 200) {
        // Layout scrolls near the top must not poison the reader's next input.
        armUpwardMomentum(onStartReached?.() ?? false);
      }
    },
    [
      armUpwardMomentum,
      onAtBottomStateChange,
      onStartReached,
      onVirtualizerRangeChanged,
      updatePinnedDayLabel,
    ],
  );

  return (
    <div className="relative h-full min-h-0 w-full" ref={hostRef}>
      <PreserveVirtualizedItemVisibilityContext value={isPrepend}>
        <VList
          ref={listRef}
          className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-2 pt-[var(--channel-top-chrome-height,4.5rem)]"
          data={items}
          item={VirtualizedTimelineItemShell}
          itemSize={estimateItemSize}
          bufferSize={offscreenBufferSize}
          keepMounted={retainedIndices}
          style={{ overflowAnchor: "none" }}
          shift={isPrepend}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
        >
          {(item) => {
            if (item.kind === "bottom-spacer") {
              return (
                <div
                  aria-hidden
                  className="h-[var(--composer-overlay-height,6rem)]"
                  key={virtualizedItemKey(item)}
                />
              );
            }
            if (item.kind === "leading-content") {
              return <div key={virtualizedItemKey(item)}>{item.content}</div>;
            }
            if (item.kind === "day-divider") {
              const dayLabel = formatDayGroupLabel(item.headingTimestamp);
              return (
                <div
                  className="relative flex flex-col before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border/35 before:content-['']"
                  data-day-label={dayLabel}
                  data-testid="message-timeline-day-group"
                  key={virtualizedItemKey(item)}
                >
                  <DayDivider label={dayLabel} sticky={false} />
                </div>
              );
            }
            return (
              <TimelineRowShell
                item={item.item}
                key={virtualizedItemKey(item)}
                useContentVisibility={false}
              >
                {renderItem(item.item)}
              </TimelineRowShell>
            );
          }}
        </VList>
      </PreserveVirtualizedItemVisibilityContext>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 z-20",
          channelChrome.stickyTimelineTop,
          pinnedDay.label || pinnedDay.incomingLabel
            ? "opacity-100"
            : "opacity-0",
        )}
        data-day-label={pinnedDay.label ?? undefined}
        data-testid="message-timeline-sticky-day-divider"
      >
        <div className="invisible flex justify-center">
          <DayDivider label={pinnedDay.label ?? ""} sticky={false} testId="" />
        </div>
        <div
          className="absolute inset-x-0 top-0 flex flex-col"
          data-testid="message-timeline-sticky-day-divider-content"
          ref={pinnedDayLabelRef}
        >
          <DayDivider label={pinnedDay.label ?? ""} sticky={false} testId="" />
          <DayDivider
            label={pinnedDay.incomingLabel ?? ""}
            sticky={false}
            testId=""
          />
        </div>
      </div>
    </div>
  );
}

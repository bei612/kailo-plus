import { useMemo, type ReactNode } from "react";
import { buildMainTimelineEntries } from "@client-kit/platform/react/thread/threadPanel";
import { buildTimelineDayGroups, buildTimelineItems, type TimelineNonDayItem } from "@client-kit/platform/react/messages/timeline/timelineItems";
import { VirtualizedTimelineRows } from "@client-kit/platform/react/messages/timeline/VirtualizedTimelineRows";
import type { TimelineMessageListProps } from "@client-kit/platform/react/messages/timeline/types";
import { UnreadDivider } from "@client-kit/platform/react/messages";

// Same original timeline projection and virtual scroller as Desktop. Only the
// authorized message/body/action transport is supplied by the Web host.
export function ChannelTimelineRows({ renderItem, ...props }: TimelineMessageListProps & {
  renderItem: (item: Exclude<TimelineNonDayItem, { kind: "unread-divider" }>, highlightedMessageId?: string | null) => ReactNode;
}) {
  const entries = useMemo(() => props.mainEntries ?? buildMainTimelineEntries(props.messages, undefined, props.threadSummaries, props.profiles, props.authoritativeRowIds), [props.mainEntries, props.messages, props.threadSummaries, props.profiles, props.authoritativeRowIds]);
  const dayGroups = useMemo(() => buildTimelineDayGroups(buildTimelineItems(entries, props.firstUnreadMessageId ?? null).items), [entries, props.firstUnreadMessageId]);
  return <VirtualizedTimelineRows
    dayGroups={dayGroups}
    historyExhausted={props.historyExhausted ?? false}
    leadingContent={props.leadingContent}
    onAtBottomStateChange={props.onAtBottomStateChange}
    onStartReached={props.onStartReached}
    onVirtualizerApiChange={props.onVirtualizerApiChange}
    onVirtualizerRangeChanged={props.onVirtualizerRangeChanged}
    onVirtualizerScrollerChange={props.onVirtualizerScrollerChange}
    renderItem={(item) => item.kind === "unread-divider" ? <UnreadDivider /> : renderItem(item, props.highlightedMessageId)}
  />;
}

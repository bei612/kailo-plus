import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { buildThreadPanelData } from "@/features/messages/lib/threadPanel";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_DELETION,
  KIND_NIP29_DELETE_EVENT,
} from "@/shared/constants/kinds";

/**
 * Relay deletion markers already loaded in the channel window that reference
 * `headId`. The thread head is the single content event found by id, but a
 * deletion of it lives alongside it in the channel window —
 * `formatTimelineMessages` only hides a message when the deletion sits in the
 * SAME array as its target.
 */
function headDeletionsFromChannelWindow(
  channelEvents: RelayEvent[],
  headId: string,
): RelayEvent[] {
  return channelEvents.filter(
    (event) =>
      (event.kind === KIND_DELETION ||
        event.kind === KIND_NIP29_DELETE_EVENT) &&
      event.tags.some((tag) => tag[0] === "e" && tag[1] === headId),
  );
}

export function buildIndependentThreadPanel(
  channelEvents: RelayEvent[],
  replyEvents: RelayEvent[],
  rootId: string | null,
  replyTargetId: string | null,
  expandedReplyIds: ReadonlySet<string>,
  ...formatArgs: Tail<Parameters<typeof formatTimelineMessages>>
) {
  if (!rootId) {
    return {
      ...buildThreadPanelData([], null, replyTargetId, expandedReplyIds),
      messages: [],
    };
  }
  const head = channelEvents.find((event) => event.id === rootId);
  const replyEventIds = new Set(replyEvents.map((event) => event.id));
  const headDeletions = head
    ? headDeletionsFromChannelWindow(channelEvents, rootId).filter(
        (event) => !replyEventIds.has(event.id),
      )
    : [];
  const events = head ? [head, ...headDeletions, ...replyEvents] : replyEvents;
  const messages = formatTimelineMessages(events, ...formatArgs);
  return {
    ...buildThreadPanelData(messages, rootId, replyTargetId, expandedReplyIds),
    messages,
  };
}

type Tail<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...infer R,
]
  ? R
  : never;

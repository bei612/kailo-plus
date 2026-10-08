// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/useChannelRouteTarget.ts; original route projection.
import type { TimelineMessage } from "../types";
import { isBroadcastReply } from "../threading";

export function getThreadRouteTarget(
  targetMessage: TimelineMessage,
  messageById: ReadonlyMap<string, TimelineMessage>,
): { expandedReplyIds: Set<string>; threadHeadId: string } | null {
  const threadHeadId = targetMessage.rootId ?? targetMessage.parentId ?? null;
  if (!threadHeadId || !messageById.has(threadHeadId)) {
    return null;
  }

  const expandedReplyIds = new Set<string>();
  let ancestorId = targetMessage.parentId ?? null;
  let guard = 0;
  const maxHops = messageById.size + 1;

  while (ancestorId && ancestorId !== threadHeadId && guard < maxHops) {
    const ancestor = messageById.get(ancestorId);
    if (!ancestor) {
      return null;
    }

    expandedReplyIds.add(ancestor.id);
    ancestorId = ancestor.parentId ?? null;
    guard += 1;
  }

  if (ancestorId !== threadHeadId) {
    return null;
  }

  return { expandedReplyIds, threadHeadId };
}

export function getRouteMainTimelineTargetId(
  targetMessageId: string | null,
  targetMessage: TimelineMessage | null,
): string | null {
  if (!targetMessageId) {
    return null;
  }

  if (!targetMessage?.parentId || isBroadcastReply(targetMessage.tags ?? [])) {
    return targetMessageId;
  }

  return targetMessage.rootId ?? targetMessage.parentId;
}

export type ThreadReference = {
  parentId: string | null;
  rootId: string | null;
};

function getEventTags(tags: string[][]) {
  return tags.filter((tag) => tag[0] === "e" && typeof tag[1] === "string");
}

export function getChannelIdFromTags(tags: string[][]) {
  return tags.find((tag) => tag[0] === "h")?.[1] ?? null;
}

export function isBroadcastReply(tags: string[][]): boolean {
  return tags.some((tag) => tag[0] === "broadcast" && tag[1] === "1");
}

export function isThreadReply(tags: string[][]): boolean {
  const ref = getThreadReference(tags);
  return ref.parentId !== null && !isBroadcastReply(tags);
}

export function getThreadReference(tags: string[][]): ThreadReference {
  const eventTags = getEventTags(tags);

  if (eventTags.length === 0) {
    return {
      parentId: null,
      rootId: null,
    };
  }

  const rootTag = eventTags.find((tag) => tag[3] === "root");
  const replyTag =
    [...eventTags].reverse().find((tag) => tag[3] === "reply") ?? null;

  if (!replyTag) {
    return {
      parentId: null,
      rootId: null,
    };
  }

  const parentId = replyTag[1] ?? null;

  return {
    parentId,
    rootId: rootTag?.[1] ?? parentId,
  };
}

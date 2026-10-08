// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/lib/useMessageEmoji.ts.
import * as React from "react";
import { customEmojiFromTags, type CustomEmoji } from "../custom-emoji/emoji";
import { isEmojiOnlyMessage } from "./emojiOnly";

/** Original per-message tags, not the unrelated community reaction palette. */
export function useMessageEmoji(
  body: string,
  tags: ReadonlyArray<ReadonlyArray<string>> | undefined,
): { customEmoji: CustomEmoji[] | undefined; emojiOnly: boolean } {
  const customEmoji = React.useMemo(() => tags ? customEmojiFromTags(tags) : undefined, [tags]);
  const emojiOnly = React.useMemo(() => isEmojiOnlyMessage(body, customEmoji), [body, customEmoji]);
  return { customEmoji, emojiOnly };
}

import * as React from "react";

import type { UseMentionsResult } from "@/features/messages/lib/useMentions";
import type { UseRichTextEditorResult } from "@/features/messages/lib/useRichTextEditor";

/** Insert an `@` trigger at the caret (or reuse the one being typed). */
export function useComposerMentionPicker({
  mentions,
  richText,
}: {
  mentions: UseMentionsResult;
  richText: UseRichTextEditorResult;
}) {
  const { updateMentionQuery } = mentions;
  const { editor, focus, getPlainTextAndCursor } = richText;
  return React.useCallback(() => {
    if (!editor) return;
    const { text, cursor } = getPlainTextAndCursor();
    const beforeCursor = text.slice(0, cursor);
    if (/(?:^|[\s])@[^\s]*$/.test(beforeCursor)) {
      updateMentionQuery(text, cursor);
      focus();
      return;
    }
    const previousChar = beforeCursor.slice(-1);
    const prefix =
      cursor > 0 && previousChar && !/\s/.test(previousChar) ? " @" : "@";
    editor.chain().focus().insertContent(prefix).run();
    const updated = getPlainTextAndCursor();
    updateMentionQuery(updated.text, updated.cursor);
  }, [editor, focus, getPlainTextAndCursor, updateMentionQuery]);
}

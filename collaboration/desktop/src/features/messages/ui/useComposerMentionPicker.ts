import * as React from "react";

import type { UseMentionsResult } from "@/features/messages/lib/useMentions";
import type { UseRichTextEditorResult } from "@/features/messages/lib/useRichTextEditor";

// Buzz 779af8886caae1317b4de962082429867ab61503 original picker/settings routes.
export function useComposerMentionPicker({
  mentions,
  richText,
  onTurnOffAutoPinConfirmation,
}: {
  mentions: UseMentionsResult;
  richText: UseRichTextEditorResult;
  onTurnOffAutoPinConfirmation: () => void;
}) {
  const { cancelMentionAutocomplete, isMentionOpen, openMentionPicker: setMentionPickerOpen, updateMentionQuery } = mentions;
  const { editor, focus, getPlainTextAndCursor } = richText;
  const openMentionPicker = React.useCallback((insertTrigger = true) => {
    if (!editor) return;
    const { text, cursor } = getPlainTextAndCursor();
    if (!insertTrigger) {
      if (isMentionOpen) {
        cancelMentionAutocomplete();
        focus();
        return;
      }
      setMentionPickerOpen(cursor, "first-agent");
      focus();
      return;
    }
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
  }, [cancelMentionAutocomplete, editor, focus, getPlainTextAndCursor, isMentionOpen, setMentionPickerOpen, updateMentionQuery]);
  const openMentionSettings = React.useCallback(() => openMentionPicker(false), [openMentionPicker]);
  const revealMentionSettings = React.useCallback(() => {
    if (!editor) return;
    setMentionPickerOpen(getPlainTextAndCursor().cursor, "first-agent");
    focus();
  }, [editor, focus, getPlainTextAndCursor, setMentionPickerOpen]);
  const turnOff = React.useCallback(() => {
    revealMentionSettings();
    onTurnOffAutoPinConfirmation();
  }, [onTurnOffAutoPinConfirmation, revealMentionSettings]);
  return {openMentionPicker, openMentionSettings, turnOff};
}

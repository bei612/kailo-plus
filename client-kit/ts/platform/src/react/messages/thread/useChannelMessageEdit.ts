// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/useChannelPaneHandlers.ts and
// desktop/src/features/channels/ui/useRoutedMessageEdit.ts.
// Shared edit selection and thread-leaving guard;
// the hosts retain their existing authenticated publish/receipt consumers.
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../../context";
import type { TimelineMessage } from "../types";
import { isThreadReply } from "../threading";

export function useChannelMessageEdit<Message extends TimelineMessage>(scopeKey: string) {
  const t = useUiT();
  const [selection, setSelection] = React.useState<{ scopeKey: string; message: Message } | null>(
    null,
  );
  // A changed identity/channel never renders or clears the preceding owner's
  // editor, including during the render before passive effects run.
  const editTarget = selection?.scopeKey === scopeKey ? selection.message : null;
  const editTargetRef = React.useRef(editTarget);
  editTargetRef.current = editTarget;
  const scopeKeyRef = React.useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  React.useEffect(() => {
    setSelection((current) => (current?.scopeKey === scopeKey ? current : null));
  }, [scopeKey]);
  const setEditTarget = React.useCallback(
    (update: React.SetStateAction<Message | null>) => {
      setSelection((current) => {
        if (scopeKeyRef.current !== scopeKey) return current;
        const message = current?.scopeKey === scopeKey ? current.message : null;
        const next = typeof update === "function" ? update(message) : update;
        return next ? { scopeKey, message: next } : null;
      });
    },
    [scopeKey],
  );
  const handleCancelEdit = React.useCallback(() => setEditTarget(null), [setEditTarget]);
  const threadEditId = editTarget && isThreadReply(editTarget.tags ?? []) ? editTarget.id : null;
  const requireThreadEditResolution = React.useCallback(() => {
    if (!editTargetRef.current || !isThreadReply(editTargetRef.current.tags ?? [])) return true;
    toast.info(t("buzz.finishThreadEdit"));
    return false;
  }, [t, threadEditId]);
  const handleEdit = React.useCallback(
    (message: Message) => {
      const current = editTargetRef.current;
      if (
        current &&
        current.id !== message.id &&
        isThreadReply(current.tags ?? []) !== isThreadReply(message.tags ?? [])
      ) {
        toast.info(t("buzz.finishEdit"));
        return false;
      }
      setEditTarget((selected) => (selected?.id === message.id ? null : message));
      return true;
    },
    [setEditTarget, t],
  );
  return { editTarget, setEditTarget, handleEdit, handleCancelEdit, requireThreadEditResolution };
}

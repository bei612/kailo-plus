import * as React from "react";
import type { Editor } from "@tiptap/react";
import { hasMentionClipboardHtml } from "../lib/normalizeMentionClipboard";
import { handleMentionClipboardPaste } from "../lib/mentionClipboardPaste";
import type { BindPastedMentionIdentities } from "../lib/mentionPasteBinding";
import { getBuzzCodeBlockClipboardText } from "../../../shared/lib/codeBlockClipboard";
import { restoreSnapshotPaste, SNAPSHOT_CLIPBOARD_ATTRIBUTE } from "../../../../messages/agentSnapshotClipboard";

export function useComposerPasteHandler(options: {
  editor: Editor | null;
  owner: object;
  enabled: boolean;
  /**
   * Teaches the composer each `name → pubkey` pair a Buzz copy carried, once
   * trusted state vouches for it. Without it, a paste binds nothing.
   */
  bindMentionIdentities?: BindPastedMentionIdentities;
  scrollToBottom: () => void;
  uploadFile: (file: File) => Promise<unknown>;
}) {
  const current = React.useRef(options);
  current.current = options;
  const bindMentionIdentitiesRef = React.useRef(options.bindMentionIdentities);
  bindMentionIdentitiesRef.current = options.bindMentionIdentities;
  React.useEffect(() => {
    const editor = options.editor;
    if (!editor) return;
    let mounted = true;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        handlePaste: (view, event) => {
          const captured = current.current;
          if (!captured.enabled || !editor.isEditable) return false;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) {
            for (const item of Array.from(event.clipboardData?.items ?? [])) {
              if (item.kind !== "file") continue;
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
          if (files.length) {
            event.preventDefault();
            const html = event.clipboardData?.getData("text/html") ?? "";
            const active = () => mounted && current.current.owner === captured.owner && current.current.enabled && editor.isEditable;
            // DD-131(7)/143: verify the copied package before naming it. Keep
            // the original destination through asynchronous byte reads; never
            // route a completed paste to the next actor or draft's callback.
            void (async () => {
              for (const file of files) {
                if (!active()) return;
                const named = html.includes(SNAPSHOT_CLIPBOARD_ATTRIBUTE)
                  ? await restoreSnapshotPaste(html, file).catch(() => null)
                  : null;
                if (!active()) return;
                await captured.uploadFile(named ?? file);
              }
            })();
            return true;
          }
          const codeBlockText = getBuzzCodeBlockClipboardText(
            event.clipboardData,
          );
          if (codeBlockText !== null) {
            event.preventDefault();
            editor
              .chain()
              .focus()
              .insertContent([
                {
                  type: "codeBlock",
                  content:
                    codeBlockText.length > 0
                      ? [{ type: "text", text: codeBlockText }]
                      : [],
                },
                { type: "paragraph" },
              ])
              .run();
            options.scrollToBottom();
            return true;
          }
          const clipboardData = event.clipboardData;
          const html = clipboardData?.getData("text/html");
          if (clipboardData && html && hasMentionClipboardHtml(html)) {
            if (clipboardData.getData("text/plain").includes("\n")) {
              options.scrollToBottom();
            }
            return handleMentionClipboardPaste({
              bindMentionIdentities: bindMentionIdentitiesRef.current,
              clipboardData,
              preventDefault: () => event.preventDefault(),
              view,
            });
          }
          if ((clipboardData?.getData("text/plain") ?? "").includes("\n"))
            options.scrollToBottom();
          return false;
        },
      },
    });
    return () => { mounted = false; };
  }, [options.editor, options.scrollToBottom]);
}

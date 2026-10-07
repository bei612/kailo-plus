// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/forum/ui/ForumComposerCompactLayout.tsx::ForumComposerCompactLayout.
import type * as React from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { Plus } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { Spinner } from "../profile/buzz/shared/ui/spinner";

export function ForumComposerCompactLayout({ editor, header, isSending, onEditorKeyDown, sendDisabled }: {
  editor: Editor | null;
  header?: React.ReactNode;
  isSending: boolean;
  onEditorKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  sendDisabled: boolean;
}) {
  const t = useUiT();
  return <div className="flex min-h-10 items-center gap-3">
    {header ? <div className="flex min-w-0 shrink-0 items-center">{header}</div> : null}
    <div className="rich-text-composer max-h-10 min-w-0 flex-1 overflow-y-auto" onKeyDown={onEditorKeyDown}>
      <EditorContent editor={editor} />
    </div>
    <Button aria-label={t(isSending ? "buzz.sending" : "buzz.sendMessage")}
      className="h-7 w-7 shrink-0 rounded-full border border-border/70 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
      data-testid="send-message" disabled={sendDisabled || isSending} size="icon" type="submit" variant="ghost">
      {isSending ? <Spinner aria-hidden="true" className="h-4 w-4 border-2 text-primary-foreground" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
    </Button>
  </div>;
}

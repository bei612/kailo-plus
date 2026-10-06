// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/forum/ui/ForumComposer.tsx::ForumComposerVisit full layout.
// Drafts, mentions, uploads and send receipts stay in the existing host composer.
import * as React from "react";
import { EditorContent } from "@tiptap/react";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MessageComposerToolbar } from "../composer/features/messages/ui/MessageComposerToolbar";
import type { MessageComposerSurface } from "../composer/MessageComposerSurface";

export function ForumComposerSurface({ toolbar, children, header, overlays, containerClassName,
  formRef, scrollRef, onEditorKeyDown, formProps, submitLocked = false,
}: React.ComponentProps<typeof MessageComposerSurface>) {
  return <>
    <form {...formProps} ref={formRef} data-testid="forum-composer" data-submit-locked={submitLocked ? "true" : "false"}
      inert={submitLocked ? true : undefined}
      className={cn("relative rounded-2xl border border-input bg-card px-3 py-2 sm:px-4", containerClassName, formProps?.className)}>
      {header ? <div className="mb-2">{header}</div> : null}
      {children}
      <div className="rich-text-composer max-h-32 overflow-y-auto" ref={scrollRef} onKeyDown={onEditorKeyDown}>
        <EditorContent editor={toolbar.editor} />
      </div>
      <MessageComposerToolbar {...toolbar} />
    </form>
    {overlays}
  </>;
}

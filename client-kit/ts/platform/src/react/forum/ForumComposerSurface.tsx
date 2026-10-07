// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/forum/ui/ForumComposer.tsx::ForumComposerVisit full layout.
// Drafts, mentions, uploads and send receipts stay in the existing host composer.
import * as React from "react";
import { EditorContent } from "@tiptap/react";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MessageComposerToolbar } from "../composer/features/messages/ui/MessageComposerToolbar";
import type { MessageComposerSurface } from "../composer/MessageComposerSurface";
import { ForumComposerCompactLayout } from "./ForumComposerCompactLayout";

type ForumComposerSurfaceProps = React.ComponentProps<typeof MessageComposerSurface> & {
  compact?: boolean;
  hasComposerContent?: boolean;
  autocompleteOpen?: boolean;
  confirmedSendRevision?: number;
};

export function ForumComposerSurface({ toolbar, children, header, overlays, containerClassName,
  formRef, scrollRef, onEditorKeyDown, formProps, submitLocked = false,
  compact = false, hasComposerContent = false, autocompleteOpen = false, confirmedSendRevision = 0,
}: ForumComposerSurfaceProps) {
  const [expanded, setExpanded] = React.useState(!compact);
  const toolbarInteraction = React.useRef(false);
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastConfirmedSend = React.useRef(confirmedSendRevision);
  const hasDraft = hasComposerContent || toolbar.isUploading || toolbar.isSending || submitLocked;
  const collapsed = compact && !expanded && !hasDraft && !toolbar.isFormattingOpen && !autocompleteOpen;
  const wasExpanded = React.useRef(expanded);
  React.useEffect(() => {
    const previouslyExpanded = wasExpanded.current;
    wasExpanded.current = expanded;
    if (compact && expanded && !previouslyExpanded) {
      // Tiptap's focus command schedules another frame. Focus the view in this
      // owned frame so a confirmation can cancel it before the form collapses.
      const frame = requestAnimationFrame(() => toolbar.editor?.view.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [compact, expanded, toolbar.editor, confirmedSendRevision]);
  React.useEffect(() => {
    if (lastConfirmedSend.current === confirmedSendRevision) return;
    if (toolbar.isSending || submitLocked) return;
    lastConfirmedSend.current = confirmedSendRevision;
    if (compact && !hasDraft) setExpanded(false);
  }, [compact, confirmedSendRevision, toolbar.isSending, submitLocked, hasDraft]);
  React.useEffect(() => () => clearTimeout(blurTimer.current), []);
  return <>
    <form {...formProps} ref={formRef} data-testid="forum-composer" data-submit-locked={submitLocked ? "true" : "false"}
      data-compact-collapsed={collapsed ? "true" : "false"}
      onFocusCapture={(event) => { if (compact) setExpanded(true); formProps?.onFocusCapture?.(event); }}
      onDragEnter={(event) => { if (compact) setExpanded(true); formProps?.onDragEnter?.(event); }}
      onMouseDownCapture={(event) => {
        if (compact && event.target instanceof Element && event.target.closest("button")) {
          toolbarInteraction.current = true;
          clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => { toolbarInteraction.current = false; }, 0);
        }
        formProps?.onMouseDownCapture?.(event);
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (compact && !(next instanceof Node && event.currentTarget.contains(next)) &&
          !(next instanceof Element && next.closest("[data-radix-popper-content-wrapper]")) &&
          !toolbarInteraction.current && !hasDraft && !toolbar.isFormattingOpen) setExpanded(false);
        formProps?.onBlurCapture?.(event);
      }}
      inert={submitLocked ? true : undefined}
      className={cn("relative rounded-2xl border border-input bg-card px-3 py-2 sm:px-4", containerClassName, formProps?.className, autocompleteOpen && "overflow-visible")}>
      {collapsed ? <ForumComposerCompactLayout editor={toolbar.editor} header={header}
        isSending={toolbar.isSending} sendDisabled={toolbar.sendDisabled} onEditorKeyDown={onEditorKeyDown} /> : <>
      {header ? <div className={cn("mb-2", compact && "flex min-h-10 items-center")}>{header}</div> : null}
      {children}
      <div className="rich-text-composer max-h-32 overflow-y-auto" ref={scrollRef} onKeyDown={onEditorKeyDown}>
        <EditorContent editor={toolbar.editor} />
      </div>
      <MessageComposerToolbar {...toolbar} />
      </>}
    </form>
    {overlays}
  </>;
}

// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/MessageComposer.tsx.
// Host-specific draft/upload/publication hooks feed the same original editor and controls.
import * as React from "react";
import { EditorContent } from "@tiptap/react";
import { cn } from "../profile/buzz/shared/lib/cn";
import { ComposerDockToolbar } from "./features/messages/ui/ComposerDockToolbar";

type ToolbarProps = React.ComponentProps<typeof ComposerDockToolbar>;
export function MessageComposerSurface({
  toolbar, children, header, overlays, containerClassName, showTopBorder = false,
  formRef, scrollRef, onEditorKeyDown, formProps, submitLocked = false,
}: {
  toolbar: ToolbarProps;
  children?: React.ReactNode;
  header?: React.ReactNode;
  overlays?: React.ReactNode;
  containerClassName?: string;
  showTopBorder?: boolean;
  formRef?: React.Ref<HTMLFormElement>;
  scrollRef?: React.Ref<HTMLDivElement>;
  onEditorKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  formProps?: React.ComponentPropsWithoutRef<"form">;
  submitLocked?: boolean;
}) {
  return <>
    <footer className={cn("relative z-10 shrink-0 bg-transparent px-4 pb-2 pt-0",
      showTopBorder ? "border-t border-border/40 pt-3" : "", containerClassName)}>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-5 bg-transparent" />
      <div className="relative flex w-full flex-col gap-0">
        {header}
        <form {...formProps} ref={formRef} data-testid="message-composer" data-submit-locked={submitLocked ? "true" : "false"}
          className={cn("relative z-10 isolate rounded-2xl border border-border/50 bg-background/80 px-3 pb-2 pt-3 shadow-none supports-[backdrop-filter]:bg-background/70 dark:bg-background/70 dark:supports-[backdrop-filter]:bg-background/55 sm:px-4",
            toolbar.layoutMode === "standalone" && "backdrop-blur-md dark:backdrop-blur-xl", formProps?.className)}>
          {children}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: original Tiptap autocomplete/submit bridge */}
          <div className="rich-text-composer relative max-h-32 overflow-y-auto" data-testid="message-input-scroll"
            ref={scrollRef} onKeyDown={onEditorKeyDown}>
            <EditorContent editor={toolbar.editor} />
          </div>
          <ComposerDockToolbar {...toolbar} />
        </form>
      </div>
    </footer>
    {overlays}
  </>;
}

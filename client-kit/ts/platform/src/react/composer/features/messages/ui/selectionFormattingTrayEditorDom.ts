// Extracted from the pinned Buzz fork; original authority 779af8886caae1317b4de962082429867ab61503, desktop/src/features/messages/ui/selectionFormattingTrayEditorDom.ts.
import type { Editor } from "@tiptap/react";

/** Returns the editor DOM only after TipTap has mounted its view. */
export function getMountedEditorDom(editor: Editor): HTMLElement | null {
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}

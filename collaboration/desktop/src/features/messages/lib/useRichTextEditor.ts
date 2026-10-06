import { readTextFromSystemClipboard } from "@/shared/api/tauriMedia";
import { useRichTextEditor as useSharedRichTextEditor, type RichTextEditorOptions as SharedOptions } from "@client-kit/platform/react/composer/features/messages/lib/useRichTextEditor";
export type { AutocompleteEdit, LinkSelectionInfo, UseRichTextEditorResult } from "@client-kit/platform/react/composer/features/messages/lib/useRichTextEditor";
export type RichTextEditorOptions = Omit<SharedOptions, "readClipboardText">;
export function useRichTextEditor(options: RichTextEditorOptions) {
  return useSharedRichTextEditor({ ...options, readClipboardText: readTextFromSystemClipboard });
}

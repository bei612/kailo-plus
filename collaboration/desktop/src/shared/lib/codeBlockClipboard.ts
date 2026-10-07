import { copyTextToSystemClipboard } from "@/shared/api/tauriMedia";
import { copyCodeBlockToClipboard as copyCodeBlock } from "@client-kit/platform/react/composer/shared/lib/codeBlockClipboard";
export { getBuzzCodeBlockClipboardText } from "@client-kit/platform/react/composer/shared/lib/codeBlockClipboard";
export function copyCodeBlockToClipboard(code: string) {
  return copyCodeBlock(code, copyTextToSystemClipboard);
}

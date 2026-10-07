import * as React from "react";
import {
  CODE_BLOCK_CLASS,
  MarkdownCodeBlock as SharedMarkdownCodeBlock,
  SyntaxHighlightedCode as SharedSyntaxHighlightedCode,
} from "@client-kit/platform/react/message-body";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@client-kit/platform/theme/theme-loader";
import { copyTextToSystemClipboard } from "@/shared/api/tauriMedia";
import { cn } from "@/shared/lib/cn";

export { CODE_BLOCK_CLASS, extractLanguage } from "@client-kit/platform/react/message-body";

export function MarkdownCodeBlock({
  children,
  language,
}: {
  children?: React.ReactNode;
  language?: string;
}) {
  return (
    <SharedMarkdownCodeBlock
      language={language}
      copyText={copyTextToSystemClipboard}
    >
      {children}
    </SharedMarkdownCodeBlock>
  );
}

export function SyntaxHighlightedCode({
  className,
  code,
  language,
  ...props
}: {
  code: string;
  language: string;
} & React.ComponentProps<"code">) {
  const { themeName } = useTheme();
  return (
    <SharedSyntaxHighlightedCode
      {...props}
      code={code}
      language={language}
      shikiTheme={resolveShikiThemeName(themeName)}
      className={cn(CODE_BLOCK_CLASS, className)}
    />
  );
}

import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  CODE_BLOCK_CLASS,
  MessageCodeBlock,
  SyntaxHighlightedCode as SharedSyntaxHighlightedCode,
} from "@client-kit/platform/react/message-body";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@client-kit/platform/theme/theme-loader";
import { copyCodeBlockToClipboard } from "@/shared/lib/codeBlockClipboard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useSmoothCorners } from "@/shared/ui/smoothCorners";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { getReactNodeText } from "./utils";

export { CODE_BLOCK_CLASS, extractLanguage } from "@client-kit/platform/react/message-body";

function getCodeBlockText(children: React.ReactNode) {
  return getReactNodeText(children).replace(/\n$/, "");
}

export function MarkdownCodeBlock({
  children,
  language,
}: {
  children?: React.ReactNode;
  language?: string;
}) {
  const [isCopying, setIsCopying] = React.useState(false);
  const codeBlockRef = React.useRef<HTMLPreElement | null>(null);
  const code = React.useMemo(() => getCodeBlockText(children), [children]);
  useSmoothCorners(codeBlockRef);

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsCopying(true);

      try {
        await copyCodeBlockToClipboard(code);
        toast.success("Copied code to clipboard");
      } catch (error) {
        console.error("Failed to copy code block", error);
        toast.error("Failed to copy code");
      } finally {
        setIsCopying(false);
      }
    },
    [code],
  );

  return (
    <MessageCodeBlock
      language={language}
      ref={codeBlockRef}
      copyControl={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
            aria-label="Copy code block"
            className="absolute right-2 top-2 h-7 w-7 bg-background/80 text-muted-foreground opacity-0 shadow-xs ring-1 ring-border/60 backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-60"
            disabled={isCopying}
            onClick={handleCopy}
            size="icon"
            type="button"
            variant="ghost"
            >
              <Copy className="h-4 w-4" />
              <span className="sr-only">Copy code block</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy code</TooltipContent>
        </Tooltip>
      }
    >
      {children}
    </MessageCodeBlock>
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

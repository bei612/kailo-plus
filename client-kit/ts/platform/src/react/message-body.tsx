import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";
import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useUiT } from "./context";
import { Button } from "./profile/buzz/shared/ui/button";
import { useSmoothCorners } from "./profile/buzz/shared/ui/smoothCorners";
import { Tooltip, TooltipContent, TooltipTrigger } from "./sidebar/tooltip";
import { copyCodeBlockToClipboard } from "./composer/shared/lib/codeBlockClipboard";
import {
  getSingletonHighlighter,
  type HighlighterGeneric,
  type BundledLanguage,
  type BundledTheme,
  type ThemedToken,
} from "shiki";

/**
 * Parse a NIP-92 `dim` value ("WxH") into intrinsic pixel dimensions. Used to
 * stamp explicit `width`/`height` attributes on inline images so the browser
 * reserves aspect-ratio-correct layout space *before* the image decodes. This
 * is what keeps the timeline from jumping when a tall image loads late — the
 * row's height is known at first paint instead of growing from ~0 on load.
 */
export function dimensionsFromDim(
  dim?: string,
): { width: number; height: number } | undefined {
  if (!dim) return undefined;
  const match = dim.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { width, height };
}

export const MESSAGE_BODY_CLASS_NAME = [
  "message-markdown",
  "max-w-none wrap-anywhere text-message font-normal tracking-normal text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&>*+*]:mt-3",
  "[&>p+p]:mt-conversation-paragraph [&>ol]:space-y-conversation-list [&>ul]:space-y-conversation-list",
  "[&>*+h1]:mt-3.5 [&>*+h2]:mt-3.5 [&>*+h3]:mt-3.5 [&>*+h4]:mt-3.5 [&>*+h5]:mt-3.5 [&>*+h6]:mt-3.5",
  "[&>h1+*]:mt-0.5 [&>h2+*]:mt-0.5 [&>h3+*]:mt-0.5 [&>h4+*]:mt-0.5 [&>h5+*]:mt-0.5 [&>h6+*]:mt-0.5",
  "[&>h1+h2]:mt-1.5! [&>h2+h3]:mt-1.5! [&>h3+h4]:mt-1.5! [&>h4+h5]:mt-1.5! [&>h5+h6]:mt-1.5!",
  "[&>*+blockquote]:mt-3.5 [&>blockquote+*]:mt-3.5",
  "[&>*+[data-code-block]]:mt-3.5 [&>[data-code-block]+*]:mt-3.5",
  "[&>*+[data-table-block]]:mt-3.5 [&>[data-table-block]+*]:mt-3.5",
  "[&>*+hr]:mt-4 [&>hr+*]:mt-4",
  "[&>p+ul]:mt-1.5 [&>p+ol]:mt-1.5 [&>div+ul]:mt-1.5 [&>div+ol]:mt-1.5",
].join(" ");

export function MessageBody({
  children,
  className = MESSAGE_BODY_CLASS_NAME,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

type BlockChildren = { children?: ReactNode };

export function MessageTable({
  children,
  ref,
}: BlockChildren & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className="overflow-x-auto rounded-2xl border border-border/70"
      data-table-block=""
    >
      {/* Inherit message wrap-anywhere for long tokens. The cells' minimum
          widths keep short labels readable; many-column tables scroll locally. */}
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  );
}

let shikiHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null =
  null;
let shikiInitPromise: Promise<void> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();
const tokenCache = new Map<string, ThemedToken[][]>();
const MAX_CACHE_ENTRIES = 100;
const MAX_LOADED_LANGUAGES = 30;
const MAX_HIGHLIGHT_LINES = 150;
export const CODE_BLOCK_CLASS =
  "code-block-lines block min-w-full whitespace-pre font-mono text-sm font-medium text-foreground";
const DIFF_ADD_RE = /\s*\/\/\s*\[!code\s*\+\+\]\s*$/;
const DIFF_REMOVE_RE = /\s*\/\/\s*\[!code\s*--\]\s*$/;

function ensureHighlighter(): Promise<void> {
  if (shikiHighlighter) return Promise.resolve();
  if (!shikiInitPromise) {
    shikiInitPromise = getSingletonHighlighter({
      themes: [],
      langs: [],
    }).then((h) => {
      shikiHighlighter = h;
    });
  }
  return shikiInitPromise;
}

export function extractLanguage(className?: string): string {
  if (typeof className !== "string") return "";
  const match = className.match(/language-(\S+)/);
  return match?.[1] ?? "";
}

function stripDiffMarker(tokens: ThemedToken[], marker: RegExp): ThemedToken[] {
  const last = tokens[tokens.length - 1];
  if (!last) return tokens;
  const stripped = last.content.replace(marker, "");
  if (stripped === last.content) return tokens;
  if (stripped === "") return tokens.slice(0, -1);
  return [...tokens.slice(0, -1), { ...last, content: stripped }];
}

export function getCodeBlockLanguage(children: ReactNode): string {
  let language = "";
  React.Children.forEach(children, (child) => {
    if (
      React.isValidElement<Record<string, unknown>>(child) &&
      typeof child.props?.className === "string"
    ) {
      language = extractLanguage(child.props.className);
    }
  });
  return language;
}

export function MessageCodeBlock({
  children,
  language,
  ref,
  copyControl,
}: BlockChildren & {
  language?: string;
  ref?: Ref<HTMLPreElement>;
  copyControl?: ReactNode;
}) {
  return (
    <div className="group relative" data-code-block="">
      <pre
        ref={ref}
        className="max-h-[400px] overflow-x-auto overflow-y-auto rounded-2xl border border-border/70 bg-muted/60 px-3 py-1.5 pr-12 shadow-xs"
        style={{ borderRadius: "1rem" }}
      >
        {language && (
          <div className="mb-1 text-xs text-muted-foreground/70">
            {language}
          </div>
        )}
        {children}
      </pre>
      {copyControl}
    </div>
  );
}

// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/markdown/utils.ts::getReactNodeText.
export function getReactNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getReactNodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return getReactNodeText(node.props.children);
  return "";
}

function copyTextToBrowserClipboard(code: string) {
  return navigator.clipboard.writeText(code);
}

// Original MarkdownCodeBlock UI; only the plain clipboard fallback is host-specific.
export function MarkdownCodeBlock({ children, language, copyText = copyTextToBrowserClipboard }: BlockChildren & {
  language?: string;
  copyText?: (code: string) => Promise<void>;
}) {
  const t = useUiT();
  const [isCopying, setIsCopying] = React.useState(false);
  const codeBlockRef = React.useRef<HTMLPreElement | null>(null);
  const code = React.useMemo(() => getReactNodeText(children).replace(/\n$/, ""), [children]);
  useSmoothCorners(codeBlockRef);
  const handleCopy = React.useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsCopying(true);
    try {
      await copyCodeBlockToClipboard(code, copyText);
      toast.success(t("buzz.copiedCode"));
    } catch (error) {
      console.error("Failed to copy code block", error);
      toast.error(t("buzz.copyCodeFailed"));
    } finally {
      setIsCopying(false);
    }
  }, [code, copyText, t]);
  return <MessageCodeBlock language={language} ref={codeBlockRef} copyControl={
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={t("buzz.copyCodeBlock")}
          className="absolute right-2 top-2 h-7 w-7 bg-background/80 text-muted-foreground opacity-0 shadow-xs ring-1 ring-border/60 backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-60"
          disabled={isCopying} onClick={handleCopy} size="icon" type="button" variant="ghost">
          <Copy className="h-4 w-4" />
          <span className="sr-only">{t("buzz.copyCodeBlock")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("buzz.copyCode")}</TooltipContent>
    </Tooltip>
  }>{children}</MessageCodeBlock>;
}

export function PlainCodeBlock({
  code,
  className = CODE_BLOCK_CLASS,
  ...props
}: { code: string } & React.ComponentProps<"code">) {
  return (
    <code {...props} className={className}>
      {code.split("\n").map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
        <span key={i} data-line="">
          {line}
        </span>
      ))}
    </code>
  );
}

export function SyntaxHighlightedCode({
  className = CODE_BLOCK_CLASS,
  code,
  language,
  shikiTheme,
  ...props
}: {
  code: string;
  language: string;
  shikiTheme: string;
} & React.ComponentProps<"code">) {
  const [loadedKey, setLoadedKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      try {
        await ensureHighlighter();
        if (!shikiHighlighter || cancelled) return;
        let loaded = false;
        if (!loadedLangs.has(language)) {
          if (loadedLangs.size >= MAX_LOADED_LANGUAGES) return;
          try {
            await shikiHighlighter.loadLanguage(language as BundledLanguage);
            loadedLangs.add(language);
            loaded = true;
          } catch {
            return;
          }
        }
        if (!loadedThemes.has(shikiTheme)) {
          try {
            await shikiHighlighter.loadTheme(shikiTheme as BundledTheme);
            loadedThemes.add(shikiTheme);
            loaded = true;
          } catch {
            return;
          }
        }
        if (loaded && !cancelled) setLoadedKey((k) => k + 1);
      } catch {
        /* ignore */
      }
    }
    if (!loadedLangs.has(language) || !loadedThemes.has(shikiTheme)) {
      loadAssets();
    }
    return () => {
      cancelled = true;
    };
  }, [language, shikiTheme]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadedKey intentionally triggers re-memoization after async asset loading
  const tokens = React.useMemo(() => {
    if (
      !shikiHighlighter ||
      !loadedLangs.has(language) ||
      !loadedThemes.has(shikiTheme)
    )
      return null;
    if ((code.match(/\n/g) || []).length > MAX_HIGHLIGHT_LINES) return null;
    const cacheKey = `${language}:${shikiTheme}:${code}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) return cached;
    try {
      const result = shikiHighlighter.codeToTokens(code, {
        lang: language as BundledLanguage,
        theme: shikiTheme as BundledTheme,
      });
      if (tokenCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = tokenCache.keys().next().value;
        if (firstKey !== undefined) tokenCache.delete(firstKey);
      }
      tokenCache.set(cacheKey, result.tokens);
      return result.tokens;
    } catch {
      return null;
    }
  }, [code, language, shikiTheme, loadedKey]);

  if (!tokens) {
    return <PlainCodeBlock {...props} code={code} className={className} />;
  }

  return (
    <code {...props} className={className}>
      {tokens.map((line, lineIdx) => {
        const lineText = line.map((t) => t.content).join("");
        const isAdd = DIFF_ADD_RE.test(lineText);
        const isRemove = DIFF_REMOVE_RE.test(lineText);
        const diffClass = isAdd
          ? "code-line-diff-add"
          : isRemove
            ? "code-line-diff-remove"
            : undefined;

        const renderedTokens =
          isAdd || isRemove
            ? stripDiffMarker(line, isAdd ? DIFF_ADD_RE : DIFF_REMOVE_RE)
            : line;

        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
            key={lineIdx}
            data-line=""
            className={diffClass}
          >
            {renderedTokens.map((token, tokenIdx) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
                key={tokenIdx}
                style={token.color ? { color: token.color } : undefined}
              >
                {token.content}
              </span>
            ))}
          </span>
        );
      })}
    </code>
  );
}

const listItemClassName = "[&_p]:inline";
const listClassName = "space-y-1 pl-6 marker:text-muted-foreground/80";

export const MESSAGE_BODY_COMPONENTS = {
  blockquote: ({ children }: BlockChildren) => (
    <blockquote className="border-l-2 border-border pl-4 italic text-muted-foreground [&>*:first-child]:mt-0 [&>*+*]:mt-2">
      {children}
    </blockquote>
  ),
  br: () => <br />,
  h1: ({ children }: BlockChildren) => (
    <h1 className="text-xl font-semibold leading-8 tracking-tight">
      {children}
    </h1>
  ),
  h2: ({ children }: BlockChildren) => (
    <h2 className="text-lg font-semibold leading-7 tracking-tight">
      {children}
    </h2>
  ),
  h3: ({ children }: BlockChildren) => (
    <h3 className="text-base font-semibold leading-6 tracking-tight">
      {children}
    </h3>
  ),
  h4: ({ children }: BlockChildren) => (
    <h4 className="text-sm font-semibold leading-5 tracking-tight">
      {children}
    </h4>
  ),
  h5: ({ children }: BlockChildren) => (
    <h5 className="text-sm font-semibold leading-5 tracking-tight">
      {children}
    </h5>
  ),
  h6: ({ children }: BlockChildren) => (
    <h6 className="text-sm font-medium leading-5 tracking-tight text-muted-foreground">
      {children}
    </h6>
  ),
  hr: () => <hr className="border-border/80" />,
  li: ({ children }: BlockChildren) => (
    <li className={listItemClassName}>{children}</li>
  ),
  ol: ({
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"ol"> & { node?: unknown }) => (
    <ol {...props} className={`list-decimal ${listClassName}`}>
      {children}
    </ol>
  ),
  pre: ({ children }: BlockChildren) => (
    <MarkdownCodeBlock language={getCodeBlockLanguage(children)}>
      {children}
    </MarkdownCodeBlock>
  ),
  strong: ({ children }: BlockChildren) => (
    <strong className="font-semibold">{children}</strong>
  ),
  table: ({ children }: BlockChildren) => <MessageTable>{children}</MessageTable>,
  td: ({
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"td"> & { node?: unknown }) => (
    <td {...props} className="min-w-24 border-t border-border/70 px-3 py-2 align-top">
      {children}
    </td>
  ),
  th: ({
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"th"> & { node?: unknown }) => (
    <th {...props} className="min-w-24 bg-muted/60 px-3 py-2 align-top font-semibold text-foreground">
      {children}
    </th>
  ),
  ul: ({ children }: BlockChildren) => (
    <ul className={`list-disc ${listClassName}`}>{children}</ul>
  ),
};

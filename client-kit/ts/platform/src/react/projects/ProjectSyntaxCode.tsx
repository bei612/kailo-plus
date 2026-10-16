// Original desktop/src/shared/ui/markdown/CodeBlock.tsx::SyntaxHighlightedCode resolves the Shiki
// theme from the app theme. The shared package only receives the host's light/dark document
// theme, so it uses the Buzz light/dark syntax aliases; without one the original plain branch renders.
import type * as React from "react";
import { useDocumentTheme } from "../context";
import { SyntaxHighlightedCode } from "../message-body";
import { resolveShikiThemeName } from "../../theme/theme-loader";

export function ProjectSyntaxCode({ className, code, language }: { className: string; code: string; language: string }): React.ReactElement {
  const theme = useDocumentTheme();
  if (!theme) {
    return <code className={`block min-w-full font-mono text-foreground ${className}`}>{code}</code>;
  }
  return <SyntaxHighlightedCode className={className} code={code} language={language}
    shikiTheme={resolveShikiThemeName(theme === "DARK" ? "buzz-dark" : "buzz")}/>;
}

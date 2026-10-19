// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/FileContentBlock.tsx and FileEditDiffView.tsx
// (original DOM and classes).
import type {
  FileEditDiff,
  FileEditDiffLine,
} from "./agentSessionFileEditDiff";
import type * as React from "react";

import { cn } from "../profile/buzz/shared/lib/cn";

export type FileContentLineKind = "add" | "remove" | "context" | "meta";

export type FileContentLine = {
  kind: FileContentLineKind;
  text: string;
};

/** Scrollable mono panel with top/bottom fade affordances for overflow. */
export function ScrollFadeMonoPanel({
  children,
  className,
  fadeFromClassName = "from-muted",
  maxHeightClassName = "max-h-64",
}: {
  children: React.ReactNode;
  className?: string;
  fadeFromClassName?: string;
  maxHeightClassName?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "overflow-auto font-mono text-xs leading-5",
          maxHeightClassName,
        )}
      >
        <div className="px-3 py-2">{children}</div>
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-4 bg-linear-to-b to-transparent",
          fadeFromClassName,
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t to-transparent",
          fadeFromClassName,
        )}
      />
    </div>
  );
}

export function FileContentBlock({
  footerText,
  footerTitle,
  lines,
  path,
}: {
  footerText?: string;
  footerTitle?: string;
  lines: FileContentLine[];
  path: string;
}) {
  const resolvedFooterText = footerText ?? path;

  return (
    <div className="flex max-h-64 flex-col overflow-hidden rounded-md border border-border/50 bg-muted/35 text-xs leading-5 text-foreground">
      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="py-2 font-mono">
          <FileContentLines lines={lines} />
        </pre>
      </div>
      <div
        className="relative z-10 shrink-0 truncate border-t border-border/50 bg-muted/35 px-3 py-1.5 text-xs font-normal leading-5 text-muted-foreground/70"
        title={footerTitle ?? resolvedFooterText}
      >
        {resolvedFooterText}
      </div>
    </div>
  );
}

function FileContentLines({ lines }: { lines: FileContentLine[] }) {
  return lines.map((line, index) => (
    <FileContentLineView
      // biome-ignore lint/suspicious/noArrayIndexKey: file content lines are positional
      key={index}
      line={line}
    />
  ));
}

function FileContentLineView({ line }: { line: FileContentLine }) {
  return (
    <span
      className={cn(
        "block min-w-full whitespace-pre-wrap wrap-break-word px-3",
        line.kind === "add" &&
          "border-l-2 border-status-added/50 bg-status-added/10 text-foreground",
        line.kind === "remove" &&
          "border-l-2 border-status-deleted/50 bg-status-deleted/10 text-foreground",
        line.kind === "meta" && "text-muted-foreground/70",
      )}
    >
      {line.text || " "}
    </span>
  );
}


export function hasFileEditLineDiff(diff: FileEditDiff) {
  return diff.lines.some(
    (line) => line.kind === "add" || line.kind === "remove",
  );
}

export function FileEditDiffBlock({ diff }: { diff: FileEditDiff }) {
  return (
    <FileContentBlock
      lines={diff.lines
        .filter((line) => line.kind !== "meta")
        .map(toFileContentLine)}
      path={diff.path}
    />
  );
}

function toFileContentLine(line: FileEditDiffLine): FileContentLine {
  return {
    kind: line.kind,
    text: line.text,
  };
}

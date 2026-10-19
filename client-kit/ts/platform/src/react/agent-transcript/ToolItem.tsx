// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/AgentSessionToolItem/{ToolItem,CompactToolSummaryRow,
// ToolDetailBlocks,ShellCommandBlock}.tsx (original DOM and classes). The sent
// message card, todo summary and image preview render ACP harness tools that a
// Codex thread does not produce (Kailo replies are published by Core, DD-125(6)).
import * as React from "react";
import { ChevronDown, Terminal } from "lucide-react";

import { useUiT } from "../context";
import type { UserProfileLookup } from "../messages/system/identity";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  ActivityRowLabel,
  splitActivityRowLabel,
  type ActivityRowLabelParts,
} from "./ActivityRow";
import { useAgentSessionTranscriptVariant } from "./agentSessionTranscriptContext";
import type { AgentActivityAction, TranscriptItem } from "./agentSessionTypes";
import { getBuzzToolInfo } from "./agentSessionToolCatalog";
import { verbLabel } from "./agentSessionToolClassifier";
import {
  buildCompactToolSummary,
  type CompactFileEditSummary,
  type CompactToolKind,
} from "./agentSessionToolSummary";
import type { FileEditDiff } from "./agentSessionFileEditDiff";
import {
  formatCodeValue,
  formatTranscriptTimestampTitle,
  getToolDurationDisplay,
  parseShellToolOutput,
} from "./agentSessionUtils";
import {
  FileEditDiffBlock,
  hasFileEditLineDiff,
  ScrollFadeMonoPanel,
} from "./FileContentBlock";

type ToolItemProps = {
  agentAvatarUrl: string | null;
  agentName: string;
  agentPubkey: string;
  item: Extract<TranscriptItem, { type: "tool" }>;
  profiles?: UserProfileLookup;
};

export function ToolItem({ item }: ToolItemProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasArgs = Object.keys(item.args).length > 0;
  const hasResult = item.result.trim().length > 0;
  const canonicalToolName = item.buzzToolName ?? item.toolName;
  const buzzTool = getBuzzToolInfo(canonicalToolName);
  const compactSummary = buildCompactToolSummary(item);
  const duration = getToolDurationDisplay(item);
  const timestampTitle = formatTranscriptTimestampTitle(item.timestamp);
  const handleToggle = React.useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      setIsExpanded(event.currentTarget.open);
    },
    [],
  );

  return (
    <div
      className="not-prose w-full"
      data-testid="transcript-tool-item"
      title={timestampTitle}
    >
      <details
        className="group w-full"
        onToggle={handleToggle}
        open={isExpanded}
      >
        <summary
          className={cn(
            "group/row flex min-h-6 max-w-full cursor-pointer list-none items-center gap-1.5",
            compactSummaryTone(),
          )}
        >
          <CompactToolSummaryRow
            action={compactSummary.action}
            duration={duration}
            fileEditSummary={compactSummary.fileEditSummary}
            kind={compactSummary.kind}
            label={compactSummary.label}
            preview={compactSummary.preview}
          />
        </summary>

        <ToolDetailBlocks
          args={item.args}
          description={buzzTool?.label}
          fileEditDiff={compactSummary.fileEditDiff}
          hasArgs={hasArgs}
          hasResult={hasResult}
          isError={item.isError}
          result={item.result}
          shellCommand={compactSummary.shellContent}
        />
      </details>
    </div>
  );
}

export function compactSummaryTone() {
  return "text-muted-foreground/60 transition-colors group-hover/row:text-foreground group-open:text-foreground";
}

export function CompactToolSummaryRow({
  action,
  duration,
  fileEditSummary,
  kind,
  label,
  preview,
}: {
  action: AgentActivityAction | null;
  duration: string | null;
  fileEditSummary: CompactFileEditSummary | null;
  kind: CompactToolKind;
  label: string;
  preview: string | null;
}) {
  const variant = useAgentSessionTranscriptVariant();
  const isCompactPreview = variant === "compactPreview";
  const mutedTone = compactSummaryTone();
  const actionLabel = fileEditSummary
    ? null
    : getCompactToolActionLabel(action, kind, label, preview);

  return (
    <>
      {fileEditSummary ? (
        <CompactFileEditSummaryView summary={fileEditSummary} />
      ) : actionLabel ? (
        <ActivityRowLabel
          object={actionLabel.object}
          openToneScope="tool"
          title={actionLabel.title}
          verb={actionLabel.verb}
        />
      ) : (
        <span
          className={cn(
            "shrink-0 font-semibold",
            isCompactPreview ? "text-xs" : "text-sm",
            mutedTone,
          )}
        >
          {label}
        </span>
      )}
      {!fileEditSummary && !actionLabel && preview ? (
        <span
          className={cn(
            "min-w-0 max-w-48 truncate",
            isCompactPreview ? "text-xs" : "text-sm",
            mutedTone,
          )}
          title={preview}
        >
          {preview}
        </span>
      ) : null}
      {duration ? (
        <span className={cn("shrink-0 text-xs", mutedTone)}>{duration}</span>
      ) : null}
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180",
          mutedTone,
        )}
      />
    </>
  );
}

function getCompactToolActionLabel(
  action: AgentActivityAction | null,
  kind: CompactToolKind,
  label: string,
  preview: string | null,
): (ActivityRowLabelParts & { title?: string }) | null {
  if (action) {
    const object = action.object ?? preview ?? undefined;
    return {
      verb: action.verb,
      object,
      title: typeof object === "string" ? object : undefined,
    };
  }

  const parts = splitActivityRowLabel(label);
  if (!parts) return null;

  if (!preview) return parts;

  if (
    kind === "shell" ||
    kind === "file-read" ||
    kind === "skill-read" ||
    kind === "plan" ||
    kind === "image"
  ) {
    return { verb: parts.verb, object: preview, title: preview };
  }

  return parts;
}

function CompactFileEditSummaryView({
  summary,
}: {
  summary: CompactFileEditSummary;
}) {
  return (
    <ActivityRowLabel
      className="max-w-72"
      object={summary.filename}
      openToneScope="tool"
      stats={{
        additions: summary.additions,
        deletions: summary.deletions,
      }}
      title={summary.path}
      verb={verbLabel("Edited")}
    />
  );
}

export function ToolDetailBlocks({
  args,
  description,
  fileEditDiff,
  hasArgs,
  hasResult,
  isError,
  result,
  shellCommand,
}: {
  args: Record<string, unknown>;
  description?: string;
  fileEditDiff: FileEditDiff | null;
  hasArgs: boolean;
  hasResult: boolean;
  isError: boolean;
  result: string;
  shellCommand: string | null;
}) {
  const t = useUiT();
  const showFileEditDiff =
    fileEditDiff !== null && hasFileEditLineDiff(fileEditDiff) && !isError;
  const showShellCommand = shellCommand != null && !showFileEditDiff;
  const showParameters = hasArgs && !showFileEditDiff;

  return (
    <div className="space-y-4 py-2 text-popover-foreground outline-hidden">
      {description ? (
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {showShellCommand ? (
        <ShellCommandBlock command={shellCommand} result={result} />
      ) : showParameters ? (
        <ToolCodeBlock
          label={t("agentTranscript.tool.parameters")}
          tone="muted"
          value={JSON.stringify(args, null, 2)}
        />
      ) : null}
      {!showShellCommand && hasResult ? (
        showFileEditDiff && fileEditDiff ? (
          <FileEditDiffBlock diff={fileEditDiff} />
        ) : (
          <ToolCodeBlock
            label={t(isError ? "agentTranscript.tool.error" : "agentTranscript.tool.result")}
            tone={isError ? "error" : "muted"}
            value={result}
          />
        )
      ) : null}
      {!showShellCommand && !showParameters && !hasResult ? (
        <p className="text-sm text-muted-foreground/80">
          {t("agentTranscript.tool.waiting")}
        </p>
      ) : null}
    </div>
  );
}

function ToolCodeBlock({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "muted" | "error";
  value: string;
}) {
  return (
    <div className="space-y-2 overflow-hidden">
      <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md px-3 py-2 font-mono text-xs leading-5",
          tone === "error"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground",
        )}
      >
        {formatCodeValue(value)}
      </pre>
    </div>
  );
}

export function ShellCommandBlock({
  command,
  result,
}: {
  command: string;
  result: string;
}) {
  const output = parseShellToolOutput(result);
  const stdout = output.stdout.trimEnd();

  return (
    <div
      className="overflow-hidden rounded-lg bg-muted font-mono text-xs leading-5"
      data-testid="transcript-shell-command"
    >
      <ScrollFadeMonoPanel
        fadeFromClassName="from-muted"
        maxHeightClassName="max-h-36"
      >
        <p className="whitespace-pre-wrap wrap-break-word text-muted-foreground/70">
          <Terminal className="mr-2 inline h-3.5 w-3.5 align-[-0.1875rem] text-primary" />
          {command}
        </p>
      </ScrollFadeMonoPanel>
      {stdout ? (
        <ScrollFadeMonoPanel
          className="mt-2"
          fadeFromClassName="from-muted"
          maxHeightClassName="max-h-36"
        >
          <pre className="whitespace-pre-wrap wrap-break-word text-foreground">
            {stdout}
          </pre>
        </ScrollFadeMonoPanel>
      ) : null}
    </div>
  );
}

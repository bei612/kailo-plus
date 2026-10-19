// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/agentSessionToolSummary.ts. File-read, skill-read
// and view-image contents come from ACP harness tools that a Codex thread does
// not produce (DD-125(6)); those branches are omitted.
import { translateCurrent } from "../../i18n";
import type {
  AgentActivityAction,
  AgentActivityDescriptor,
  ToolStatus,
  TranscriptItem,
} from "./agentSessionTypes";
import { getToolString } from "./agentSessionUtils";
import { classifyToolItem, failedLabel } from "./agentSessionToolClassifier";
import {
  buildFileEditDiff,
  type FileEditDiff,
  type FileEditDiffSummary,
} from "./agentSessionFileEditDiff";

export type CompactToolKind = AgentActivityDescriptor["renderClass"];

export type CompactToolSummary = {
  action: AgentActivityAction | null;
  kind: CompactToolKind;
  label: string;
  preview: string | null;
  fileEditSummary: FileEditDiffSummary | null;
  fileEditDiff: FileEditDiff | null;
  shellContent: string | null;
  presentation: "inline" | "message";
  descriptor: AgentActivityDescriptor;
};

type ToolItem = Extract<TranscriptItem, { type: "tool" }>;

export type CompactFileEditSummary = FileEditDiffSummary;

/** Build the muted compact summary label and preview for any tool row. */
export function buildCompactToolSummary(item: ToolItem): CompactToolSummary {
  const descriptor = item.descriptor ?? classifyToolItem(item);
  const fileEditDiff = buildFileEditDiff(item, descriptor);
  const fileEditSummary = fileEditDiff
    ? {
        path: fileEditDiff.path,
        filename: fileEditDiff.filename,
        additions: fileEditDiff.additions,
        deletions: fileEditDiff.deletions,
      }
    : null;
  const shellContent = buildShellContent(item, descriptor);
  const failed = item.isError || item.status === "failed";
  const running = item.status === "executing" || item.status === "pending";
  return {
    action: descriptor.action ?? null,
    kind: descriptor.renderClass,
    label: labelForStatus(descriptor, item.status, failed, running),
    preview: fileEditSummary?.filename ?? descriptor.preview,
    fileEditSummary,
    fileEditDiff,
    shellContent,
    presentation: descriptor.renderClass === "message" ? "message" : "inline",
    descriptor,
  };
}

function labelForStatus(
  descriptor: AgentActivityDescriptor,
  _status: ToolStatus,
  failed: boolean,
  running: boolean,
) {
  const label = descriptor.label;
  if (descriptor.groupKey?.startsWith("file-edit:")) {
    if (failed) return translateCurrent("agentTranscript.tool.editFailed");
    if (running) return translateCurrent("agentTranscript.tool.editingFile");
    return translateCurrent("agentTranscript.tool.editedFile");
  }
  if (failed) {
    return failedLabel(label);
  }
  return label;
}

function buildShellContent(
  item: ToolItem,
  descriptor: AgentActivityDescriptor,
): string | null {
  const command = getToolString(item.args, ["command"]);
  if (!command) {
    return null;
  }

  if (descriptor.renderClass === "shell" || descriptor.source === "shell") {
    return command;
  }

  return null;
}

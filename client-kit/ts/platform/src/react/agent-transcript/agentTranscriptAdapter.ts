// DD-125(6), 17 §8, SF-COD-09/17: the Codex item adapter. Kailo Agents do not
// emit the ACP observer frames (24200) or turn metrics (44200) that fed the
// original Buzz transcript (agentSessionTranscript.ts::processTranscriptEvent).
// Their transcript is the Installation's Codex ThreadStore, read by Core only for
// Installation `audit` holders and forwarded as AgentTranscriptItem (contracts).
// This module maps those items onto the original TranscriptItem union so the
// original renderers stay in charge of presentation.
//
// Omitted original inputs, each without a Kailo source:
// - permission prompts and outcomes: the runtime has no interactive approval
//   path (approval_policy answers PLATFORM_ADMISSION_REQUIRED, `12` §1);
// - observer connection states, raw JSON-RPC frames and the raw event rail:
//   there is no ACP observer stream, only Core-forwarded items;
// - system prompt / prompt context cards: developer instructions and the
//   untrusted additionalContext are not thread items;
// - card mint, todo and buzz-dev-mcp harness tools (read_file, view_image,
//   str_replace, load_skill, hooks): not Codex item kinds.
import type { AgentTranscriptItem } from "@client-kit/contracts";
import { translateCurrent } from "../../i18n";
import type { ToolStatus, TranscriptItem, TranscriptItemIdentity } from "./agentSessionTypes";
import {
  CODEX_FILE_CHANGE_TOOL,
  CODEX_SHELL_TOOL,
  CODEX_WEB_SEARCH_TOOL,
  classifyTool,
} from "./agentSessionToolClassifier";
import { findBuzzToolName } from "./agentSessionToolCatalog";
import { asRecord } from "./agentSessionUtils";

/** One forwarded native item and the AgentSession it belongs to. */
export type AgentTranscriptEntry = {
  item: AgentTranscriptItem;
  rootEventId: string;
  projectionGeneration: number;
};

export type AdaptOptions = {
  /** Display name of the Agent for assistant message titles. */
  agentName: string;
  /** Buzz Channel the Installation's Workspace is projected to, if known. */
  channelId?: string | null;
};

/** Stable AgentSession identity used as the original session-run key. */
export function agentSessionKey(rootEventId: string, projectionGeneration: number) {
  return `${rootEventId}:${projectionGeneration}`;
}

function iso(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString();
}

// The native status words, compared as text: generated enum member names are
// not part of the wire contract.
function toolStatus(item: AgentTranscriptItem): ToolStatus {
  const status: string | undefined = item.status;
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED" || status === "DECLINED") return "failed";
  if (status === "IN_PROGRESS") return "executing";
  return item.completedAtMs !== undefined ? "completed" : "executing";
}

function parseArguments(argumentsJson: string | undefined): Record<string, unknown> {
  if (!argumentsJson) return {};
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return Array.isArray(parsed) ? { arguments: parsed } : asRecord(parsed);
  } catch {
    return { arguments: argumentsJson };
  }
}

/** A native fileChange diff as the unified diff the original renderer reads. */
export function fileChangeDiff(changeKind: string, diff: string): string {
  if (changeKind === "UPDATE") return diff;
  const body = diff.endsWith("\n") ? diff.slice(0, -1) : diff;
  const lines = body.length > 0 ? body.split("\n") : [];
  const marker = changeKind === "ADD" ? "+" : "-";
  const header =
    changeKind === "ADD"
      ? `@@ -0,0 +1,${lines.length} @@`
      : `@@ -1,${lines.length} +0,0 @@`;
  return [header, ...lines.map((line) => `${marker}${line}`)].join("\n");
}

type ToolInput = {
  id: string;
  toolName: string;
  title: string;
  buzzToolName: string | null;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
  item: AgentTranscriptItem;
  identity: TranscriptItemIdentity;
};

function toolItem(input: ToolInput): TranscriptItem {
  const status = toolStatus(input.item);
  const isError = input.isError || status === "failed";
  const descriptor = classifyTool({
    title: input.title,
    toolName: input.toolName,
    buzzToolName: input.buzzToolName,
    args: input.args,
    result: input.result,
    isError,
  });
  const startedAt = iso(input.item.startedAtMs);
  const completedAt = iso(input.item.completedAtMs);
  return {
    id: input.id,
    type: "tool",
    renderClass: descriptor.renderClass,
    descriptor,
    title: input.title,
    toolName: input.toolName,
    buzzToolName: input.buzzToolName,
    status,
    args: input.args,
    result: input.result,
    isError,
    timestamp: startedAt || completedAt,
    startedAt,
    completedAt: completedAt || null,
    acpSource: input.item.nativeType,
    ...input.identity,
  };
}

/**
 * Map forwarded Codex items (in page/arrival order) to the original transcript
 * items. Absent native times stay absent; no local clock is substituted.
 */
export function adaptTranscriptItems(
  entries: readonly AgentTranscriptEntry[],
  options: AdaptOptions,
): TranscriptItem[] {
  const result: TranscriptItem[] = [];
  const promptedTurns = new Set<string>();
  for (const entry of entries) {
    result.push(...adaptEntry(entry, options, promptedTurns));
  }
  return result;
}

function adaptEntry(
  entry: AgentTranscriptEntry,
  options: AdaptOptions,
  promptedTurns: Set<string>,
): TranscriptItem[] {
  const { item } = entry;
  const session = agentSessionKey(entry.rootEventId, entry.projectionGeneration);
  const id = `${session}:${item.itemId}`;
  const identity: TranscriptItemIdentity = {
    turnId: item.turnId,
    sessionId: session,
    channelId: options.channelId ?? null,
  };
  const timestamp = iso(item.startedAtMs) || iso(item.completedAtMs);
  const kind: string = item.kind;
  switch (kind) {
    case "USER_MESSAGE": {
      const turnKey = `${session}:${item.turnId}`;
      const first = !promptedTurns.has(turnKey);
      promptedTurns.add(turnKey);
      return [{
        id, type: "message", renderClass: "message", role: "user",
        title: translateCurrent("agentTranscript.user"), text: item.text ?? "",
        timestamp, acpSource: first ? "session/prompt:user" : "session/steer:user", ...identity,
      }];
    }
    case "AGENT_MESSAGE":
      return [{
        id, type: "message", renderClass: "message", role: "assistant",
        title: options.agentName, text: item.text ?? "", timestamp,
        acpSource: item.nativeType, ...identity,
      }];
    case "REASONING": {
      const summary = (item.reasoningSummary ?? []).filter((part) => part.trim().length > 0);
      const parts = summary.length > 0 ? summary : (item.reasoningContent ?? []);
      const text = parts.join("\n\n").trim();
      if (!text) return [];
      return [{
        id, type: "thought", renderClass: "thought",
        title: translateCurrent("agentTranscript.thinking"), text, timestamp,
        acpSource: item.nativeType, ...identity,
      }];
    }
    case "PLAN":
      return [{
        id, type: "plan", renderClass: "plan",
        title: translateCurrent("agentTranscript.planUpdated"), text: item.text ?? "",
        timestamp, acpSource: item.nativeType, ...identity,
      }];
    case "COMMAND_EXECUTION": {
      const result: Record<string, unknown> = { stdout: item.aggregatedOutput ?? "" };
      if (item.exitCode !== undefined) result.exit_code = item.exitCode;
      if (item.durationMs !== undefined) result.duration_ms = item.durationMs;
      const args: Record<string, unknown> = { command: item.command ?? "" };
      if (item.cwd) args.cwd = item.cwd;
      return [toolItem({
        id, toolName: CODEX_SHELL_TOOL, title: CODEX_SHELL_TOOL, buzzToolName: null, args,
        result: JSON.stringify(result),
        isError: item.exitCode !== undefined && item.exitCode !== 0,
        item, identity,
      })];
    }
    case "FILE_CHANGE":
      return (item.fileChanges ?? []).map((change, index) => {
        const changeKind: string = change.changeKind;
        const path = change.movePath ?? change.path;
        return toolItem({
          id: `${id}:${index}`, toolName: CODEX_FILE_CHANGE_TOOL, title: CODEX_FILE_CHANGE_TOOL,
          buzzToolName: null, args: { path }, result: fileChangeDiff(changeKind, change.diff),
          isError: false, item, identity,
        });
      });
    case "MCP_TOOL_CALL":
    case "DYNAMIC_TOOL_CALL": {
      const tool = item.tool ?? item.nativeType;
      const title = item.server ? `${item.server}.${tool}` : tool;
      return [toolItem({
        id, toolName: tool, title, buzzToolName: findBuzzToolName(tool, true),
        args: parseArguments(item.argumentsJson),
        result: item.resultText ?? item.errorText ?? "",
        isError: item.errorText !== undefined, item, identity,
      })];
    }
    case "WEB_SEARCH":
      return [toolItem({
        id, toolName: CODEX_WEB_SEARCH_TOOL, title: CODEX_WEB_SEARCH_TOOL, buzzToolName: null,
        args: item.query ? { query: item.query } : {}, result: "", isError: false, item, identity,
      })];
    case "IMAGE_VIEW":
      return [{
        id, type: "lifecycle", renderClass: "status",
        title: translateCurrent("agentTranscript.viewedImage"), text: "", timestamp,
        acpSource: item.nativeType, ...identity,
      }];
    case "CONTEXT_COMPACTION":
      return [{
        id, type: "lifecycle", renderClass: "status",
        title: translateCurrent("agentTranscript.contextCompacted"), text: "", timestamp,
        acpSource: item.nativeType, ...identity,
      }];
    default:
      return [{
        id, type: "metadata", renderClass: "raw-rail",
        title: translateCurrent("agentTranscript.otherItem"),
        sections: [{ title: item.nativeType, body: translateCurrent("agentTranscript.otherItemBody") }],
        timestamp, acpSource: item.nativeType, ...identity,
      }];
  }
}

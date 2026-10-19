// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/agentSessionToolClassifier.ts, narrowed to the
// tool shapes a Codex thread actually produces (DD-125(6), SF-COD-17): shell
// commands, file changes, MCP/dynamic tool calls and web search. The ACP
// buzz-dev-mcp harness tools (read_file, view_image, str_replace, todo, hooks),
// load_skill and the Buzz CLI shell parser have no Kailo source and are omitted.
import { translateCurrent } from "../../i18n";
import type {
  AgentActivityAction,
  AgentActivityDescriptor,
  AgentActivityTone,
  TranscriptItem,
} from "./agentSessionTypes";
import {
  formatToolTitle,
  getBuzzToolInfo,
  normalizeToolNameText,
} from "./agentSessionToolCatalog";
import { getToolString, getToolStringList } from "./agentSessionUtils";

type ToolItem = Extract<TranscriptItem, { type: "tool" }>;

export type ToolClassificationInput = {
  title: string;
  toolName: string;
  buzzToolName: string | null;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
};

/** Tool names the Codex adapter assigns to native item kinds. */
export const CODEX_SHELL_TOOL = "shell";
export const CODEX_FILE_CHANGE_TOOL = "apply_patch";
export const CODEX_WEB_SEARCH_TOOL = "web_search";

type ToolClassifierProvider = (
  input: ToolClassificationInput,
) => AgentActivityDescriptor | null;

const providers: ToolClassifierProvider[] = [
  classifyCodexNativeTool,
  classifyBuzzTool,
];

/** Original verb tokens; the visible verb is translated. */
export function verbLabel(verb: string): string {
  switch (verb) {
    case "Added":
      return translateCurrent("agentTranscript.verb.added");
    case "Archived":
      return translateCurrent("agentTranscript.verb.archived");
    case "Created":
      return translateCurrent("agentTranscript.verb.created");
    case "Deleted":
      return translateCurrent("agentTranscript.verb.deleted");
    case "Edited":
      return translateCurrent("agentTranscript.verb.edited");
    case "Ran":
      return translateCurrent("agentTranscript.verb.ran");
    case "Read":
      return translateCurrent("agentTranscript.verb.read");
    case "Removed":
      return translateCurrent("agentTranscript.verb.removed");
    case "Searched":
      return translateCurrent("agentTranscript.verb.searched");
    case "Sent":
      return translateCurrent("agentTranscript.verb.sent");
    case "Unarchived":
      return translateCurrent("agentTranscript.verb.unarchived");
    case "Updated":
      return translateCurrent("agentTranscript.verb.updated");
    default:
      return verb;
  }
}

/** Original `${label} failed` unless the label already ends with it. */
export function failedLabel(label: string): string {
  return label.endsWith(translateCurrent("agentTranscript.tool.failedSuffix"))
    ? label
    : translateCurrent("agentTranscript.tool.failed", { label });
}

export function classifyTool(
  input: ToolClassificationInput,
): AgentActivityDescriptor {
  for (const provider of providers) {
    const descriptor = provider(input);
    if (descriptor) {
      return input.isError || descriptor.renderClass === "error"
        ? {
            ...descriptor,
            renderClass: "error",
            label: failedLabel(descriptor.label),
          }
        : descriptor;
    }
  }

  return genericDescriptor(input);
}

export function classifyToolItem(item: ToolItem): AgentActivityDescriptor {
  return classifyTool({
    title: item.title,
    toolName: item.toolName,
    buzzToolName: item.buzzToolName,
    args: item.args,
    result: item.result,
    isError: item.isError,
  });
}

function classifyCodexNativeTool(
  input: ToolClassificationInput,
): AgentActivityDescriptor | null {
  if (input.toolName === CODEX_SHELL_TOOL) {
    const command = getToolString(input.args, ["command"]);
    return {
      renderClass: "shell",
      label: translateCurrent("agentTranscript.tool.ranCommand"),
      preview: command,
      action: {
        verb: verbLabel("Ran"),
        object: command ?? translateCurrent("agentTranscript.object.command"),
      },
      source: "harness",
      groupKey: "shell:command",
    };
  }

  if (input.toolName === CODEX_FILE_CHANGE_TOOL) {
    const path = getToolString(input.args, ["path"]);
    return {
      renderClass: "file-edit",
      label: translateCurrent("agentTranscript.tool.editedFile"),
      preview: path,
      action: {
        verb: verbLabel("Edited"),
        object: path ?? translateCurrent("agentTranscript.object.file"),
      },
      object: path,
      source: "harness",
      groupKey: "file-edit:apply_patch",
    };
  }

  if (input.toolName === CODEX_WEB_SEARCH_TOOL) {
    const query = getToolString(input.args, ["query"]);
    return {
      renderClass: "generic",
      label: translateCurrent("agentTranscript.tool.searchedWeb"),
      preview: query,
      action: {
        verb: verbLabel("Searched"),
        object: query ?? translateCurrent("agentTranscript.object.web"),
      },
      source: "harness",
      groupKey: "generic:web_search",
    };
  }

  return null;
}

function classifyBuzzTool(
  input: ToolClassificationInput,
): AgentActivityDescriptor | null {
  const name = [input.buzzToolName, input.toolName, input.title].find(
    (value) => value && getBuzzToolInfo(value),
  );
  if (!name) return null;

  const info = getBuzzToolInfo(name);
  if (!info) return null;

  const operation = normalizeToolNameText(name);
  const label = formatToolTitle(name, input.title);
  const preview = extractBuzzToolPreview(input.args);
  return {
    renderClass: isBuzzMessageSend(operation) ? "message" : "relay-op",
    label,
    preview,
    action: actionForBuzzOperation(operation, preview, info.tone),
    tone: info.tone,
    operation,
    object: preview,
    source: "mcp",
    groupKey: `buzz:${operation}`,
  };
}

function genericDescriptor(
  input: ToolClassificationInput,
): AgentActivityDescriptor {
  const preview = genericPreview(input);
  return {
    renderClass: "generic",
    label: translateCurrent("agentTranscript.tool.ranTool"),
    preview,
    action: {
      verb: verbLabel("Ran"),
      object: preview ?? translateCurrent("agentTranscript.object.tool"),
    },
    source: "fallback",
    groupKey: `generic:${normalizeToolNameText(input.toolName || input.title)}`,
  };
}

function actionForBuzzOperation(
  operation: string,
  object: string | null,
  tone: AgentActivityTone,
): AgentActivityAction {
  const verb = operation.split("_")[0] ?? "run";
  return {
    verb: verbLabel(buzzOperationVerb(verb, tone)),
    object: object ?? buzzOperationObject(operation),
  };
}

function buzzOperationVerb(verb: string, tone: AgentActivityTone) {
  if (verb === "add") return "Added";
  if (verb === "archive") return "Archived";
  if (verb === "create") return "Created";
  if (verb === "delete") return "Deleted";
  if (verb === "get" || verb === "list" || verb === "members") return "Read";
  if (verb === "remove") return "Removed";
  if (verb === "search") return "Searched";
  if (verb === "send") return "Sent";
  if (verb === "unarchive") return "Unarchived";
  if (tone === "read") return "Read";
  return "Updated";
}

function buzzOperationObject(operation: string) {
  if (isBuzzMessageSend(operation)) {
    return translateCurrent("agentTranscript.object.message");
  }
  const object = operation.replace(
    /^(add|approve|archive|create|delete|edit|get|hide|join|leave|list|open|publish|remove|search|send|set|trigger|unarchive|update|vote)_/,
    "",
  );
  return object ? object.replace(/[-_]+/g, " ") : "Buzz";
}

function extractBuzzToolPreview(args: Record<string, unknown>): string | null {
  const content = getToolString(args, ["content", "message", "text", "body"]);
  if (content) return content;
  const query = getToolString(args, ["query", "search"]);
  if (query) return query;
  const channelId = getToolString(args, ["channel_id", "channelId"]);
  if (channelId) return channelId;
  const workflowId = getToolString(args, ["workflow_id", "workflowId"]);
  if (workflowId) return workflowId;
  const pubkeys = getToolStringList(args, ["pubkeys", "pubkey"]);
  if (pubkeys.length === 1) return pubkeys[0] ?? null;
  if (pubkeys.length > 1) {
    return translateCurrent("agentTranscript.object.users", {
      count: pubkeys.length,
    });
  }
  return getToolString(args, ["event_id", "eventId", "name"]);
}

function genericPreview(input: ToolClassificationInput): string | null {
  return (
    getToolString(input.args, [
      "command",
      "path",
      "source",
      "query",
      "name",
      "content",
      "message",
    ]) ?? (input.title ? input.title : null)
  );
}

function isBuzzMessageSend(operation: string) {
  return operation === "send_message" || operation === "messages_send";
}

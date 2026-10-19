// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/agentSessionToolCatalog.ts: the original Buzz
// tool catalog, kept for MCP tool names that match it. Descriptions are i18n keys.
import {
  Hash,
  MessageSquare,
  Search,
  Send,
  Users,
  Workflow,
} from "lucide-react";

import { translateCurrent } from "../../i18n";
import type { BuzzToolInfo, ToolStatus } from "./agentSessionTypes";

export function normalizeToolStatus(status: string): ToolStatus {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("complete") ||
    normalized.includes("success") ||
    normalized === "done"
  ) {
    return "completed";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }
  if (normalized.includes("pending")) {
    return "pending";
  }
  return "executing";
}

const BUZZ_READ_TOOLS = new Set([
  "get_messages",
  "get_channel_history",
  "get_thread",
  "search",
  "get_feed",
  "get_reactions",
  "list_channels",
  "get_channel",
  "get_users",
  "get_presence",
  "list_channel_members",
  "list_dms",
  "get_canvas",
  "list_workflows",
  "get_workflow_runs",
  "get_event",
  "get_user_notes",
  "get_contact_list",
]);

const BUZZ_WRITE_TOOLS = new Set([
  "send_message",
  "send_diff_message",
  "edit_message",
  "delete_message",
  "add_reaction",
  "remove_reaction",
  "join_channel",
  "leave_channel",
  "update_channel",
  "set_channel_topic",
  "set_channel_purpose",
  "open_dm",
  "set_profile",
  "set_presence",
  "trigger_workflow",
  "approve_step",
  "create_channel",
  "archive_channel",
  "unarchive_channel",
  "add_channel_member",
  "remove_channel_member",
  "add_dm_member",
  "hide_dm",
  "set_canvas",
  "create_workflow",
  "update_workflow",
  "delete_workflow",
  "set_channel_add_policy",
  "vote_on_post",
  "publish_note",
  "set_contact_list",
]);

const BUZZ_TOOL_NAMES = new Set([...BUZZ_READ_TOOLS, ...BUZZ_WRITE_TOOLS]);

const BUZZ_TOOL_NAMES_BY_LENGTH = [...BUZZ_TOOL_NAMES].sort(
  (left, right) => right.length - left.length,
);

export function getBuzzToolInfo(title: string): BuzzToolInfo | null {
  const name = normalizeToolName(title);
  const isRead = BUZZ_READ_TOOLS.has(name);
  const isWrite = BUZZ_WRITE_TOOLS.has(name);
  if (!isRead && !isWrite) {
    return null;
  }

  if (name.includes("workflow") || name === "approve_step") {
    return {
      icon: Workflow,
      label: translateCurrent(
        isRead
          ? "agentTranscript.buzz.workflowRead"
          : "agentTranscript.buzz.workflowWrite",
      ),
      tone: isWrite ? "write" : "read",
    };
  }
  if (
    name.includes("channel") ||
    name.includes("messages") ||
    name === "get_thread"
  ) {
    return {
      icon: Hash,
      label: translateCurrent(
        isRead
          ? "agentTranscript.buzz.channelRead"
          : "agentTranscript.buzz.channelWrite",
      ),
      tone: isWrite ? "write" : "read",
    };
  }
  if (
    name.includes("user") ||
    name.includes("member") ||
    name.includes("presence")
  ) {
    return {
      icon: Users,
      label: translateCurrent(
        isRead
          ? "agentTranscript.buzz.identityRead"
          : "agentTranscript.buzz.identityWrite",
      ),
      tone: isWrite ? "write" : "admin",
    };
  }
  if (name.includes("search") || name === "get_feed") {
    return {
      icon: Search,
      label: translateCurrent("agentTranscript.buzz.search"),
      tone: "read",
    };
  }
  if (
    name.startsWith("send_") ||
    name.includes("reaction") ||
    name === "publish_note"
  ) {
    return {
      icon: Send,
      label: translateCurrent("agentTranscript.buzz.publish"),
      tone: "write",
    };
  }

  return {
    icon: MessageSquare,
    label: translateCurrent(
      isRead ? "agentTranscript.buzz.read" : "agentTranscript.buzz.write",
    ),
    tone: isWrite ? "write" : "read",
  };
}

export function normalizeToolName(title: string): string {
  const knownName = findBuzzToolName(title, true);
  if (knownName) return knownName;

  const normalized = normalizeToolNameText(title).replace(/^buzz_/, "");
  return normalized.match(/[a-z][a-z0-9_]+/)?.[0] ?? normalized;
}

export function normalizeToolNameText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function findBuzzToolName(value: string, includeShortNames: boolean) {
  const normalized = normalizeToolNameText(value);
  return (
    BUZZ_TOOL_NAMES_BY_LENGTH.find(
      (name) =>
        (includeShortNames || name.length >= 8) && normalized.includes(name),
    ) ?? null
  );
}

export function isGenericToolTitle(value: string): boolean {
  const normalized = normalizeToolNameText(value);
  return (
    normalized.length === 0 ||
    normalized === "tool" ||
    normalized === "tool_call" ||
    normalized === "mcp_tool_call" ||
    normalized === "unknown" ||
    normalized === "read" ||
    normalized === "write" ||
    normalized === "execute" ||
    normalized === "completed"
  );
}

export function formatToolTitle(
  toolName: string,
  fallbackTitle?: string,
): string {
  const name = normalizeToolName(toolName);
  if (BUZZ_READ_TOOLS.has(name) || BUZZ_WRITE_TOOLS.has(name)) {
    return name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (fallbackTitle && !isGenericToolTitle(fallbackTitle)) {
    return fallbackTitle;
  }
  return toolName;
}

// Host seam for the original WorkflowMessagePicker reads (Buzz
// 779af8886caae1317b4de962082429867ab61503 desktop/src/features/workflows/ui/WorkflowMessagePicker.tsx:
// getChannelWindowEvents, getEventById, useSearchMessagesQuery). Web reads through
// its BFF-signed channel window/search; Desktop keeps its local-key Relay reads.
// No message body is stored here and every result is validated by the caller.
import { createContext, useContext } from "react";
import type { ChannelWindowCursor, RelayEvent } from "./forum/channelWindowResponse";
import { useBffClient } from "./context";
import { useLoad } from "./use-load";

export type WorkflowMessageScope = { workspaceId: string; channelId: string };

export type WorkflowMessageHost = {
  /** One server-assembled channel window page: content rows plus the bounds event. */
  history: (scope: WorkflowMessageScope, cursor: ChannelWindowCursor | null, limit: number) => Promise<RelayEvent[]>;
  /** Exact admitted event, or null when the channel cannot provide it. */
  event: (scope: WorkflowMessageScope, eventId: string) => Promise<RelayEvent | null>;
  /** Channel-scoped full-text search; returned events are re-validated. */
  search: (scope: WorkflowMessageScope, query: string, limit: number) => Promise<RelayEvent[]>;
};

const WorkflowMessageHostContext = createContext<WorkflowMessageHost | undefined>(undefined);
export const WorkflowMessageHostProvider = WorkflowMessageHostContext.Provider;
export const useWorkflowMessageHost = () => useContext(WorkflowMessageHostContext);

/**
 * The Relay channel behind the workflow's Workspace, read through the existing
 * admitted descriptor. Uses the shared loader so every WorkflowsPage consumer
 * keeps the PlatformProvider-only contract.
 */
export function useWorkflowMessageScope(workspaceId: string | null | undefined): {
  scope: WorkflowMessageScope | null; isPending: boolean; isError: boolean; refetch: () => void;
} {
  const client = useBffClient();
  const [state, reload] = useLoad(`workflow-message-scope:${workspaceId ?? ""}`,
    () => (workspaceId ? client.workspaceChannel(workspaceId) : Promise.resolve(null)));
  const channelId = state.status === "ok" && state.data && typeof state.data.channelId === "string" && state.data.channelId
    ? state.data.channelId : null;
  return {
    scope: workspaceId && channelId ? { workspaceId, channelId } : null,
    isPending: !!workspaceId && state.status === "pending",
    isError: !!workspaceId && (state.status === "error" || (state.status === "ok" && !channelId)),
    refetch: reload,
  };
}

// Web host for the shared original WorkflowMessagePicker (Buzz
// 779af8886caae1317b4de962082429867ab61503 WorkflowMessagePicker reads). The
// browser only issues the existing typed BFF window, anchor and search queries;
// Core signs the Relay reads and the shared picker re-validates every event.
import type { WorkflowMessageHost } from "@client-kit/platform/react/workflows";
import { TransportError } from "@client-kit/platform/transport";
import { bff, searchMessageEvents, type BuzzEvent } from "../bff-client";

function events(page: { events: unknown }): BuzzEvent[] {
  if (!Array.isArray(page.events)) throw new TransportError("Invalid workflow message page");
  return page.events as BuzzEvent[];
}

export const webWorkflowMessageHost: WorkflowMessageHost = {
  history: async (scope, cursor) => events(await bff.workspaceMessages(scope.workspaceId,
    cursor ? { before: cursor.createdAt, beforeId: cursor.eventId } : undefined)),
  event: async (scope, eventId) => events(await bff.workspaceMessages(scope.workspaceId, { anchorEventId: eventId }))
    .find((event) => event?.id === eventId) ?? null,
  search: (scope, query, limit) => searchMessageEvents({ q: query, limit, channelId: scope.channelId }),
};

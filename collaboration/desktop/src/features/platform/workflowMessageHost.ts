// Desktop host for the shared original WorkflowMessagePicker (Buzz
// 779af8886caae1317b4de962082429867ab61503 desktop/src/features/workflows/ui/WorkflowMessagePicker.tsx):
// the same local-key Relay window, exact event and FTS reads as the original;
// search hits are discovery hints and are resolved to exact events.
import type { WorkflowMessageHost } from "@client-kit/platform/react/workflows";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import { searchMessages } from "@/shared/api/tauri";
import { getEventById } from "@/shared/api/tauriEvents";

export const desktopWorkflowMessageHost: WorkflowMessageHost = {
  history: (scope, cursor, limit) => getChannelWindowEvents(scope.channelId, cursor, limit),
  event: (_scope, eventId) => getEventById(eventId),
  search: async (scope, query, limit) => {
    const response = await searchMessages({ q: query, limit, channelId: scope.channelId });
    const eventIds = [...new Set(response.hits.map((hit) => hit.eventId))];
    return Promise.all(eventIds.map((eventId) => getEventById(eventId)));
  },
};

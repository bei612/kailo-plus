import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { isInboxThreadContextEvent } from "@/features/home/lib/inboxViewHelpers";
import { relayEventFromFeedItem } from "@/features/home/lib/inbox";
import { getThreadReference } from "@/features/messages/lib/threading";
import { relayClient } from "@/shared/api/relayClient";
import { getEventById } from "@/shared/api/tauri";
import type { FeedItem, RelayEvent } from "@/shared/api/types";
import { HOME_MENTION_EVENT_KINDS, CHANNEL_TIMELINE_CONTENT_KINDS } from "@/shared/constants/kinds";
import { AUX_BACKFILL_CHUNK_SIZE, buildChannelReactionAuxFilter, buildChannelAuxDeletionFilter, buildChannelStructuralAuxFilter } from "@/shared/api/relayChannelFilters";

type InboxThreadContextResult = {
  events: RelayEvent[];
  hasLoadError: boolean;
  isLoading: boolean;
  refreshReactions: () => Promise<void>;
};

const THREAD_CONTEXT_LIMIT = 100;
const MAX_ANCESTOR_HOPS = 50;

function dedupeEvents(events: RelayEvent[]): RelayEvent[] {
  const eventsById = new Map<string, RelayEvent>();
  for (const event of events) {
    eventsById.set(event.id, event);
  }
  return [...eventsById.values()].sort((a, b) => a.created_at - b.created_at);
}

function getThreadRootId(event: RelayEvent): string {
  const thread = getThreadReference(event.tags);
  return thread.rootId ?? thread.parentId ?? event.id;
}

export function useInboxThreadContext(
  item: FeedItem | null,
  channelMessages: RelayEvent[] | undefined,
  options: { fullChannel?: boolean; hasChannelLoadError?: boolean; isChannelLoading?: boolean } = {},
): InboxThreadContextResult {
  const { fullChannel = false, hasChannelLoadError = false, isChannelLoading = false } = options;
  const [fetchedEvents, setFetchedEvents] = React.useState<RelayEvent[]>([]);
  const [hasLoadError, setHasLoadError] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const selectedEvent = React.useMemo(
    () => (item ? relayEventFromFeedItem(item) : null),
    [item],
  );

  const selectedThreadRootId = selectedEvent
    ? getThreadRootId(selectedEvent)
    : null;
  const selectedParentId = selectedEvent
    ? getThreadReference(selectedEvent.tags).parentId
    : null;
  const selectedChannelId = item?.channelId ?? null;

  React.useEffect(() => {
    let isCancelled = false;

    if (!selectedEvent || !selectedThreadRootId || fullChannel) {
      setFetchedEvents([]);
      setHasLoadError(false);
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    async function loadContext() {
      const targetEvent = selectedEvent;
      const threadRootId = selectedThreadRootId;
      if (!targetEvent || !threadRootId) {
        return;
      }

      setIsLoading(true);
      setHasLoadError(false);

      try {
        const selection = {
          selectedChannelId,
          selectedEventId: targetEvent.id,
          selectedParentId,
          selectedThreadRootId: threadRootId,
        };
        const ancestorEventsPromise = (async () => {
          const eventsById = new Map<string, RelayEvent>();
          let failed = false;

          const fetchEvent = async (eventId: string) => {
            if (eventId === targetEvent.id || eventsById.has(eventId)) {
              return eventsById.get(eventId) ?? targetEvent;
            }

            try {
              const event = await getEventById(eventId);
              eventsById.set(event.id, event);
              return event;
            } catch {
              failed = true;
              return null;
            }
          };

          if (threadRootId !== targetEvent.id) {
            await fetchEvent(threadRootId);
          }

          let ancestorId = selectedParentId;
          const seen = new Set<string>([targetEvent.id]);
          let hops = 0;
          while (
            ancestorId &&
            !seen.has(ancestorId) &&
            hops < MAX_ANCESTOR_HOPS
          ) {
            seen.add(ancestorId);
            const ancestor = await fetchEvent(ancestorId);
            if (!ancestor || ancestorId === threadRootId) {
              break;
            }
            ancestorId = getThreadReference(ancestor.tags).parentId;
            hops += 1;
          }

          return { events: [...eventsById.values()], failed };
        })();

        const descendantEventsPromise =
          selectedChannelId && threadRootId
            ? relayClient
                .fetchEvents({
                  "#e": [threadRootId],
                  "#h": [selectedChannelId],
                  kinds: [...HOME_MENTION_EVENT_KINDS],
                  limit: THREAD_CONTEXT_LIMIT,
                })
                .then((events) => ({ events, failed: false }))
                .catch((error) => {
                  console.error(
                    "Failed to hydrate Inbox thread context",
                    selectedChannelId,
                    threadRootId,
                    error,
                  );
                  return { events: [] as RelayEvent[], failed: true };
                })
            : Promise.resolve({ events: [] as RelayEvent[], failed: false });
        const [ancestorResult, descendantResult] = await Promise.all([
          ancestorEventsPromise,
          descendantEventsPromise,
        ]);

        if (isCancelled) {
          return;
        }

        setHasLoadError(ancestorResult.failed || descendantResult.failed);
        setFetchedEvents(
          dedupeEvents(
            [...ancestorResult.events, ...descendantResult.events].filter(
              (event): event is RelayEvent =>
                event !== null && isInboxThreadContextEvent(event, selection),
            ),
          ),
        );
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to load Inbox message context", error);
          setHasLoadError(true);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadContext();

    return () => {
      isCancelled = true;
    };
  }, [
    fullChannel,
    selectedChannelId,
    selectedEvent,
    selectedParentId,
    selectedThreadRootId,
  ]);

  const events = React.useMemo(() => {
    if (!selectedEvent) {
      return [];
    }

    if (fullChannel) {
      return dedupeEvents([selectedEvent, ...(channelMessages ?? []).filter(event =>
        (CHANNEL_TIMELINE_CONTENT_KINDS as readonly number[]).includes(event.kind))]);
    }

    const localContext = (channelMessages ?? []).filter((event) => {
      return isInboxThreadContextEvent(event, {
        selectedChannelId,
        selectedEventId: selectedEvent.id,
        selectedParentId,
        selectedThreadRootId,
      });
    });

    const currentFetchedEvents = fetchedEvents.filter((event) =>
      isInboxThreadContextEvent(event, {
        selectedChannelId,
        selectedEventId: selectedEvent.id,
        selectedParentId,
        selectedThreadRootId,
      }),
    );

    return dedupeEvents([
      selectedEvent,
      ...currentFetchedEvents,
      ...localContext,
    ]);
  }, [
    fullChannel,
    channelMessages,
    fetchedEvents,
    selectedChannelId,
    selectedEvent,
    selectedParentId,
    selectedThreadRootId,
  ]);

  // Original Inbox reactions are hydrated by visible context ids, not the
  // channel head. Kailo keeps the admitted #h on both hops; Relay derives the
  // reaction/deletion channel_id from its signed target.
  const contextEventIdsKey = React.useMemo(() => events.map(event => event.id).sort().join(","), [events]);
  const reactions = useQuery({
    queryKey: ["inbox-reactions", selectedChannelId, contextEventIdsKey],
    enabled: Boolean(selectedChannelId && contextEventIdsKey),
    queryFn: async ({ signal }) => {
      if (!selectedChannelId || !contextEventIdsKey) return [];
      const fetchAux = async (ids: string[], filter: typeof buildChannelReactionAuxFilter) => {
        const result: RelayEvent[] = [];
        for (let offset = 0; offset < ids.length; offset += AUX_BACKFILL_CHUNK_SIZE) {
          signal.throwIfAborted();
          result.push(...await relayClient.fetchEvents(filter(selectedChannelId, ids.slice(offset, offset + AUX_BACKFILL_CHUNK_SIZE))));
        }
        signal.throwIfAborted();
        return result;
      };
      const ids = contextEventIdsKey.split(",");
      const structuralEvents = await fetchAux(ids, buildChannelStructuralAuxFilter);
      const reactionEvents = await fetchAux(ids, buildChannelReactionAuxFilter);
      const deletions = await fetchAux([...structuralEvents, ...reactionEvents].map(event => event.id), buildChannelAuxDeletionFilter);
      return [...structuralEvents, ...reactionEvents, ...deletions];
    },
  });
  const projectedEvents = React.useMemo(() => dedupeEvents([...events, ...(!reactions.isError ? reactions.data ?? [] : [])]), [events, reactions.data, reactions.isError]);
  const refreshReactions = React.useCallback(async () => {
    const refreshed = await reactions.refetch();
    if (refreshed.error) throw refreshed.error;
  }, [reactions.refetch]);
  return {
    events: projectedEvents,
    hasLoadError: (fullChannel ? hasChannelLoadError : hasLoadError) || reactions.isError,
    isLoading: (fullChannel ? isChannelLoading : isLoading) || reactions.isFetching,
    refreshReactions,
  };
}

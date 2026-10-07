// Restored from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/api/relayChannelFilters.ts. Kailo retains #h so the
// authenticated Relay checks the target-derived StoredEvent.channel_id.
import { KIND_DELETION, KIND_NIP29_DELETE_EVENT, KIND_REACTION, KIND_STREAM_MESSAGE_EDIT } from "@/shared/constants/kinds";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";

export const AUX_BACKFILL_CHUNK_SIZE = 100;
export const MAX_HISTORICAL_LIMIT = 10_000;

export function buildChannelStructuralAuxFilter(channelId: string, messageIds: string[]): RelaySubscriptionFilter {
  return { kinds: [KIND_STREAM_MESSAGE_EDIT, KIND_DELETION, KIND_NIP29_DELETE_EVENT], "#h": [channelId], "#e": messageIds, limit: MAX_HISTORICAL_LIMIT };
}

export function buildChannelReactionAuxFilter(channelId: string, messageIds: string[]): RelaySubscriptionFilter {
  return { kinds: [KIND_REACTION], "#h": [channelId], "#e": messageIds, limit: MAX_HISTORICAL_LIMIT };
}

export function buildChannelAuxDeletionFilter(channelId: string, auxEventIds: string[]): RelaySubscriptionFilter {
  return { kinds: [KIND_DELETION, KIND_NIP29_DELETE_EVENT], "#h": [channelId], "#e": auxEventIds, limit: MAX_HISTORICAL_LIMIT };
}

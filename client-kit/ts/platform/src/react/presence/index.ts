// DD-120 shared presence surface (fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/presence); hosts inject transport through PresenceHostProvider.
export { PresenceHostProvider, ingestPresenceStreamEvent } from "./host";
export {
  usePresenceHost,
  useSelfPresence,
  type PresenceHost,
  type PresenceSession,
  type UserStatusReceipt,
} from "./context";
export {
  applyLivePresenceEvent,
  fetchPresenceLookup,
  presenceQueryKey,
  usePresenceQuery,
  usePresenceSession,
  PRESENCE_QUERY_CHUNK_SIZE,
  PRESENCE_REFETCH_INTERVAL_MS,
} from "./hooks";
export {
  aggregatePresence,
  getPresenceChipClassName,
  getPresenceDotClassName,
  getPresenceLabelKey,
  isPresenceStatus,
  type PresenceLookup,
  type PresenceStatus,
} from "./lib/presence";
export { PresenceBadge, PresenceCornerDot, PresenceDot } from "./ui/PresenceBadge";
export { ProfileAvatarWithStatus } from "./ui/ProfileAvatarWithStatus";

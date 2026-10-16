// DD-120 shared user-status surface (fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status); transport comes from the presence host.
export {
  applyUserStatusEventToQueries,
  newestVisibleUserStatus,
  useSetUserStatusMutation,
  useUserStatusQuery,
  userStatusQueryKey,
  userStatusUpdateRequest,
  visibleUserStatus,
  USER_STATUS_REFETCH_INTERVAL_MS,
} from "./hooks";
export type { UserStatus, UserStatusInput, UserStatusLookup } from "./types";
export { SetStatusDialog } from "./ui/SetStatusDialog";
export { DEFAULT_USER_STATUS_EMOJI, StatusEmoji } from "./ui/StatusEmoji";
export { UserNameIndicators } from "./ui/UserNameIndicators";

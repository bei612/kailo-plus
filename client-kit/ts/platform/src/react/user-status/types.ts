// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/types.ts, with the original shared/api/types.ts
// UserStatus/UserStatusLookup projections it reads.
export type UserStatusInput = {
  text: string;
  emoji: string;
  expiresAt?: number;
};

export type UserStatus = {
  text: string;
  emoji: string;
  updatedAt: number;
  /** NIP-01 tie-breaker for replacement events sharing `updatedAt`. */
  eventId?: string;
  expiresAt?: number;
};
export type UserStatusLookup = Record<string, UserStatus | null>;

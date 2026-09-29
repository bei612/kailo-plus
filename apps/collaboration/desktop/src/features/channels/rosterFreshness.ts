/**
 * Member-roster freshness policy. Split from hooks.ts to keep that file under
 * the per-file line cap.
 */

/**
 * Freshness window for the full member roster. Kept long because every
 * membership change the client can observe invalidates this key explicitly:
 * live join/leave/removed system messages for the active channel
 * (useChannelSubscription), member-added/removed notifications targeting the
 * current identity (useMembershipNotifications). The residual staleness is
 * a third party joining a channel the viewer is not currently subscribed to,
 * which corrects within this window. The previous 30s window put a full
 * roster fetch (kind:39002 + a kind:0 batch over every member) on nearly
 * every channel switch.
 */
export const CHANNEL_MEMBERS_STALE_TIME_MS = 5 * 60_000;

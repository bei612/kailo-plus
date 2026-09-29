const NOTIFICATION_BODY_MAX_LENGTH = 140;

/**
 * Truncate notification body text to {@link NOTIFICATION_BODY_MAX_LENGTH}
 * characters, appending "..." when truncated.  Returns `fallback` when
 * `content` is blank after trimming.
 */
export function truncateNotificationBody(
  content: string,
  fallback: string,
): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return fallback;
  if (trimmed.length <= NOTIFICATION_BODY_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 3).trimEnd()}...`;
}

/**
 * Format a notification title with optional channel context.
 *
 * - With a channel label: `"prefix in #channel"`
 * - Without: `"prefix"`
 */
export function formatNotificationTitle(opts: {
  prefix: string;
  channelLabel: string | null;
}): string {
  return opts.channelLabel
    ? `${opts.prefix} in ${opts.channelLabel}`
    : opts.prefix;
}

export type MessageNotificationSource = "mention" | "thread_reply";

const MESSAGE_BODY_FALLBACKS: Record<MessageNotificationSource, string> = {
  mention: "Something in Buzz needs your attention.",
  thread_reply: "New reply",
};

/**
 * Canonical copy for every message-shaped desktop notification (home-feed
 * mentions and live thread replies). All paths format through here so sender
 * attribution and fallbacks stay consistent: the sender leads the title
 * whenever their profile has resolved, and each source degrades to neutral
 * copy — never a raw pubkey — when it has not.
 *
 * `senderName` must already be a real human label (see
 * `senderNameFromSummary`); `channelName` is the raw channel name without
 * a `#` prefix.
 */
export function formatMessageNotification(opts: {
  source: MessageNotificationSource;
  senderName?: string | null;
  channelName?: string | null;
  content: string;
}): { title: string; body: string } {
  const { source, content } = opts;
  const senderName = opts.senderName?.trim() || null;
  const channelName = opts.channelName?.trim() || null;
  const body = truncateNotificationBody(
    content,
    MESSAGE_BODY_FALLBACKS[source],
  );

  const channelLabel = channelName ? `#${channelName}` : null;
  const prefix =
    source === "mention"
      ? senderName
        ? `${senderName} mentioned you`
        : "@Mention"
      : senderName
        ? `${senderName} replied`
        : "Reply";

  return { title: formatNotificationTitle({ prefix, channelLabel }), body };
}

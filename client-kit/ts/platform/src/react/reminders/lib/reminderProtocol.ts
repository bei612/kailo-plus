import type { ReminderContent, ReminderTarget } from "./reminderTypes";

/**
 * Parse a NIP-ER `not_before` tag value, mirroring the relay's strict
 * validator (NIP-ER line 60): ASCII digits only, no leading zero except "0",
 * and within `Number.MAX_SAFE_INTEGER`. Returns undefined for any value the
 * relay would reject, so the client ignores reminders the relay calls malformed.
 */
export function parseNotBefore(raw: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return undefined;
  const val = Number(raw);
  return val <= Number.MAX_SAFE_INTEGER ? val : undefined;
}

/**
 * Validate decrypted reminder plaintext against the shape this client writes,
 * returning a typed content object or null. NIP-ER (Content section) requires
 * clients to ignore plaintext that is not a JSON object, has an unknown
 * `status`, or has a malformed target/note — so anything off-shape fails closed.
 */
export function parseReminderContent(
  plaintext: string,
): ReminderContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.status !== "pending" &&
    obj.status !== "done" &&
    obj.status !== "cancelled"
  ) {
    return null;
  }
  if (obj.note !== undefined && typeof obj.note !== "string") return null;

  let target: ReminderTarget | undefined;
  if (obj.target !== undefined) {
    const parsedTarget = parseTarget(obj.target);
    if (!parsedTarget) return null;
    target = parsedTarget;
  }

  // A reminder must reference a target or carry a non-empty note.
  if (!target && !(typeof obj.note === "string" && obj.note.length > 0)) {
    return null;
  }

  return { status: obj.status as ReminderContent["status"], target, note: obj.note as string | undefined };
}

function parseTarget(value: unknown): ReminderTarget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const t = value as Record<string, unknown>;
  if (
    typeof t.eventId !== "string" ||
    typeof t.channelId !== "string" ||
    typeof t.preview !== "string" ||
    typeof t.authorPubkey !== "string"
  ) {
    return null;
  }
  return {
    eventId: t.eventId,
    channelId: t.channelId,
    preview: t.preview,
    authorPubkey: t.authorPubkey,
  };
}

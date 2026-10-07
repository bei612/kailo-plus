import type { Translate } from "../../context";
import { translateCurrent } from "../../../i18n";
// Upstream Buzz 779af8886caae1317b4de962082429867ab61503: desktop/src/features/messages/lib/systemEventCopy.ts
/**
 * Copy for channel system events (the "joined", "added by", "changed the
 * topic" captions in the message timeline).
 *
 * These live outside `SystemMessageRow` so the wording is a pure function of
 * the payload and can be asserted directly in tests. Only cases whose caption
 * is plain text belong here — cases that interpolate a profile link build their
 * JSX in the component.
 */

export type ChannelTextField = "topic" | "purpose";

/**
 * The reader is the recipient of an add, while every other member is the
 * subject of one. Keep that distinction in the caption: "You were added by"
 * rather than the ungrammatical "You added by".
 */
export function addedByActionPrefix(isCurrentUser: boolean, t: Translate = translateCurrent): string {
  return isCurrentUser ? t("messages.system.addedBySelf") : t("messages.system.addedBy");
}

/**
 * Generic add caption when the timeline should state that someone was added
 * without attributing the action to a single actor.
 */
export function addedActionPrefix(isCurrentUser: boolean, t: Translate = translateCurrent): string {
  return isCurrentUser ? t("messages.system.addedSelf") : t("messages.system.added");
}

/**
 * Caption for a channel topic or purpose change.
 *
 * Bare "the topic" rather than "the channel topic": this row only ever renders
 * in a channel timeline, under that channel's own header, so naming the channel
 * again is redundant — and it keeps the cleared and changed captions on the same
 * noun instead of one saying "channel topic" and the other "topic".
 *
 * A blank value means the field was cleared: the relay reports a clear as a
 * `topic_changed` / `purpose_changed` event carrying an empty string, not as a
 * separate event type. Without this branch the timeline renders `changed the
 * topic to ""`, which reads like the topic was set to two quote marks.
 * Whitespace-only values are treated as cleared for the same reason.
 */
export function describeChannelTextFieldChange(
  field: ChannelTextField,
  value: string | null | undefined,
  t: Translate = translateCurrent,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return t(field === "topic" ? "messages.system.topicCleared" : "messages.system.purposeCleared");
  }
  return t(field === "topic" ? "messages.system.topicChanged" : "messages.system.purposeChanged", { value: trimmed });
}

/**
 * Adjusts a resolved display name for use inside a sentence rather than in the
 * name slot at the top of a row — "added by you", "removed you from the channel".
 *
 * `resolveUserLabel` returns "You" for the current user, which is right standing
 * alone and wrong mid-phrase. Agent ownership already draws the same distinction
 * from the other side: `formatOwnerLabel` returns lowercase "you" because it is
 * only ever read as "managed by you".
 *
 * `isSelf` is the caller's pubkey comparison, not an inspection of `label`.
 * Matching on the string would also rewrite a different person whose display
 * name happens to be "You" — the label is user-controlled, identity is not.
 * Every name that isn't the reader's own is a proper noun and is returned
 * untouched.
 */
export function toInlineName(label: string, isSelf: boolean, t: Translate = translateCurrent): string {
  return isSelf ? t("messages.system.inlineYou") : label;
}

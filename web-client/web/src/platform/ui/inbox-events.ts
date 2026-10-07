import type { BuzzEvent } from "@/platform/bff-client";
import { parseChannelWindowResponse } from "@client-kit/platform/react/forum/channelWindowResponse";
import {
  CHANNEL_AUX_EVENT_KINDS,
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_CHANNEL_WINDOW_BOUNDS,
  KIND_DELETION,
  CHANNEL_TIMELINE_CONTENT_KINDS,
} from "@client-kit/platform/react/thread/kinds";
export type Event = BuzzEvent & { createdAt: number; channelId: string; category: "mention" | "activity" };
export const hex = /^[0-9a-f]{64}$/;

/** Original Relay window rows, not its signed summaries/bounds or action overlays.
 * Core verifies every signature and the two-hop target closure before returning
 * this page. Target-scoped NIP-25 reactions (7) and NIP-09 deletions can omit h.
 */
export function inboxWindowEvents(raw: unknown, workspace: string): Event[] {
  if (!Array.isArray(raw)) throw new Error("Invalid message page");
  const events = raw as BuzzEvent[];
  const metadataKinds = new Set<number>([
    ...CHANNEL_AUX_EVENT_KINDS,
    KIND_CHANNEL_THREAD_SUMMARY,
    KIND_CHANNEL_WINDOW_BOUNDS,
    7, // NIP-25 reaction, returned by the governed Core window auxiliary closure.
  ]);
  for (const event of events) {
    if (!event || (!(CHANNEL_TIMELINE_CONTENT_KINDS as readonly number[]).includes(event.kind) && !metadataKinds.has(event.kind))) {
      throw new Error("Unverifiable message kind");
    }
    // Reuse the row shape/scope guard, including for non-rendered metadata.
    // No h is legal only for the two native target-scoped auxiliary kinds.
    const targetScoped = [KIND_DELETION, 7].includes(event.kind)
      && Array.isArray(event.tags) && !event.tags.some((tag) => tag?.[0] === "h");
    validateInboxEvent(event, workspace, targetScoped);
  }
  const window = parseChannelWindowResponse(events, workspace, null);
  return window.rows.flatMap(({event}) => event.kind === 9 || event.kind === 40002 ? inboxEvents([event], workspace, event.kind) : []);
}

/** The query is already scope-filtered by Core; mismatched/unverifiable data is never shown. */
export function inboxEvents(raw: unknown, workspace: string, kind: 9 | 40002 | 40003 = 9): Event[] {
  if (!Array.isArray(raw)) throw new Error("Invalid message page");
  return raw.map((value: unknown) => {
    const event = value as BuzzEvent;
    validateInboxEvent(event, workspace);
    if (event.kind !== kind) throw new Error("Unverifiable message kind");
    return { ...event, createdAt: event.created_at, channelId: workspace, category: "activity" };
  });
}

function validateInboxEvent(event: BuzzEvent, workspace: string, targetScoped = false): void {
  if (
    !event ||
    !hex.test(event.id) ||
    !hex.test(event.pubkey) ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    !Number.isFinite(new Date(event.created_at * 1000).getTime()) ||
    typeof event.content !== "string" ||
    !Array.isArray(event.tags) ||
    event.tags.some(
      (tag) => !Array.isArray(tag) || tag.some((part) => typeof part !== "string"),
    ) ||
    (!targetScoped && (
      event.tags.filter((tag) => tag[0] === "h").length !== 1 ||
      !event.tags.some((tag) => tag[0] === "h" && tag[1] === workspace)
    ))
  ) {
    throw new Error("Unverifiable message scope");
  }
}

/** Thread auxiliary events use the same admitted target closure as windows. */
export function inboxReactionEvents(raw: unknown[], workspace: string): BuzzEvent[] {
  return raw.flatMap(value => {
    if (!value || typeof value !== "object" || !("kind" in value) || ![7,5,9005].includes(Number(value.kind))) return [];
    const event = value as BuzzEvent;
    validateInboxEvent(event,workspace,[7,5].includes(event.kind) && Array.isArray(event.tags) && !event.tags.some(tag=>tag[0]==="h"));
    return [event];
  });
}

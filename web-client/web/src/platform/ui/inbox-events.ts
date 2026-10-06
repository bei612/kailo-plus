import type { BuzzEvent } from "@/platform/bff-client";
export type Event = BuzzEvent & { createdAt: number; channelId: string; category: "mention" | "activity" };
export const hex = /^[0-9a-f]{64}$/;

/** The query is already scope-filtered by Core; mismatched/unverifiable data is never shown. */
export function inboxEvents(raw: unknown, workspace: string): Event[] {
  if (!Array.isArray(raw)) throw new Error("Invalid message page");
  return raw.map((value: unknown) => {
    const event = value as BuzzEvent;
    if (
      !event ||
      !hex.test(event.id) ||
      !hex.test(event.pubkey) ||
      event.kind !== 9 ||
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      !Number.isFinite(new Date(event.created_at * 1000).getTime()) ||
      typeof event.content !== "string" ||
      !Array.isArray(event.tags) ||
      event.tags.some(
        (tag) => !Array.isArray(tag) || tag.some((part) => typeof part !== "string"),
      ) ||
      event.tags.filter((tag) => tag[0] === "h").length !== 1 ||
      !event.tags.some((tag) => tag[0] === "h" && tag[1] === workspace)
    ) {
      throw new Error("Unverifiable message scope");
    }
    return { ...event, createdAt: event.created_at, channelId: workspace, category: "activity" };
  });
}

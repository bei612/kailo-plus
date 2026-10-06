import { verifyEvent, type Event } from "nostr-tools/pure";

// Buzz NIP-DV closed protocol kind, not a deployment setting.
export const DM_VISIBILITY_KIND = 30622;
export function hiddenConversationChannels(events: unknown, expected?: { relayPubkey: string; viewer: string }): ReadonlySet<string> {
  if (!Array.isArray(events) || events.length > 1) throw new Error("Invalid DM visibility snapshot");
  const hidden = new Set<string>();
  for (const raw of events) {
    const event = raw as Event;
    if (!event || event.kind !== DM_VISIBILITY_KIND || !verifyEvent(event)) throw new Error("Invalid DM visibility signature");
    if (expected && (event.pubkey !== expected.relayPubkey ||
      event.tags.filter((tag) => tag[0] === "p").length !== 1 ||
      event.tags.filter((tag) => tag[0] === "d").length !== 1 ||
      !event.tags.some((tag) => tag[0] === "p" && tag[1] === expected.viewer) ||
      !event.tags.some((tag) => tag[0] === "d" && tag[1] === expected.viewer)))
      throw new Error("DM visibility belongs to another identity");
    for (const tag of event.tags) {
      if (tag[0] === "h") {
        if (tag.length !== 2 || !tag[1]) throw new Error("Invalid DM visibility channel");
        hidden.add(tag[1]);
      }
    }
  }
  return hidden;
}

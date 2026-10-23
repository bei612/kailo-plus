// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/agentAddressMention.mjs and getVisibleAgentAddressPubkeys.ts.
// DD-148: `["mention", <pubkey>, "agent-address"]` marks the composer address-tray recipients that
// the message actually notified (`p`). It is display metadata only.
import { normalizePubkey } from "../conversations/pubkey";

export const AGENT_ADDRESS_MENTION_MARKER = "agent-address";

/** Original buildAgentAddressMentionTags: addressed ∩ delivered, deduplicated, in addressed order. */
export function buildAgentAddressMentionTags(addressedPubkeys: Iterable<string>, deliveredPubkeys: Iterable<string>): string[][] {
  const delivered = new Set([...deliveredPubkeys].map(normalizePubkey));
  return [...new Set([...addressedPubkeys].map(normalizePubkey))]
    .filter((pubkey) => pubkey && delivered.has(pubkey))
    .map((pubkey) => ["mention", pubkey, AGENT_ADDRESS_MENTION_MARKER]);
}

/** Original getAgentAddressMentionPubkeys: ordered, deduplicated recipients on an event. */
export function getAgentAddressMentionPubkeys(tags: readonly (readonly string[])[] | undefined): string[] {
  return [...new Set((tags ?? [])
    .filter((tag) => tag[0] === "mention" && tag[2] === AGENT_ADDRESS_MENTION_MARKER && Boolean(tag[1]))
    .map((tag) => normalizePubkey(tag[1]!)))];
}

/**
 * Original getVisibleAgentAddressPubkeys: tag-backed recipients stay visible unless the body
 * already mentions them inline (`@<label>`), so the prefix never repeats an inline mention.
 */
export function getVisibleAgentAddressPubkeys(body: string, addressedPubkeys: readonly string[],
  labelFor: (pubkey: string) => string | null): string[] {
  return addressedPubkeys.filter((pubkey) => {
    const label = labelFor(pubkey);
    return !label || !body.includes(`@${label}`);
  });
}

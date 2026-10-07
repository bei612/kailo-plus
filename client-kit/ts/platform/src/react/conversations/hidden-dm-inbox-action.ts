// Buzz 779af8886caae1317b4de962082429867ab61503 home/hiddenDmInboxAction.ts.
// Same existing-conversation reopen-before-navigation. Kailo resolves immutable
// participants from its admitted directory, never by creating another DM.
import type { ConversationView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import type { ConversationVisibilityHost } from "./use-conversation-state";
import { isOutcomeUnknown } from "../../transport";

export async function loadInboxConversations(client: Pick<BffClient, "conversations">, isCurrent: () => boolean): Promise<ConversationView[]> {
  const items = new Map<string, ConversationView>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (!isCurrent()) return [];
    const page = await client.conversations(cursor);
    if (!isCurrent()) return [];
    if (!Array.isArray(page.items)) throw new Error("Invalid Conversation directory");
    for (const item of page.items) {
      if (!item.id || !item.channelId || !Array.isArray(item.participantPrincipalIds)) throw new Error("Invalid Conversation binding");
      if (items.has(item.channelId)) throw new Error("Duplicate Conversation binding");
      items.set(item.channelId, item);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Conversation cursor did not advance");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...items.values()].filter(item => item.state === "ACTIVE");
}

export type HiddenDmInboxIntent = { publish?: () => Promise<void>; unknown?: boolean; confirmed?: boolean };
export async function reopenHiddenInboxConversation({ conversation, client, host, intent, isCurrent }: {
  conversation: ConversationView; client: Pick<BffClient, "conversations">;
  host: ConversationVisibilityHost; intent: HiddenDmInboxIntent; isCurrent: () => boolean;
}): Promise<ConversationView | null> {
  const admitted = async () => {
    const current = (await loadInboxConversations(client, isCurrent)).find(item => item.id === conversation.id);
    if (!isCurrent()) return null;
    if (!current || current.channelId !== conversation.channelId ||
        current.participantPrincipalIds.length !== conversation.participantPrincipalIds.length ||
        current.participantPrincipalIds.some(id => !conversation.participantPrincipalIds.includes(id))) {
      throw new Error("Conversation admission changed");
    }
    return current;
  };
  const current = await admitted();
  if (!current) return null;
  if (intent.confirmed) return current;
  const hidden = await host.read(current);
  if (!isCurrent()) return null;
  if (hidden.has(current.channelId)) {
    intent.publish ??= await host.prepare(current, false);
    if (!isCurrent()) return null;
    try { await intent.publish(); }
    catch (error) {
      intent.unknown ||= isOutcomeUnknown(error);
      if (!intent.unknown) delete intent.publish;
      throw error;
    }
    // Confirmed publication is never replayed because navigation later fails.
    delete intent.publish; delete intent.unknown; intent.confirmed = true;
  } else { delete intent.publish; delete intent.unknown; intent.confirmed = true; }
  if (!isCurrent()) return null;
  return admitted();
}

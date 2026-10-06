import { useCallback, useDeferredValue, useEffect, useRef, useState, type UIEvent } from "react";
import type { ActionCommand, ActionSubmission, ConversationParticipant, ConversationView } from "@client-kit/contracts";
import { useBffClient } from "../context";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown, TransportError } from "../../transport";
import { useConversationVisibilityHost, useConversationInvalidation } from "./use-conversation-state";

export function formatRecipientName(user: ConversationParticipant) { return user.displayName; }
export class ConversationPreparationPending extends Error {}

/** Read models are scoped to the authenticated BFF; no Relay identity registry is created. */
export function useConversationDirectory(currentPrincipalId: string) {
  const client = useBffClient();
  const [items, setItems] = useState<ConversationParticipant[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [maxParticipants, setMaxParticipants] = useState<number>();
  const [isDirectoryLoading, setLoading] = useState(true);
  const [searchError, setError] = useState<Error | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelected] = useState<ConversationParticipant[]>([]);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const busy = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async (cursor?: string) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    const epoch = generation.current;
    try {
      const page = await client.conversationParticipants(cursor);
      if (epoch !== generation.current) return;
      if (!Array.isArray(page.items) || !Number.isSafeInteger(page.maxParticipants) ||
          page.maxParticipants < 2 || page.items.some((item) =>
            !item.principalId || !Array.isArray(item.pubkeys) || item.pubkeys.length === 0))
        throw new TransportError("Recipient directory is unavailable.");
      setItems((old) => [...new Map([...(cursor ? old : []), ...page.items].map((item) => [item.principalId, item])).values()]);
      setMaxParticipants(page.maxParticipants); setNextCursor(page.nextCursor);
    } catch (error) {
      if (epoch === generation.current) setError(error instanceof Error ? error : new Error("Recipient directory is unavailable."));
    } finally {
      if (epoch === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [client]);
  useEffect(() => { void load(); return () => { generation.current++; busy.current = false; }; }, [load]);
  // Search traverses the server's bounded pages; no arbitrary client result cap.
  useEffect(() => { if (deferredSearchQuery && nextCursor && !busy.current && !searchError) void load(nextCursor); }, [deferredSearchQuery, nextCursor, isDirectoryLoading, load, searchError]);
  const hasReachedRecipientLimit = maxParticipants === undefined || selectedUsers.length + 1 >= maxParticipants;
  const searchResults = items.filter((item) => item.principalId !== currentPrincipalId &&
    [item.displayName, ...item.pubkeys].some((value) => value.toLocaleLowerCase().includes(deferredSearchQuery.toLocaleLowerCase())));
  const selectUser = (user: ConversationParticipant) => {
    if (hasReachedRecipientLimit || !items.some((item) => item.principalId === user.principalId)) return;
    setSelected((old) => old.some((item) => item.principalId === user.principalId) ? old : [...old, user]);
    setSearchQuery("");
  };
  const handleDirectoryScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight && nextCursor) void load(nextCursor);
  };
  return { items, maxParticipants, searchResults, searchQuery, deferredSearchQuery, setSearchQuery,
    selectedUsers, selectUser, removeUser: (id: string) => setSelected((old) => old.filter((item) => item.principalId !== id)),
    hasReachedRecipientLimit, isDirectoryLoading, searchError, handleDirectoryScroll, reload: () => load() };
}

export function useConversations() {
  const client = useBffClient();
  const invalidation = useConversationInvalidation();
  const [items, setItems] = useState<ConversationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const epoch = ++generation.current;
    setLoading(true); setError(null);
    try {
      const all: ConversationView[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.conversations(cursor);
        if (!Array.isArray(page.items)) throw new TransportError("Conversation list is unavailable.");
        all.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new TransportError("Conversation cursor did not advance.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (epoch === generation.current) setItems(all);
      return all;
    } catch (error) {
      if (epoch === generation.current) setError(error instanceof Error ? error : new Error("Conversation list is unavailable."));
      throw error;
    } finally { if (epoch === generation.current) setLoading(false); }
  }, [client]);
  useEffect(() => { void reload().catch(() => undefined); return () => { generation.current++; }; }, [reload, invalidation?.revision]);
  return { items, loading, error, reload };
}

/** A receipt freezes the participant set and idempotency key until native ACTIVE evidence exists. */
export function useConversationOpen(currentPrincipalId: string, recipients: ConversationParticipant[]) {
  const client = useBffClient();
  const visibility = useConversationVisibilityHost();
  const invalidation = useConversationInvalidation();
  const reopen = useRef<(() => Promise<void>) | null>(null);
  const intent = useRef<{ command: ActionCommand; receipt?: ActionSubmission } | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const prepareConversation = async (): Promise<ConversationView> => {
    if (inFlight.current) throw new ConversationPreparationPending("Opening direct message…");
    if (!currentPrincipalId || recipients.length === 0) throw new Error("Choose at least one recipient first.");
    inFlight.current = true; setBusy(true); setNotice(null);
    const ids = [currentPrincipalId, ...recipients.map((item) => item.principalId)].sort();
    intent.current ??= { command: { actionKey: "conversation.open", idempotencyKey: newIdempotencyKey(), conversationOpen: { participantPrincipalIds: ids } } };
    setLocked(true);
    try {
      if (!intent.current.receipt) {
        const receipt = await client.submitAction(intent.current.command);
        if (receipt.actionKey !== "conversation.open" || !receipt.operationId || !receipt.actionExecutionId)
          throw new TransportError("The direct message outcome is not yet known.");
        intent.current.receipt = receipt;
        if (["DENIED", "EXPIRED", "REVOKED"].includes(receipt.gateState)) {
          intent.current = null; setLocked(false);
          throw new Error(receipt.reason ?? "Direct message was not admitted.");
        }
      }
      const expected = intent.current.command.conversationOpen!.participantPrincipalIds;
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.conversations(cursor);
        const conversation = page.items.find((item) => item.participantPrincipalIds.length === expected.length &&
          item.participantPrincipalIds.every((id) => expected.includes(id)));
        if (conversation?.state === "ACTIVE") {
          if (!visibility) throw new Error("Conversation visibility is unavailable.");
          if (!reopen.current && (await visibility.read(conversation)).has(conversation.channelId))
            reopen.current = await visibility.prepare(conversation, false);
          if (reopen.current) {
            try { await reopen.current(); reopen.current = null; }
            catch (error) { if (!isOutcomeUnknown(error)) reopen.current = null; throw error; }
          }
          invalidation?.changed();
          return conversation;
        }
        if (conversation?.state === "DISABLED") throw new Error("This direct message is disabled.");
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new TransportError("Conversation cursor did not advance.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      const message = "Direct message is being prepared. Check its status and send again; your draft is retained.";
      setNotice(message); throw new ConversationPreparationPending(message);
    } catch (error) {
      if (!intent.current?.receipt && !isOutcomeUnknown(error)) { intent.current = null; setLocked(false); }
      if (isOutcomeUnknown(error)) setNotice("Outcome not yet known. Retry uses the same operation; your draft is retained.");
      throw error;
    } finally { inFlight.current = false; setBusy(false); }
  };
  return { prepareConversation, busy, locked, notice };
}

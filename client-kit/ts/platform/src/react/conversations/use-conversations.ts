import { translateCurrent as translateUi } from "../../i18n";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ActionCommand, ActionSubmission, ConversationParticipant, ConversationView } from "@client-kit/contracts";
import { useBffClient } from "../context";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown, TransportError } from "../../transport";
import { useConversationVisibilityHost, useConversationInvalidation } from "./use-conversation-state";
import { normalizePubkey } from "./pubkey";
import type { BffClient } from "../../client";

/** Complete, bounded BFF directory used by search and actual DM header consumers. */
export async function loadConversationPeople(client: BffClient, check: () => void): Promise<ConversationParticipant[]> {
  const result: ConversationParticipant[] = [];
  const cursors = new Set<string>();
  const owners = new Map<string, string>();
  const principals = new Set<string>();
  let cursor: string | undefined;
  do {
    check();
    const page = await client.conversationParticipants(cursor);
    check();
    if (!page || !Array.isArray(page.items)) throw new TransportError("Invalid conversation people directory");
    for (const person of page.items) {
      if (!person.principalId || principals.has(person.principalId) || typeof person.displayName !== "string" ||
          !Array.isArray(person.pubkeys) || person.pubkeys.length === 0)
        throw new TransportError("Invalid conversation person");
      principals.add(person.principalId);
      for (const pubkey of person.pubkeys) {
        if (!/^[0-9a-f]{64}$/.test(pubkey) || owners.has(pubkey)) throw new TransportError("Ambiguous conversation identity");
        owners.set(pubkey, person.principalId);
      }
      result.push(person);
    }
    cursor = page.nextCursor;
    if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursors.has(cursor)))
      throw new TransportError("Invalid conversation people cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return result;
}

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
        throw new TransportError(translateUi("dm.directoryUnavailable"));
      setItems((old) => [...new Map([...(cursor ? old : []), ...page.items].map((item) => [item.principalId, item])).values()]);
      setMaxParticipants(page.maxParticipants); setNextCursor(page.nextCursor);
    } catch (error) {
      if (epoch === generation.current) setError(error instanceof Error ? error : new Error(translateUi("dm.directoryUnavailable")));
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
        if (!Array.isArray(page.items)) throw new TransportError(translateUi("dm.listUnavailable"));
        all.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new TransportError("Conversation cursor did not advance.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (epoch === generation.current) setItems(all);
      return all;
    } catch (error) {
      if (epoch === generation.current) setError(error instanceof Error ? error : new Error(translateUi("dm.listUnavailable")));
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
  const scope = useMemo(() => ({
    active: true, inFlight: false, completed: false,
    reopen: null as (() => Promise<void>) | null,
    intent: null as { command: ActionCommand; receipt?: ActionSubmission } | null,
  }), [client, currentPrincipalId, visibility]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isCurrent = () => scope.active && currentScope.current === scope;
  const checkCurrent = () => {
    if (!isCurrent()) throw new Error(translateUi("dm.viewInactive"));
  };
  useEffect(() => {
    scope.active = true; setBusy(false); setLocked(false); setNotice(null);
    return () => { scope.active = false; };
  }, [scope]);
  const readPendingConversation = async (): Promise<ConversationView | undefined> => {
    const expected = scope.intent?.command.conversationOpen?.participantPrincipalIds;
    if (!expected) return undefined;
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      checkCurrent();
      const page = await client.conversations(cursor);
      checkCurrent();
      const conversation = page.items.find((item) => item.participantPrincipalIds.length === expected.length &&
        item.participantPrincipalIds.every((id) => expected.includes(id)));
      if (conversation) return conversation;
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new TransportError("Conversation cursor did not advance.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return undefined;
  };
  // Inspect the existing intent only. In particular, a lost action response must
  // not turn the status button into another conversation.open submission.
  const checkStatus = async (): Promise<void> => {
    if (!isCurrent() || scope.inFlight || !scope.intent) return;
    scope.inFlight = true; setBusy(true);
    try {
      const conversation = await readPendingConversation();
      if (conversation?.state === "ACTIVE") setNotice(null);
      else setNotice(translateUi(conversation?.state === "DISABLED" ? "dm.disabled" : "dm.preparationPending"));
    } catch (error) {
      if (isCurrent()) setNotice(isOutcomeUnknown(error) ? translateUi("dm.retryUnknown") : error instanceof Error ? error.message : translateUi("dm.unavailable"));
    } finally { scope.inFlight = false; if (isCurrent()) setBusy(false); }
  };
  const prepareConversation = async (selection = recipients): Promise<ConversationView> => {
    checkCurrent();
    if (scope.inFlight) throw new ConversationPreparationPending(translateUi("dm.preparing"));
    if (!currentPrincipalId || selection.length === 0) throw new Error(translateUi("dm.chooseFirst"));
    const ids = [currentPrincipalId, ...selection.map((item) => item.principalId)].sort();
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
      throw new TransportError(translateUi("dm.directoryUnavailable"));
    const expected = scope.intent?.command.conversationOpen?.participantPrincipalIds;
    if (expected && (expected.length !== ids.length || expected.some((id, index) => id !== ids[index]))) {
      // A different People target cannot replace an accepted or uncertain open.
      if (!scope.completed) throw new ConversationPreparationPending(translateUi("dm.preparationPending"));
      scope.intent = null; scope.reopen = null; scope.completed = false;
    }
    scope.inFlight = true; setBusy(true); setNotice(null);
    scope.intent ??= { command: { actionKey: "conversation.open", idempotencyKey: newIdempotencyKey(), conversationOpen: { participantPrincipalIds: ids } } };
    setLocked(true);
    try {
      if (!scope.intent.receipt) {
        const receipt = await client.submitAction(scope.intent.command);
        checkCurrent();
        if (receipt.actionKey !== "conversation.open" || !receipt.operationId || !receipt.actionExecutionId)
          throw new TransportError(translateUi("dm.unknown"));
        scope.intent.receipt = receipt;
        if (["DENIED", "EXPIRED", "REVOKED"].includes(receipt.gateState)) {
          scope.intent = null; setLocked(false);
          throw new Error(receipt.reason ?? translateUi("dm.denied"));
        }
      }
      const conversation = await readPendingConversation();
        if (conversation?.state === "ACTIVE") {
          if (!visibility) throw new Error(translateUi("dm.visibilityUnavailable"));
          const hidden = await visibility.read(conversation);
          checkCurrent();
          if (!scope.reopen && hidden.has(conversation.channelId)) {
            const publish = await visibility.prepare(conversation, false);
            checkCurrent();
            scope.reopen = publish;
          }
          if (scope.reopen && !hidden.has(conversation.channelId)) scope.reopen = null;
          if (scope.reopen) {
            try { await scope.reopen(); checkCurrent(); scope.reopen = null; }
            catch (error) { if (!isOutcomeUnknown(error)) scope.reopen = null; throw error; }
          }
          scope.completed = true;
          invalidation?.changed();
          return conversation;
        }
        if (conversation?.state === "DISABLED") throw new Error(translateUi("dm.disabled"));
      const message = translateUi("dm.preparationPending");
      setNotice(message); throw new ConversationPreparationPending(message);
    } catch (error) {
      if (isCurrent()) {
        if (!scope.intent?.receipt && !isOutcomeUnknown(error)) { scope.intent = null; setLocked(false); }
        if (isOutcomeUnknown(error)) setNotice(translateUi("dm.retryUnknown"));
      }
      throw error;
    } finally { scope.inFlight = false; if (isCurrent()) setBusy(false); }
  };
  return { prepareConversation, checkStatus, busy, locked, notice };
}

/** Original People/Profile open-DM action, using the same governed preparation as compose. */
export function useDirectMessageOpen(currentPrincipalId: string) {
  const client = useBffClient();
  const opening = useConversationOpen(currentPrincipalId, []);
  const scope = useMemo(() => ({ active: true, busy: false }), [client, currentPrincipalId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [resolving, setResolving] = useState(false);
  useEffect(() => { scope.active = true; setResolving(false); return () => { scope.active = false; }; }, [scope]);
  const open = async (pubkey: string): Promise<ConversationView> => {
    const checkCurrent = () => {
      if (!scope.active || currentScope.current !== scope) throw new Error(translateUi("dm.viewInactive"));
    };
    checkCurrent();
    if (scope.busy) throw new ConversationPreparationPending(translateUi("dm.preparing"));
    if (!currentPrincipalId) throw new Error(translateUi("dm.viewInactive"));
    scope.busy = true; setResolving(true);
    try {
      const session = await client.session();
      checkCurrent();
      if (session.tenantPrincipalId !== currentPrincipalId) throw new Error(translateUi("dm.viewInactive"));
      const target = normalizePubkey(pubkey);
      const matches = new Map<string, ConversationParticipant>();
      let cursor: string | undefined;
      let maxParticipants: number | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.conversationParticipants(cursor);
        checkCurrent();
        if (!Array.isArray(page.items) || !Number.isSafeInteger(page.maxParticipants) || page.maxParticipants < 2 ||
            (maxParticipants !== undefined && page.maxParticipants !== maxParticipants) || page.items.some((item) =>
              !item.principalId || !Array.isArray(item.pubkeys) || item.pubkeys.length === 0))
          throw new TransportError(translateUi("dm.directoryUnavailable"));
        maxParticipants = page.maxParticipants;
        for (const participant of page.items) {
          if (participant.pubkeys.some((key) => normalizePubkey(key) === target)) matches.set(participant.principalId, participant);
        }
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new TransportError(translateUi("dm.directoryUnavailable"));
        if (cursor) seen.add(cursor);
      } while (cursor);
      const [recipient] = matches.values();
      if (matches.size !== 1 || !recipient || recipient.principalId === currentPrincipalId)
        throw new TransportError(translateUi("dm.directoryUnavailable"));
      return await opening.prepareConversation([recipient]);
    } finally {
      scope.busy = false;
      if (scope.active && currentScope.current === scope) setResolving(false);
    }
  };
  return { ...opening, open, busy: resolving || opening.busy };
}

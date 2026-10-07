// Original useHiddenDmInboxNavigation pending/error/scope behavior, shared hosts.
import { useEffect, useRef, useState } from "react";
import type { ConversationView } from "@client-kit/contracts";
import { useBffClient, useUiT } from "../context";
import { useConversationInvalidation, useConversationVisibilityHost } from "./use-conversation-state";
import { reopenHiddenInboxConversation, type HiddenDmInboxIntent } from "./hidden-dm-inbox-action";
import { isOutcomeUnknown } from "../../transport";

export type InboxNavigationTarget = { channelId: string; messageId: string; threadRootId?: string | null; conversation?: ConversationView };
export function useHiddenDmInboxNavigation({ scopeKey, conversations, onOpenContext, onError }: {
  scopeKey: string; conversations: readonly ConversationView[];
  onOpenContext: (target: InboxNavigationTarget) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const client = useBffClient(); const host = useConversationVisibilityHost(); const invalidation = useConversationInvalidation(); const t = useUiT();
  const scope = useRef({ key: scopeKey, client, host, intents: new Map<string, HiddenDmInboxIntent>(), pending: new Set<string>(), errors: new Set<string>() });
  if (scope.current.key !== scopeKey || scope.current.client !== client || scope.current.host !== host)
    scope.current = { key: scopeKey, client, host, intents: new Map(), pending: new Set(), errors: new Set() };
  const [, render] = useState(0); const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const openContext = async (target: Omit<InboxNavigationTarget, "conversation">) => {
    const owner = scope.current; const isCurrent = () => mounted.current && scope.current === owner;
    if (owner.pending.has(target.channelId)) return;
    const conversation = conversations.find(item => item.channelId === target.channelId);
    owner.pending.add(target.channelId); owner.errors.delete(target.channelId); render(v => v + 1);
    try {
      if (!conversation) { if (isCurrent()) await onOpenContext(target); return; }
      if (!host) throw new Error("Conversation visibility unavailable");
      let intent = owner.intents.get(conversation.id);
      if (!intent) { intent = {}; owner.intents.set(conversation.id, intent); }
      const reopened = await reopenHiddenInboxConversation({ conversation, client, host, intent, isCurrent });
      if (!reopened || !isCurrent()) return;
      invalidation?.changed();
      await onOpenContext({ ...target, conversation: reopened });
      owner.intents.delete(conversation.id);
    } catch (error) {
      if (isCurrent()) { owner.errors.add(target.channelId); onError(t(isOutcomeUnknown(error) ? "dm.retryUnknown" : "dm.unavailable")); }
    } finally { owner.pending.delete(target.channelId); if (isCurrent()) render(v => v + 1); }
  };
  return { openContext, isReopenPending: (id: string) => scope.current.pending.has(id), isReopenErrored: (id: string) => scope.current.errors.has(id),
    isReopenUnknown: (id: string) => { const conversation = conversations.find(item => item.channelId === id); return Boolean(conversation && scope.current.intents.get(conversation.id)?.unknown); } };
}

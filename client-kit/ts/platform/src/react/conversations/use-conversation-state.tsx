import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConversationView } from "@client-kit/contracts";
import { checkedUserState, type CollaborationUserState } from "../../inbox";
import { isOutcomeUnknown, TransportError } from "../../transport";
import { useBffClient } from "../context";

/** Web uses Core SERVER signing; Native supplies its existing CLIENT Relay publisher. */
export type ConversationVisibilityHost = {
  read: (conversation: ConversationView) => Promise<ReadonlySet<string>>;
  prepare: (conversation: ConversationView, hidden: boolean) => Promise<() => Promise<void>>;
};
const VisibilityContext = createContext<{host: ConversationVisibilityHost; revision: number; changed: () => void} | null>(null);
export function ConversationVisibilityProvider({value, children}: {value: ConversationVisibilityHost; children: ReactNode}) {
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((old) => old + 1), []);
  const context = useMemo(() => ({host: value, revision, changed}), [value, revision, changed]);
  return <VisibilityContext.Provider value={context}>{children}</VisibilityContext.Provider>;
}
export function useConversationVisibilityHost() { return useContext(VisibilityContext)?.host ?? null; }
export function useConversationInvalidation() { return useContext(VisibilityContext); }

/** Only read projections live here. Core CAS and original NIP-DV remain the authorities. */
export function useConversationState(items: ConversationView[]) {
  const client = useBffClient();
  const host = useConversationVisibilityHost();
  const invalidation = useConversationInvalidation();
  const [state, setState] = useState<CollaborationUserState | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const epoch = useRef(0);
  const busy = useRef(false);
  const intent = useRef<(() => Promise<void>) | null>(null);
  const preferenceVersion = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    setState(null); setHidden(null); setFailed(false);
    try {
      const next = checkedUserState(await client.collaborationUserState());
      // Old servers cannot authorize private-conversation preferences.
      if (!next.conversationPreferences || !host) throw new Error("Conversation state is unavailable");
      const first = items.find((item) => item.state === "ACTIVE");
      const visibility = first ? await host.read(first) : new Set<string>();
      if (generation !== epoch.current) return;
      // Same Core CAS rule as useInboxState: a higher version fences an old
      // uncertain write. Display current authority, never replay over it.
      if (preferenceVersion.current !== null && next.version > preferenceVersion.current) {
        intent.current = null; preferenceVersion.current = null; setUnknown(false);
      }
      setState(next); setHidden(visibility);
      return next;
    } catch {
      if (generation === epoch.current) setFailed(true);
    }
  }, [client, host, items]);
  useEffect(() => {
    void refresh();
    const focus = () => { if (!busy.current) void refresh(); };
    window.addEventListener("focus", focus);
    return () => { epoch.current++; window.removeEventListener("focus", focus); };
  }, [refresh, invalidation?.revision]);
  const run = async (prepare?: () => Promise<() => Promise<void>>) => {
    if (busy.current || (prepare && intent.current)) return;
    busy.current = true; setPending(true); setFailed(false);
    const generation = epoch.current;
    try {
      if (!intent.current && prepare) intent.current = await prepare();
      if (generation !== epoch.current) return;
      await intent.current?.();
      if (generation !== epoch.current) return;
      intent.current = null; preferenceVersion.current = null; setUnknown(false);
      await refresh();
      invalidation?.changed();
    } catch (error) {
      if (generation !== epoch.current) return;
      if (!isOutcomeUnknown(error)) { intent.current = null; preferenceVersion.current = null; }
      setUnknown(intent.current !== null);
      setFailed(intent.current === null);
    } finally { busy.current = false; setPending(false); }
  };
  const preferences = state?.conversationPreferences ?? {};
  const canWrite = state !== null && hidden !== null && !pending && !unknown;
  return { preferences, hidden, pending, failed, unknown, refresh,
    ready: state !== null && hidden !== null,
    retry: async () => {
      if (busy.current) return;
      if (preferenceVersion.current !== null) {
        const observed = await refresh();
        if (!observed) return;
        if (!intent.current) { invalidation?.changed(); return; }
      }
      if (intent.current) await run(); else await refresh();
    },
    preference: (id: string, change: {starred?: boolean; muted?: boolean}) => {
      if (!canWrite || !state) return;
      const body = { starred: preferences[id]?.starred ?? false, muted: preferences[id]?.muted ?? false,
        ...change, version: state.version };
      void run(async () => {
        preferenceVersion.current = body.version;
        return async () => {
          const result = await client.setConversationPreference(id, body);
          if (result.version !== body.version + 1) throw new TransportError("Invalid user-state CAS response");
        };
      });
    },
    hide: (conversation: ConversationView) => {
      if (!canWrite || !host) return;
      void run(() => host.prepare(conversation, true));
    }, canWrite,
  };
}

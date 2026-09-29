import {
  readStoredReadState,
  writeStoredReadState,
} from "@/features/channels/readState/readStateStorage";

const LOCAL_PERSIST_MAX_WAIT_MS = 1_000;

export type ContextParentResolver = (contextId: string) => string | null;

/**
 * NIP-RS Hierarchical Frontier Rule:
 * `effective(ctx) = max(merged[ctx], effective(parent(ctx)))`.
 *
 * The thread→channel relationship is derived from the event graph at
 * evaluation time via `parentResolver`. When the resolver yields no parent
 * (channels, or an unresolvable thread root), the frontier degrades to the
 * context's own value alone. Returns null when the context has never been read
 * and no parent term covers it.
 */
export function resolveEffectiveTimestamp(args: {
  effectiveState: Map<string, number>;
  contextId: string;
  parentResolver: ContextParentResolver | null;
}): number | null {
  const { effectiveState, contextId, parentResolver } = args;
  const own = effectiveState.get(contextId) ?? null;

  const parentId = parentResolver?.(contextId) ?? null;
  if (parentId === null) return own;

  const parent = effectiveState.get(parentId) ?? null;
  if (parent === null) return own;
  if (own === null) return parent;
  return Math.max(own, parent);
}

/**
 * Per-identity read markers (channels, threads, and individual messages),
 * persisted to localStorage. Markers are monotonic: a context only ever
 * advances.
 */
export class ReadStateManager {
  private pubkey: string;
  private effectiveState = new Map<string, number>();
  private localPersistTimer: number | null = null;
  private listeners = new Set<() => void>();
  private destroyed = false;
  private parentResolver: ContextParentResolver | null = null;

  constructor(pubkey: string) {
    this.pubkey = pubkey;
    window.addEventListener("pagehide", this.flushLocalState);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.hydrateFromLocalStorage();
  }

  markContextRead(contextId: string, unixTimestamp: number): void {
    if (this.destroyed) return;
    const current = this.effectiveState.get(contextId) ?? 0;
    if (unixTimestamp <= current) return;

    this.effectiveState.set(contextId, unixTimestamp);
    this.persistLocalState();
    this.notifyListeners();
  }

  getEffectiveTimestamp(contextId: string): number | null {
    return resolveEffectiveTimestamp({
      effectiveState: this.effectiveState,
      contextId,
      parentResolver: this.parentResolver,
    });
  }

  /**
   * The context's OWN read marker, WITHOUT the hierarchical parent term.
   * Callers that evaluate a `thread:<root>` context outside the active channel
   * (e.g. the sidebar unread scan over background channels) must use this:
   * getEffectiveTimestamp folds in parentResolver, which is installed by the
   * active ChannelScreen and maps every thread to the *active* channel — using
   * it for a background channel's thread would borrow the wrong channel marker.
   */
  getOwnTimestamp(contextId: string): number | null {
    return this.effectiveState.get(contextId) ?? null;
  }

  /**
   * Inject the thread→channel parent resolver derived from the React event
   * graph. The hierarchical max in getEffectiveTimestamp is a no-op until
   * this is set.
   */
  setContextParentResolver(resolver: ContextParentResolver | null): void {
    this.parentResolver = resolver;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.flushLocalState();
    this.destroyed = true;
    window.removeEventListener("pagehide", this.flushLocalState);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.listeners.clear();
  }

  private hydrateFromLocalStorage(): void {
    for (const [contextId, timestamp] of readStoredReadState(this.pubkey)) {
      this.effectiveState.set(contextId, timestamp);
    }
    this.writeLocalState();
  }

  private persistLocalState(): void {
    if (this.destroyed || this.localPersistTimer !== null) return;

    this.localPersistTimer = window.setTimeout(() => {
      this.localPersistTimer = null;
      this.writeLocalState();
    }, LOCAL_PERSIST_MAX_WAIT_MS);
  }

  private readonly flushLocalState = (): void => {
    if (this.localPersistTimer === null) return;

    window.clearTimeout(this.localPersistTimer);
    this.localPersistTimer = null;
    this.writeLocalState();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.flushLocalState();
    }
  };

  private writeLocalState(): void {
    writeStoredReadState(this.pubkey, this.effectiveState);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // Don't let a broken listener break the manager
        console.debug("[ReadStateManager] listener threw:", error);
      }
    }
  }
}

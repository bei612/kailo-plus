import * as React from "react";
import {
  ReadStateManager,
  type ContextParentResolver,
} from "@/features/channels/readState/readStateManager";

const noopGetTimestamp = () => null;
const noopMarkRead = () => {};
const noopSetResolver = () => {};

/**
 * React hook that creates and manages a ReadStateManager instance.
 * Returns no-op functions until a pubkey is available.
 */
export function useReadState(pubkey: string | undefined) {
  const [readStateVersion, forceUpdate] = React.useReducer(
    (x: number) => x + 1,
    0,
  );
  const [readyPubkey, setReadyPubkey] = React.useState<string | null>(null);
  const managerRef = React.useRef<ReadStateManager | null>(null);

  React.useEffect(() => {
    setReadyPubkey(null);
    if (!pubkey) return;

    const manager = new ReadStateManager(pubkey);
    managerRef.current = manager;
    const unsubscribe = manager.subscribe(() => {
      forceUpdate();
    });
    setReadyPubkey(pubkey);

    return () => {
      unsubscribe();
      manager.destroy();
      managerRef.current = null;
    };
  }, [pubkey]);

  const getEffectiveTimestamp = React.useCallback(
    (contextId: string): number | null => {
      return managerRef.current?.getEffectiveTimestamp(contextId) ?? null;
    },
    [],
  );

  const getOwnTimestamp = React.useCallback(
    (contextId: string): number | null => {
      return managerRef.current?.getOwnTimestamp(contextId) ?? null;
    },
    [],
  );

  const markContextRead = React.useCallback(
    (contextId: string, unixTimestamp: number): void => {
      managerRef.current?.markContextRead(contextId, unixTimestamp);
    },
    [],
  );

  const setContextParentResolver = React.useCallback(
    (resolver: ContextParentResolver | null): void => {
      managerRef.current?.setContextParentResolver(resolver);
    },
    [],
  );

  if (!pubkey) {
    return {
      getEffectiveTimestamp: noopGetTimestamp,
      isReady: false,
      markContextRead: noopMarkRead,
      setContextParentResolver: noopSetResolver,
      readStateVersion: 0,
      getOwnTimestamp: noopGetTimestamp,
    };
  }

  return {
    getEffectiveTimestamp,
    isReady: readyPubkey === pubkey,
    markContextRead,
    setContextParentResolver,
    readStateVersion,
    getOwnTimestamp,
  };
}

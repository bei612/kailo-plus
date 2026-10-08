import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getUserConfig } from '@/utils/env';
import { queryReceiptState } from '@/utils/queryReceipt';

// Retain only the original observation key and cache-refresh choice. SQL and
// result bodies remain in the native service, not browser persistence.
export default function useDashboardQuery(
  itemId: number,
  submit: (identity: {
    idempotencyKey?: string;
    idempotencyScope?: string;
    refresh: boolean;
  }) => Promise<any>,
) {
  const generation = useRef(0);
  const currentItem = useRef(itemId);
  currentItem.current = itemId;
  const observed = useRef<{
    itemId: number;
    scope?: string;
    intent?: { key: string; refresh: boolean };
  }>();
  const [value, setValue] = useState<any>();
  const [receipt, setReceipt] = useState<any>();
  const [preparing, setPreparing] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [transportUnknown, setTransportUnknown] = useState(false);
  useEffect(() => {
    const invalidate = () => {
      ++generation.current;
      setValue(undefined);
      setReceipt(undefined);
      setPreparing(false);
      setScopeError(false);
      setStorageError(false);
      setTransportUnknown(false);
    };
    const resume = () => {
      invalidate();
      void preview(false, true);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    invalidate();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++generation.current;
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [itemId]);
  const preview = async (refresh = false, resume = false) => {
    const previous = resume ? observed.current : undefined;
    const revision = ++generation.current;
    setValue(undefined);
    setReceipt(undefined);
    setPreparing(true);
    setStorageError(false);
    setTransportUnknown(false);
    let scope: string | undefined;
    try {
      scope = (await getUserConfig()).queryScope;
      if (revision !== generation.current || currentItem.current !== itemId)
        return;
      if (scope !== undefined && !/^[a-f0-9]{64}$/.test(scope))
        throw new Error('Query identity unavailable');
      if (previous && (previous.itemId !== itemId || previous.scope !== scope))
        throw new Error('Query identity changed');
      setScopeError(false);
    } catch {
      if (revision === generation.current) {
        setScopeError(true);
        setPreparing(false);
      }
      return;
    }
    const slot = `kailo.query.dashboard.${scope}.${itemId}`;
    let intent: { key: string; refresh: boolean } | undefined;
    if (scope !== undefined) {
      try {
        const stored = sessionStorage.getItem(slot);
        intent =
          previous?.intent ??
          (stored ? JSON.parse(stored) : { key: uuidv4(), refresh });
        if (
          !intent ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            intent.key,
          ) ||
          typeof intent.refresh !== 'boolean'
        )
          throw new Error('Query identifier unavailable');
        // Re-observe the settled key too: returning to the window must not
        // turn a retired UI storage entry into a new SQL execution.
        if (!previous) sessionStorage.setItem(slot, JSON.stringify(intent));
        setStorageError(false);
      } catch {
        setStorageError(true);
        setPreparing(false);
        return;
      }
    }
    observed.current = { itemId, scope, intent };
    try {
      const result = await submit({
        idempotencyKey: intent?.key,
        idempotencyScope: scope,
        refresh: intent?.refresh ?? refresh,
      });
      const afterScope = (await getUserConfig()).queryScope;
      if (revision !== generation.current || currentItem.current !== itemId)
        return;
      if (scope !== afterScope) {
        setScopeError(true);
        return;
      }
      // Missing scope never bypasses the server: a configured/invalid binding
      // refuses the call. Only the actual standalone response has no receipt.
      if (scope === undefined && result && result.queryReceipt === undefined) {
        setValue({ itemId, result });
        return;
      }
      const received = result?.queryReceipt;
      const state = queryReceiptState(received);
      let selection: any;
      try {
        selection = JSON.parse(received?.inputReference?.nativeObjectRef);
      } catch {}
      if (
        !scope ||
        received?.previewScope !== scope ||
        received?.itemId !== itemId ||
        received?.submission?.actionKey !== 'data_query.query@v1' ||
        typeof selection?.historyId !== 'string' ||
        selection?.cache?.refresh !== intent?.refresh ||
        !state.valid
      ) {
        setTransportUnknown(true);
        return;
      }
      setReceipt({ itemId, received });
      if (state.completed) setValue({ itemId, result });
      if (state.terminal || state.denied) {
        if (sessionStorage.getItem(slot) === JSON.stringify(intent))
          sessionStorage.removeItem(slot);
      }
    } catch {
      if (revision === generation.current) setTransportUnknown(true);
    } finally {
      if (revision === generation.current) setPreparing(false);
    }
  };
  return {
    preview,
    value: value?.itemId === itemId ? value.result : undefined,
    state: queryReceiptState(
      receipt?.itemId === itemId ? receipt.received : undefined,
    ),
    preparing,
    scopeError,
    storageError,
    transportUnknown,
  };
}

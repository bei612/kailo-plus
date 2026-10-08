import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getUserConfig } from '@/utils/env';
import { queryReceiptState } from '@/utils/queryReceipt';

const matchesSelection = (
  kind: 'view' | 'model' | 'response',
  id: number,
  scope: string | undefined,
  receipt: any,
) => {
  try {
    const selection = JSON.parse(receipt?.inputReference?.nativeObjectRef);
    if (!scope || receipt?.previewScope !== scope) return false;
    if (kind === 'response')
      return (
        receipt?.responseId === id &&
        Number.isSafeInteger(receipt?.viewId) &&
        receipt.viewId > 0 &&
        selection.viewId === receipt.viewId &&
        !('modelId' in selection)
      );
    return (
      selection[kind === 'model' ? 'modelId' : 'viewId'] === id &&
      !((kind === 'model' ? 'viewId' : 'modelId') in selection)
    );
  } catch {
    return false;
  }
};

// Original native preview controls use the same existing HUMAN action.
// Only an opaque retry key is stored; SQL, credentials and results stay native.
export default function useGovernedPreview(
  kind: 'view' | 'model' | 'response',
  id: number,
  submit: (where: {
    id: number;
    idempotencyKey: string;
    idempotencyScope: string;
  }) => Promise<any>,
  receipt: any,
  error: any,
) {
  const [previewScope, setPreviewScope] = useState<string>();
  const sequence = useRef(0);
  const submittedScope = useRef<string>();
  const [scopeError, setScopeError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const readScope = async () => {
    const revision = ++sequence.current;
    const { queryScope } = await getUserConfig();
    if (
      revision !== sequence.current ||
      typeof queryScope !== 'string' ||
      !/^[a-f0-9]{64}$/.test(queryScope)
    )
      throw new Error('Query identity unavailable');
    return queryScope;
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setPreviewScope(undefined);
      try {
        const scope = await readScope();
        if (active) {
          setPreviewScope(scope);
          setScopeError(false);
        }
      } catch {
        if (active) {
          setPreviewScope(undefined);
          setScopeError(true);
        }
      }
    };
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      sequence.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [kind, id]);

  const preview = async () => {
    setPreparing(true);
    setPreviewScope(undefined);
    let scope: string;
    try {
      scope = await readScope();
      setPreviewScope(scope);
      setScopeError(false);
    } catch {
      setPreviewScope(undefined);
      setScopeError(true);
      setPreparing(false);
      return;
    }
    const slot = `kailo.query.${kind}.${scope}.${id}`;
    let key: string;
    try {
      key = sessionStorage.getItem(slot) || uuidv4();
      sessionStorage.setItem(slot, key);
    } catch {
      setStorageError(true);
      setPreparing(false);
      return;
    }
    setStorageError(false);
    setPreparing(false);
    submittedScope.current = scope;
    try {
      const result = await submit({
        id,
        idempotencyKey: key,
        idempotencyScope: scope,
      });
      const state = queryReceiptState(result);
      if (
        matchesSelection(kind, id, scope, result) &&
        (state.terminal || state.denied)
      ) {
        if (sessionStorage.getItem(slot) === key)
          sessionStorage.removeItem(slot);
      }
    } catch {
      /* UNKNOWN keeps the original key; retry observes that action. */
    }
  };

  const selectedReceipt = useMemo(() => {
    return matchesSelection(kind, id, previewScope, receipt)
      ? receipt
      : undefined;
  }, [receipt, previewScope, kind, id]);
  const state = queryReceiptState(selectedReceipt);
  const currentError =
    submittedScope.current === previewScope ? error : undefined;
  const currentReceipt = useMemo(() => {
    if (!state.valid || currentError) return undefined;
    // Even a known RUNNING receipt cannot carry an earlier result into a new
    // pending/unknown observation. Native rows need the verified close state.
    if (!state.completed && selectedReceipt.data !== undefined)
      return { ...selectedReceipt, data: undefined };
    return selectedReceipt;
  }, [selectedReceipt, state.valid, state.completed, currentError]);
  return {
    preview,
    preparing,
    scopeError,
    storageError,
    receipt: currentReceipt,
    pending: state.pending || !!currentError,
    completed: state.completed && !currentError,
    ended: state.ended && !currentError,
    denied: state.denied && !currentError,
    error: currentError,
  };
}

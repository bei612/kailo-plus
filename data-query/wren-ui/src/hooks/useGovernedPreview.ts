import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
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
        ((Number.isSafeInteger(receipt?.viewId) &&
          receipt.viewId > 0 &&
          selection.viewId === receipt.viewId &&
          !('modelId' in selection)) ||
          (receipt.viewId === undefined &&
            typeof selection.historyId === 'string' &&
            uuidValidate(selection.historyId) &&
            (!queryReceiptState(receipt).completed ||
              (receipt.nativeType === 'wren.api_history' &&
                receipt.nativeId === selection.historyId)) &&
            'modelId' in selection !== 'viewId' in selection))
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
    idempotencyKey?: string;
    idempotencyScope?: string;
  }) => Promise<any>,
  receipt: any,
  error: any,
) {
  const [previewScope, setPreviewScope] = useState<string>();
  const sequence = useRef(0);
  const selected = useRef({ kind, id });
  selected.current = { kind, id };
  const submitted = useRef<{
    selection: { kind: typeof kind; id: number };
    scope: string | undefined;
    revision: number;
  }>();
  const [scopeError, setScopeError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [independentData, setIndependentData] = useState<{
    kind: 'view' | 'model' | 'response';
    id: number;
    data: any;
  } | null>(null);
  const readScope = async () => {
    const revision = ++sequence.current;
    const config = await getUserConfig();
    if (
      revision === sequence.current &&
      config.nativeBindingConfigured === false
    )
      return undefined;
    const { queryScope } = config;
    if (
      revision !== sequence.current ||
      config.nativeBindingConfigured !== true ||
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
      setIndependentData(null);
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
    setIndependentData(null);
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
    if (scope === undefined) {
      submitted.current = {
        selection: { kind, id },
        scope,
        revision: sequence.current,
      };
      const current = sequence.current;
      try {
        const result = await submit({ id });
        const after = await getUserConfig();
        if (
          current !== sequence.current ||
          selected.current.kind !== kind ||
          selected.current.id !== id
        )
          return;
        if (after.nativeBindingConfigured !== false) {
          setScopeError(true);
          return;
        }
        if (Array.isArray(result?.columns) && Array.isArray(result?.data))
          setIndependentData({ kind, id, data: result });
      } catch {
        // Independent native errors retain the original mutation error.
      } finally {
        if (current === sequence.current) setPreparing(false);
      }
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
    submitted.current = {
      selection: { kind, id },
      scope,
      revision: sequence.current,
    };
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
    submitted.current?.scope === previewScope &&
    submitted.current?.revision === sequence.current &&
    submitted.current?.selection.kind === kind &&
    submitted.current?.selection.id === id
      ? error
      : undefined;
  const currentReceipt = useMemo(() => {
    if (!state.valid || currentError) return undefined;
    // Even a known RUNNING receipt cannot carry an earlier result into a new
    // pending/unknown observation. Native rows need the verified close state.
    if (!state.completed && selectedReceipt.data !== undefined)
      return { ...selectedReceipt, data: undefined };
    return selectedReceipt;
  }, [selectedReceipt, state.valid, state.completed, currentError]);
  const independent =
    independentData?.kind === kind && independentData.id === id
      ? independentData.data
      : undefined;
  return {
    preview,
    preparing,
    scopeError,
    storageError,
    receipt: currentReceipt,
    // Independent native rows are not a fabricated platform receipt.
    data: independent ?? currentReceipt?.data,
    governed: previewScope !== undefined,
    pending: state.pending || (previewScope !== undefined && !!currentError),
    completed: (state.completed || !!independent) && !currentError,
    ended: state.ended && !currentError,
    denied: state.denied && !currentError,
    error: currentError,
  };
}

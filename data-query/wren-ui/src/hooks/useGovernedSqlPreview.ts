import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import {
  usePreviewSqlMutation,
  PreviewSqlMutationVariables,
} from '@/apollo/client/graphql/sql.generated';
import { getUserConfig } from '@/utils/env';
import { queryReceiptState } from '@/utils/queryReceipt';

// The three original SQL editors share the existing mutation. The durable
// slot contains only opaque identifiers, never SQL, credentials or results.
export default function useGovernedSqlPreview(sql: string, visible: boolean) {
  const [mutate, original] = usePreviewSqlMutation();
  const [receipt, setReceipt] = useState<any>();
  const [scopeError, setScopeError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const currentSql = useRef(sql);
  currentSql.current = sql;
  const currentVisibility = useRef(visible);
  currentVisibility.current = visible;
  const selected = useRef<{ sql: string; scope: string }>();
  const validation = useRef<{
    sql: string;
    scope: string;
    idempotencyKey: string;
  }>();
  const revision = useRef(0);
  useEffect(() => {
    const refresh = async () => {
      const current = ++revision.current;
      validation.current = undefined;
      setReceipt(undefined);
      setPreparing(false);
      try {
        const scope = (await getUserConfig()).queryScope;
        if (current === revision.current)
          setScopeError(
            !/^[a-f0-9]{64}$/.test(scope) ||
              (selected.current !== undefined &&
                selected.current.scope !== scope),
          );
      } catch {
        if (current === revision.current) setScopeError(true);
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++revision.current;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const preview = async (options: {
    variables: PreviewSqlMutationVariables;
  }) => {
    if (!currentVisibility.current) return false;
    const current = ++revision.current;
    validation.current = undefined;
    setPreparing(true);
    setReceipt(undefined);
    const input = options.variables.data;
    let scope: string;
    try {
      scope = (await getUserConfig()).queryScope;
      if (current !== revision.current || !currentVisibility.current)
        return false;
      if (!/^[a-f0-9]{64}$/.test(scope) || currentSql.current !== input.sql)
        throw new Error('Query identity unavailable');
      setScopeError(false);
    } catch {
      if (current === revision.current) {
        setScopeError(true);
        setPreparing(false);
      }
      return false;
    }
    // UUID v5 is only a native browser slot name. The server compares the
    // complete SQL/deployment intent and does not authorize from this digest.
    const intent = uuidv5(
      JSON.stringify([input.sql, input.projectId, input.limit, !!input.dryRun]),
      uuidv5(scope, uuidv5.URL),
    );
    const slot = `kailo.query.sql.${scope}.${intent}`;
    let key: string;
    try {
      key = sessionStorage.getItem(slot) || uuidv4();
      sessionStorage.setItem(slot, key);
      setStorageError(false);
    } catch {
      setStorageError(true);
      setPreparing(false);
      return false;
    }
    selected.current = { sql: input.sql, scope };
    try {
      const result = await mutate({
        variables: {
          data: { ...input, idempotencyKey: key, idempotencyScope: scope },
        },
      });
      const afterScope = (await getUserConfig()).queryScope;
      if (current !== revision.current || !currentVisibility.current)
        return false;
      if (afterScope !== scope || currentSql.current !== input.sql) {
        setScopeError(true);
        return false;
      }
      const value = result.data?.previewSql;
      const state = queryReceiptState(value);
      let selection: any;
      try {
        selection = JSON.parse(value?.inputReference?.nativeObjectRef);
      } catch {
        /* Malformed evidence remains pending and retains the key. */
      }
      if (
        !state.valid ||
        value.previewScope !== scope ||
        value.submission.actionKey !==
          (input.dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1') ||
        typeof selection?.historyId !== 'string' ||
        selection.limit !== input.limit
      ) {
        setReceipt({});
        return false;
      }
      if (
        state.completed &&
        (input.dryRun
          ? value.data?.valid !== true
          : !Array.isArray(value.data?.columns) ||
            !Array.isArray(value.data?.data))
      ) {
        setReceipt({});
        return false;
      }
      setReceipt(value);
      if (state.completed && input.dryRun && input.limit === 1)
        validation.current = { sql: input.sql, scope, idempotencyKey: key };
      if (state.terminal || state.denied) {
        if (sessionStorage.getItem(slot) === key)
          sessionStorage.removeItem(slot);
      }
      return state.completed;
    } catch {
      // Neither a transport exception nor lost storage acknowledgement proves
      // that the admitted native query did not execute. Keep its original key.
      if (current === revision.current) setReceipt({});
      return false;
    } finally {
      if (current === revision.current) setPreparing(false);
    }
  };
  const current = selected.current?.sql === sql ? receipt : undefined;
  const state = queryReceiptState(current);
  const result = {
    ...original,
    // A mutation/transport error cannot settle an admitted native query. The
    // verified receipt, not Apollo's last error, controls terminal rendering.
    error: undefined,
    loading: original.loading || preparing,
    data: state.completed ? { previewSql: current.data } : undefined,
    reset: () => {
      ++revision.current;
      validation.current = undefined;
      original.reset();
      setReceipt(undefined);
      setPreparing(false);
    },
  };
  return {
    preview,
    result,
    state,
    scopeError,
    storageError,
    // This is the original completed dry-run's opaque identity, not a new
    // permission ticket. The native mutation observes and rechecks that AE.
    validatedSql: () => {
      const current = validation.current;
      if (
        current &&
        currentVisibility.current &&
        current.sql === currentSql.current &&
        selected.current?.scope === current.scope
      )
        return {
          idempotencyKey: current.idempotencyKey,
          idempotencyScope: current.scope,
        };
      return undefined;
    },
  };
}

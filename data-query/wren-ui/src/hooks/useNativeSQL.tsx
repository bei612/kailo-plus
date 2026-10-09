import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { message } from 'antd';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { useGetNativeSqlLazyQuery } from '@/apollo/client/graphql/home.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { getUserConfig } from '@/utils/env';
import errorHandler from '@/utils/errorHandler';
import { getQueryPreviewText } from '@/utils/language';

export interface NativeSQLResult {
  data: string;
  dataSourceType: DataSourceName;
  hasNativeSQL: boolean;
  loading: boolean;
  nativeSQLMode: boolean;
  setNativeSQLMode: (value: boolean) => void;
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo() {
  const { data: settingsQueryResult } = useGetSettingsQuery();
  const settings = settingsQueryResult?.settings;
  const dataSourceType = settings?.dataSource.type;
  const sampleDataset = settings?.dataSource.sampleDataset;

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    dataSourceType,
  };
}

export default function useNativeSQL(responseId: number) {
  const nativeSQLInfo = useNativeSQLInfo();
  const text = getQueryPreviewText(useRouter().locale);

  const [nativeSQLMode, setMode] = useState<boolean>(false);
  const mode = useRef(false);
  const sequence = useRef(0);
  const selectionIdentity = useRef<{ value: string | undefined }>();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ responseId: number; value: string }>();
  const [readNativeSQL] = useGetNativeSqlLazyQuery({
    fetchPolicy: 'no-cache',
  });
  const readIdentity = async () => {
    const config = await getUserConfig();
    if (config.nativeBindingConfigured === false) return undefined;
    if (
      config.nativeBindingConfigured !== true ||
      !/^[a-f0-9]{64}$/.test(config.queryScope ?? '') ||
      !Number.isSafeInteger(config.nativeBindingGeneration) ||
      config.nativeBindingGeneration <= 0
    )
      throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
    return {
      queryScope: config.queryScope,
      generation: config.nativeBindingGeneration,
    };
  };
  const detach = () => {
    sequence.current += 1;
    setData(undefined);
    setLoading(false);
  };
  const setNativeSQLMode = (value: boolean) => {
    mode.current = value;
    setMode(value);
    if (!value) detach();
  };
  const fetchNativeSQL = async () => {
    const request = ++sequence.current;
    const active = () => request === sequence.current && mode.current;
    let independent = false;
    setData(undefined);
    setLoading(true);
    try {
      const identity = await readIdentity();
      independent = identity === undefined;
      if (!active()) return;
      const value = JSON.stringify(identity);
      if (
        selectionIdentity.current &&
        selectionIdentity.current.value !== value
      )
        throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
      selectionIdentity.current = { value };
      const result = await readNativeSQL({
        variables: { responseId, ...identity },
      });
      if (!active()) return;
      if (JSON.stringify(await readIdentity()) !== JSON.stringify(identity))
        throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
      if (!active()) return;
      if (result.error) throw result.error;
      if (typeof result.data?.nativeSql !== 'string')
        throw new Error('QUERY_EVIDENCE_UNAVAILABLE');
      setData({ responseId, value: result.data.nativeSql });
      return result;
    } catch (error) {
      if (active()) {
        setNativeSQLMode(false);
        if (independent) errorHandler(error);
        else message.error(text.referenceError);
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    detach();
    selectionIdentity.current = undefined;
    const refresh = () => {
      detach();
      if (mode.current) void fetchNativeSQL();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
      else detach();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    if (mode.current) void fetchNativeSQL();
    return () => {
      sequence.current += 1;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [responseId]);

  const nativeSQL = data?.responseId === responseId ? data.value : '';
  const nativeSQLResult: NativeSQLResult = {
    ...nativeSQLInfo,
    data: nativeSQL,
    loading,
    nativeSQLMode,
    setNativeSQLMode,
  };

  return {
    fetchNativeSQL,
    nativeSQLResult,
  };
}

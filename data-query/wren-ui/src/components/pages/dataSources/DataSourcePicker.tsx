import { useEffect } from 'react';
import { useApolloClient } from '@apollo/client';
import { Select } from 'antd';
import useKailoText from '@/utils/kailoI18n';
import { notify } from '@/utils/kailoHost';
import {
  selectDataSource,
  useSelectedDataSource,
} from '@/utils/dataSourceSelection';
import { useDataSourcesQuery } from '@/apollo/client/graphql/dataSources.generated';

// DD-169(2)①(6): which data source this tab works on. Switching only changes
// the navigation state and refetches every view under the new selection; a
// remembered selection that no longer exists falls back to the default.

const PICKER_LIMIT = 50; // DD-169(2): at most 50 data sources per instance

export function useCurrentDataSource() {
  const client = useApolloClient();
  const t = useKailoText();
  const selected = useSelectedDataSource();
  const { data, loading } = useDataSourcesQuery({
    variables: { limit: PICKER_LIMIT },
    fetchPolicy: 'cache-and-network',
  });
  const list = data?.dataSources;
  const items = list?.items || [];
  const currentId =
    selected && items.some((item) => item.id === selected)
      ? selected
      : list?.defaultId ?? null;
  const current = items.find((item) => item.id === currentId) || null;

  useEffect(() => {
    // A deleted or foreign selection is dropped once the list is known.
    if (list && selected && !items.some((item) => item.id === selected))
      selectDataSource(null);
  }, [list, selected]);

  const switchTo = async (id: number) => {
    if (id === currentId) return;
    selectDataSource(id);
    await client.resetStore().catch(() => undefined);
    const name = items.find((item) => item.id === id)?.displayName || '';
    notify.success(t('dataSources.switched', { name }));
  };

  return { items, current, currentId, loading, switchTo, list };
}

export default function DataSourcePicker(props: { hint?: boolean }) {
  const t = useKailoText();
  const { items, currentId, switchTo } = useCurrentDataSource();
  if (items.length < 1) return null;
  return (
    <div className="kailo-data-source-picker">
      <span>{t('dataSources.selector')}</span>
      <Select
        size="small"
        value={currentId ?? undefined}
        options={items.map((item) => ({
          value: item.id,
          label: item.displayName,
        }))}
        onChange={(id: number) => switchTo(id)}
      />
      {props.hint && <span>{t('dataSources.selectorHint')}</span>}
    </div>
  );
}

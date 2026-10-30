import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useApolloClient } from '@apollo/client';
import KailoAdminSurface, {
  useKailoAdminPage,
} from '@/components/kailo/KailoAdminSurface';
import DataSourceList, {
  DataSourceRow,
  useDataSourceList,
} from '@/components/pages/dataSources/DataSourceList';
import DataSourceWizard from '@/components/pages/dataSources/DataSourceWizard';
import DataSourceDetail from '@/components/pages/dataSources/DataSourceDetail';
import useKailoText from '@/utils/kailoI18n';
import { confirm, notify } from '@/utils/kailoHost';
import { parseGraphQLError } from '@/utils/errorHandler';
import {
  selectDataSource,
  selectedDataSource,
} from '@/utils/dataSourceSelection';
import { Path } from '@/utils/enum';
import {
  useDeleteDataSourceMutation,
  useMigrateDataSourceCredentialsMutation,
} from '@/apollo/client/graphql/dataSources.generated';

// DD-169(6)① (`07` §4.8.5): the data source admin surface — the list of this
// instance's data sources, the new data source wizard, details, edit and
// delete. Only this admin function renders here (no shell, no links to the
// other admin surfaces). The view lives in the route (`view`, `id`) so back
// and forward return to the same place. Writes are refused by the server for
// anyone without `manage`; the page shows nothing it would refuse.

export default function DataSourceSurface() {
  return (
    <KailoAdminSurface path={Path.AdminDataSource}>
      <DataSourceManager />
    </KailoAdminSurface>
  );
}

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'detail'; id: number }
  | { kind: 'edit'; id: number };

function useView(): [View, (next: View) => void] {
  const router = useRouter();
  const view = String(router.query.view || '');
  const id = Number(router.query.id);
  const current: View =
    view === 'new'
      ? { kind: 'new' }
      : (view === 'detail' || view === 'edit') && Number.isSafeInteger(id)
        ? { kind: view, id }
        : { kind: 'list' };
  const go = (next: View) => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(router.query))
      if (key !== 'view' && key !== 'id' && typeof value === 'string')
        query[key] = value;
    if (next.kind !== 'list') query.view = next.kind;
    if (next.kind === 'detail' || next.kind === 'edit')
      query.id = String(next.id);
    router.push({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };
  return [current, go];
}

function DataSourceManager() {
  const t = useKailoText();
  const client = useApolloClient();
  const list = useDataSourceList();
  const [view, go] = useView();
  const governed = !!list.data?.dataSources.governed;

  // DD-169(7)①: native ciphertext moves into Kailo custody when an
  // administrator first opens this surface; failures are retried next time.
  const [migrate] = useMigrateDataSourceCredentialsMutation({
    onError: () => undefined,
  });
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    migrate().then(async (response) => {
      const result = response?.data?.migrateDataSourceCredentials;
      if (!result) return;
      if (result.migrated) {
        notify.success(t('dataSources.migrated', { count: result.migrated }));
        await list.refetch();
      }
      if (result.pending)
        notify.warning(
          t('dataSources.migrationPending', { count: result.pending }),
        );
    });
  }, []);

  const [deleteDataSource] = useDeleteDataSourceMutation();

  const onDelete = async (row: DataSourceRow) => {
    const confirmed = await confirm({
      tone: 'danger',
      title: t('deleteNamedTitle', {
        item: t('dataSources.title'),
        name: row.displayName,
      }),
      description: t('dataSources.deleteDescription'),
    });
    if (!confirmed) return;
    try {
      await deleteDataSource({ variables: { id: row.id } });
    } catch (error) {
      notify.error(t('actionFailed'), parseGraphQLError(error)?.message);
      return;
    }
    if (selectedDataSource() === row.id) selectDataSource(null);
    await client.resetStore().catch(() => undefined);
    notify.success(t('dataSources.deleted', { name: row.displayName }));
  };

  useKailoAdminPage({
    ready: !list.loading || !!list.data,
    actions:
      view.kind === 'list' && !governed
        ? [
            {
              id: 'new-data-source',
              label: t('dataSources.newDataSource'),
              variant: 'primary',
              icon: 'plus',
            },
          ]
        : [],
    onAction: (id) => id === 'new-data-source' && go({ kind: 'new' }),
  });

  if (view.kind === 'new')
    return (
      <div className="kailo-admin-surface__form">
        <DataSourceWizard
          onCancel={() => go({ kind: 'list' })}
          onFinished={async () => {
            await list.refetch();
            go({ kind: 'list' });
          }}
        />
      </div>
    );

  if (view.kind === 'detail' || view.kind === 'edit')
    return (
      <div className="kailo-admin-surface__form">
        <DataSourceDetail
          id={view.id}
          editing={view.kind === 'edit'}
          governed={governed}
          onEdit={() => go({ kind: 'edit', id: view.id })}
          onClose={() => go({ kind: 'list' })}
          onSaved={() => go({ kind: 'detail', id: view.id })}
        />
      </div>
    );

  return (
    <div className="kailo-admin-surface__form">
      <DataSourceList
        list={list}
        admin
        onCreate={() => go({ kind: 'new' })}
        onView={(row) => go({ kind: 'detail', id: row.id })}
        onEdit={(row) => go({ kind: 'edit', id: row.id })}
        onDelete={onDelete}
      />
    </div>
  );
}

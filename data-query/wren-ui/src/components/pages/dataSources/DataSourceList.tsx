import Image from 'next/image';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import {
  Button,
  Input,
  Pagination,
  Select,
  Space,
  Table,
  TableColumnsType,
  Tag,
} from 'antd';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import {
  AlertCircleIcon,
  DatabaseIcon,
  FilterIcon,
  SettingsIcon,
} from '@/components/kailo/KailoIcons';
import useKailoText from '@/utils/kailoI18n';
import { getDataSourceConfig } from '@/utils/dataSourceType';
import { DATA_SOURCES } from '@/utils/enum/dataSources';
import { parseGraphQLError } from '@/utils/errorHandler';
import {
  DataSourceCredentialStorage,
  DataSourceName,
  DataSourceStatus,
} from '@/apollo/client/graphql/__types__';
import {
  DataSourcesQuery,
  useDataSourcesQuery,
} from '@/apollo/client/graphql/dataSources.generated';

// DD-169(6): the data source list shared by the admin surface and the
// business page. DD-167(4): "共 N 条 · 第 x / y 页", 20/50/100 per page,
// search and filters answered by the server and kept in the route so back,
// forward and deep links show the same view. DD-167(6): skeleton, empty,
// filtered-empty, inline error with retry, permission denied.

export type DataSourceRow = DataSourcesQuery['dataSources']['items'][number];

const PAGE_SIZES = [20, 50, 100];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** List state from the route (DD-167(4)): q, type, status, page, size. */
export function useDataSourceListState() {
  const router = useRouter();
  const query = router.query;
  const keyword = firstValue(query.q) || '';
  const type = (firstValue(query.type) as DataSourceName) || undefined;
  const status = (firstValue(query.status) as DataSourceStatus) || undefined;
  const size = PAGE_SIZES.includes(Number(firstValue(query.size)))
    ? Number(firstValue(query.size))
    : PAGE_SIZES[0];
  const page = Math.max(1, Math.floor(Number(firstValue(query.page)) || 1));

  const update = (next: Record<string, string | number | undefined>) => {
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...query, ...next }))
      if (value !== undefined && value !== '' && value !== null)
        merged[key] = String(value);
    router.replace({ pathname: router.pathname, query: merged }, undefined, {
      shallow: true,
    });
  };

  return {
    keyword,
    type,
    status,
    page,
    size,
    filtered: !!(keyword || type || status),
    setKeyword: (q: string) => update({ q, page: undefined }),
    setType: (value?: string) => update({ type: value, page: undefined }),
    setStatus: (value?: string) => update({ status: value, page: undefined }),
    setPage: (value: number, pageSize: number) =>
      update({ page: value > 1 ? value : undefined, size: pageSize }),
    clear: () =>
      update({
        q: undefined,
        type: undefined,
        status: undefined,
        page: undefined,
      }),
  };
}

export function useDataSourceList() {
  const state = useDataSourceListState();
  const result = useDataSourcesQuery({
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
    variables: {
      filter: {
        keyword: state.keyword || null,
        type: state.type || null,
        status: state.status || null,
      },
      offset: (state.page - 1) * state.size,
      limit: state.size,
    },
  });
  return { state, ...result };
}

export function DataSourceTypeLabel(props: { type: DataSourceName }) {
  const config = getDataSourceConfig(props.type as unknown as DATA_SOURCES);
  return (
    <span className="d-inline-flex align-center">
      {config.logo && (
        <Image
          className="mr-2"
          src={config.logo}
          alt={config.label}
          width="20"
          height="20"
        />
      )}
      {config.label}
    </span>
  );
}

export function DataSourceStatusTag(props: { status: DataSourceStatus }) {
  const t = useKailoText();
  return props.status === DataSourceStatus.READY ? (
    <Tag className="kailo-tag kailo-tag--success">
      {t('dataSources.statusReady')}
    </Tag>
  ) : (
    <Tag className="kailo-tag">{t('dataSources.statusNoModels')}</Tag>
  );
}

export function credentialStorageText(
  t: ReturnType<typeof useKailoText>,
  storage?: DataSourceCredentialStorage | null,
) {
  if (storage === DataSourceCredentialStorage.KAILO)
    return t('dataSources.credentialKailo');
  if (storage === DataSourceCredentialStorage.LOCAL)
    return t('dataSources.credentialLocal');
  return t('dataSources.credentialNone');
}

/** True for the refusal DD-167(6) shows as "permission denied". */
export function deniedError(error: unknown): boolean {
  const parsed = parseGraphQLError(error as any);
  return parsed?.code === 'KAILO_ADMIN_REQUIRED';
}

interface Props {
  list: ReturnType<typeof useDataSourceList>;
  /** Administrators: credentials column and row actions. */
  admin?: boolean;
  currentId?: number | null;
  onCreate?: () => void;
  onView?: (row: DataSourceRow) => void;
  onEdit?: (row: DataSourceRow) => void;
  onDelete?: (row: DataSourceRow) => void;
  onSetCurrent?: (row: DataSourceRow) => void;
}

export default function DataSourceList(props: Props) {
  const { list, admin, currentId } = props;
  const { state, data, previousData, loading, error, refetch } = list;
  const t = useKailoText();
  const shown = data || previousData;
  const items = shown?.dataSources.items || [];
  const total = shown?.dataSources.total || 0;
  const governed = !!shown?.dataSources.governed;
  const pages = Math.max(1, Math.ceil(total / state.size));

  const typeOptions = useMemo(
    () =>
      Object.values(DATA_SOURCES).map((value) => ({
        value,
        label: getDataSourceConfig(value).label,
      })),
    [],
  );

  const columns: TableColumnsType<DataSourceRow> = [
    {
      title: t('dataSources.colName'),
      dataIndex: 'displayName',
      render: (name: string, row) => (
        <Space size={8}>
          <span className="text-medium">{name}</span>
          {currentId === row.id && (
            <Tag className="kailo-tag kailo-tag--brand">
              {t('dataSources.current')}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('dataSources.colType'),
      dataIndex: 'type',
      width: 200,
      render: (type: DataSourceName) => <DataSourceTypeLabel type={type} />,
    },
    {
      title: t('dataSources.colStatus'),
      dataIndex: 'status',
      width: 120,
      render: (status: DataSourceStatus) => (
        <DataSourceStatusTag status={status} />
      ),
    },
    {
      title: t('dataSources.colModels'),
      dataIndex: 'modelCount',
      width: 96,
      align: 'right',
    },
    ...(admin
      ? [
          {
            title: t('dataSources.colCredentials'),
            dataIndex: 'credentialStorage',
            width: 160,
            render: (storage: DataSourceCredentialStorage) =>
              credentialStorageText(t, storage),
          },
        ]
      : []),
    {
      title: t('dataSources.colActions'),
      key: 'actions',
      width: admin ? 220 : 120,
      align: 'right',
      render: (_value, row) => (
        <Space size={4}>
          {props.onSetCurrent && currentId !== row.id && (
            <Button
              type="link"
              size="small"
              onClick={() => props.onSetCurrent(row)}
            >
              {t('dataSources.setCurrent')}
            </Button>
          )}
          {admin && props.onView && (
            <Button type="link" size="small" onClick={() => props.onView(row)}>
              {t('dataSources.view')}
            </Button>
          )}
          {admin && !governed && props.onEdit && (
            <Button type="link" size="small" onClick={() => props.onEdit(row)}>
              {t('dataSources.edit')}
            </Button>
          )}
          {admin && !governed && props.onDelete && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => props.onDelete(row)}
            >
              {t('dataSources.delete')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const toolbar = (
    <div className="kailo-list-toolbar d-flex align-center mb-4">
      <Input.Search
        allowClear
        className="kailo-list-toolbar__search"
        style={{ maxWidth: 280 }}
        placeholder={t('dataSources.searchPlaceholder')}
        defaultValue={state.keyword}
        onSearch={(value) => state.setKeyword(value.trim())}
      />
      <Select
        allowClear
        className="ml-3"
        style={{ width: 180 }}
        placeholder={t('dataSources.allTypes')}
        value={state.type}
        options={typeOptions}
        onChange={(value) => state.setType(value)}
      />
      <Select
        allowClear
        className="ml-3"
        style={{ width: 140 }}
        placeholder={t('dataSources.allStatuses')}
        value={state.status}
        options={[
          {
            value: DataSourceStatus.READY,
            label: t('dataSources.statusReady'),
          },
          {
            value: DataSourceStatus.NO_MODELS,
            label: t('dataSources.statusNoModels'),
          },
        ]}
        onChange={(value) => state.setStatus(value)}
      />
    </div>
  );

  if (error && !shown) {
    if (deniedError(error))
      return (
        <KailoEmpty
          icon={SettingsIcon}
          title={t('dataSources.deniedTitle')}
          description={t('dataSources.deniedHint')}
        />
      );
    return (
      <KailoEmpty
        icon={AlertCircleIcon}
        title={t('dataSources.loadFailedTitle')}
        description={t('dataSources.loadFailedHint', {
          reason: parseGraphQLError(error)?.shortMessage || t('actionFailed'),
        })}
        actionLabel={t('dataSources.retry')}
        onAction={() => refetch()}
      />
    );
  }

  if (shown && total === 0 && !state.filtered)
    return (
      <KailoEmpty
        icon={DatabaseIcon}
        title={t('dataSources.emptyTitle')}
        description={
          admin
            ? t('dataSources.emptyAdminHint')
            : t('dataSources.emptyMemberHint')
        }
        actionLabel={
          admin && !governed && props.onCreate
            ? t('dataSources.newDataSource')
            : undefined
        }
        onAction={props.onCreate}
      />
    );

  return (
    <div className="kailo-data-source-list">
      {toolbar}
      {shown && total === 0 ? (
        <KailoEmpty
          icon={FilterIcon}
          title={t('dataSources.filteredEmptyTitle')}
          actionLabel={t('dataSources.clearFilters')}
          onAction={state.clear}
        />
      ) : (
        <>
          <Table
            className="ant-table-has-header"
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={loading && !shown}
            pagination={false}
          />
          <div className="kailo-pagination d-flex align-center justify-space-between mt-4">
            <span className="gray-7">
              {t('dataSources.total', { total })} ·{' '}
              {t('dataSources.pagePosition', {
                page: Math.min(state.page, pages),
                pages,
              })}
            </span>
            <Pagination
              size="small"
              current={state.page}
              pageSize={state.size}
              total={total}
              pageSizeOptions={PAGE_SIZES.map(String)}
              showSizeChanger
              onChange={(page, pageSize) => state.setPage(page, pageSize)}
            />
          </div>
        </>
      )}
      {governed && admin && (
        <div className="gray-7 mt-3">{t('dataSources.governedHint')}</div>
      )}
    </div>
  );
}

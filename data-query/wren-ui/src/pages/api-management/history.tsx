import { useEffect, useRef, useState } from 'react';
import { Table, TableColumnsType, Button, Tag, Typography, Select } from 'antd';
import { getAbsoluteTime, getRelativeTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import { CodeIcon, EyeIcon, XIcon } from '@/components/kailo/KailoIcons';
import {
  KailoForbidden,
  KailoListProgress,
  KailoLoadError,
  KailoPagination,
  KailoSkeletonRows,
  KailoTime,
  KailoToolbar,
} from '@/components/kailo/KailoList';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import DetailsDrawer from '@/components/pages/apiManagement/DetailsDrawer';
import {
  ApiHistoryQuery,
  useApiHistoryLazyQuery,
} from '@/apollo/client/graphql/apiManagement.generated';
import { ApiType, ApiHistoryResponse } from '@/apollo/client/graphql/__types__';
import { getUserConfig } from '@/utils/env';
import { getApiHistoryText } from '@/utils/language';
import { useRouter } from 'next/router';
import KailoUser from '@/components/kailo/KailoUser';
import useKailoText, { kailoText } from '@/utils/kailoI18n';
import { apiTypeLabel } from '@/components/pages/apiManagement/apiTypeLabel';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import useKailoPage from '@/hooks/useKailoPage';
import useKailoSession from '@/hooks/useKailoSession';
import useListRoute from '@/hooks/useListRoute';
import { pageCount } from '@/utils/kailoList';

// DD-167 (`20` §15.1/§15.3): API 记录 — an unbounded list paged on the
// server (newest first); filters 类型 / 状态 / 时间 (and a conversation, from
// a row) in the toolbar; page, size and filters in the route; a detail side
// panel with the request and the response.
const STATUS_FILTERS = [200, 400, 500] as const;
const TIME_FILTERS: Record<string, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

async function currentHistoryIdentity() {
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
    value: `${config.queryScope}:${config.nativeBindingGeneration}`,
    queryScope: config.queryScope,
    generation: config.nativeBindingGeneration,
  };
}

// DD-138(7): the API call history is administration data. Only the person
// the server reports as admin (Core `manage` on the binding / the directory
// Tenant admin) gets the page; the server refuses the history to everyone
// else, so a member reaching this route sees the Kailo empty state and the
// page never asks for it.
export default function APIHistoryPage() {
  const { loaded, isAdmin } = useKailoSession();
  return loaded && isAdmin ? (
    <APIHistory />
  ) : (
    <APIHistoryUnavailable loading={!loaded} />
  );
}

function APIHistoryUnavailable({ loading }: { loading: boolean }) {
  const { locale } = useRouter();
  const t = useKailoText();
  useKailoPage({ title: kailoText(locale, 'apiHistory'), ready: !loading });
  // DD-167 (`20` §15.4 权限不足): lock, how to get access, no retry.
  return (
    <SimpleLayout loading={loading}>
      {!loading && (
        <div className="kailo-page-state">
          <KailoForbidden
            item="list.itemApiHistory"
            hint={t('apiHistoryAdminOnlyHint')}
          />
        </div>
      )}
    </SimpleLayout>
  );
}

export function APIHistory() {
  const detailsDrawer = useDrawerAction();
  const list = useListRoute();
  const apiTypeFilter = Object.values(ApiType).includes(
    list.text('type') as ApiType,
  )
    ? (list.text('type') as ApiType)
    : undefined;
  const statusFilter = STATUS_FILTERS.find(
    (status) => String(status) === list.text('status'),
  );
  const timeFilter = TIME_FILTERS[list.text('time')]
    ? list.text('time')
    : undefined;
  const threadFilter = list.text('thread') || undefined;
  const filtered = !!(
    apiTypeFilter ||
    statusFilter ||
    timeFilter ||
    threadFilter
  );
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<ApiHistoryQuery['apiHistory']>();
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [observing, setObserving] = useState(false);
  const observationGeneration = useRef(0);
  const pageGeneration = useRef(0);
  const pageIdentity = useRef<{ value: string | undefined }>();
  const selectedHistory = useRef<{
    id: string;
    identity: string | undefined;
  }>();
  const activeHistoryId = useRef<string>();
  const { locale } = useRouter();
  const text = getApiHistoryText(locale);
  const t = useKailoText();
  const [readPage] = useApiHistoryLazyQuery({ fetchPolicy: 'no-cache' });
  const [readHistory] = useApiHistoryLazyQuery({ fetchPolicy: 'no-cache' });

  const detachDetails = () => {
    observationGeneration.current += 1;
    activeHistoryId.current = undefined;
    setObserving(false);
    detailsDrawer.closeDrawer();
  };
  const closeDetails = () => {
    selectedHistory.current = undefined;
    detachDetails();
  };
  const clearPage = () => {
    pageGeneration.current += 1;
    pageIdentity.current = undefined;
    selectedHistory.current = undefined;
    setPage(undefined);
    setLoading(false);
    detachDetails();
  };

  const readSelectedHistory = async (id: string) => {
    const generation = ++observationGeneration.current;
    const currentPageGeneration = pageGeneration.current;
    activeHistoryId.current = id;
    const active = () =>
      generation === observationGeneration.current &&
      currentPageGeneration === pageGeneration.current &&
      activeHistoryId.current === id;
    // A selected record contributes only its opaque ID, never cached bodies.
    detailsDrawer.closeDrawer();
    setObserving(true);
    try {
      const identity = await currentHistoryIdentity();
      if (
        !pageIdentity.current ||
        pageIdentity.current.value !== identity?.value
      )
        throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
      if (!active()) return;
      selectedHistory.current = { id, identity: identity?.value };
      const result = await readHistory({
        variables: {
          filter: {
            id,
            ...(identity && {
              queryScope: identity.queryScope,
              generation: identity.generation,
            }),
          },
          pagination: { offset: 0, limit: 1 },
        },
      });
      if ((await currentHistoryIdentity())?.value !== identity?.value)
        throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
      if (!active()) return;
      const current = result.data?.apiHistory.items;
      if (result.error || current?.length !== 1 || current[0].id !== id)
        throw new Error(text.unknown);
      detailsDrawer.openDrawer(current[0]);
    } catch (error) {
      if (active()) {
        clearPage();
        setPageError(
          error?.message === 'NATIVE_AUTHENTICATION_REQUIRED'
            ? text.scopeError
            : text.unknown,
        );
      }
    } finally {
      if (active()) setObserving(false);
    }
  };

  useEffect(() => {
    const refresh = async () => {
      const generation = ++pageGeneration.current;
      pageIdentity.current = undefined;
      setPage(undefined);
      setPageError(undefined);
      setLoading(true);
      detachDetails();
      const active = () => generation === pageGeneration.current;
      try {
        const identity = await currentHistoryIdentity();
        if (!active()) return;
        const result = await readPage({
          variables: {
            pagination: {
              offset: (list.page - 1) * list.size,
              limit: list.size,
            },
            filter: {
              ...(identity && {
                queryScope: identity.queryScope,
                generation: identity.generation,
              }),
              apiType: apiTypeFilter,
              statusCode: statusFilter,
              threadId: threadFilter,
              ...(timeFilter && {
                startDate: new Date(
                  Date.now() - TIME_FILTERS[timeFilter],
                ).toISOString(),
              }),
            },
          },
        });
        if ((await currentHistoryIdentity())?.value !== identity?.value)
          throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
        if (!active()) return;
        if (result.error || !result.data?.apiHistory)
          throw new Error(text.unknown);
        pageIdentity.current = { value: identity?.value };
        setPage(result.data.apiHistory);
        if (
          selectedHistory.current &&
          selectedHistory.current.identity === identity?.value
        )
          await readSelectedHistory(selectedHistory.current.id);
        else selectedHistory.current = undefined;
      } catch (error) {
        if (active()) {
          selectedHistory.current = undefined;
          setPageError(
            error?.message === 'NATIVE_AUTHENTICATION_REQUIRED'
              ? text.scopeError
              : text.unknown,
          );
        }
      } finally {
        if (active()) setLoading(false);
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
      else {
        pageGeneration.current += 1;
        pageIdentity.current = undefined;
        setPage(undefined);
        setLoading(false);
        detachDetails();
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      pageGeneration.current += 1;
      pageIdentity.current = undefined;
      observationGeneration.current += 1;
      activeHistoryId.current = undefined;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [
    list.page,
    list.size,
    apiTypeFilter,
    statusFilter,
    timeFilter,
    threadFilter,
    attempt,
  ]);

  // A page past the end returns to the last page (20 §15.3).
  useEffect(() => {
    if (page && page.total > 0 && list.page > pageCount(page.total, list.size))
      list.update({ page: pageCount(page.total, list.size) });
  }, [page?.total, list.page, list.size]);

  const statusTag = (status: number) => {
    if (status === 202) return <Tag color="warning">{text.unknown}</Tag>;
    const ok = status >= 200 && status < 300;
    return (
      <Tag
        icon={ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        color={ok ? 'success' : 'error'}
      >
        {status}
      </Tag>
    );
  };

  const columns: TableColumnsType<ApiHistoryResponse> = [
    {
      title: t('knowledge.timestamp'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 128,
      // Newest first is the only order (20 §15.3), shown on the header.
      sortOrder: 'descend',
      sortDirections: ['descend'],
      sorter: true,
      showSorterTooltip: false,
      render: (timestamp: string) => (
        <KailoTime
          value={timestamp}
          relative={getRelativeTime}
          absolute={getAbsoluteTime}
        />
      ),
    },
    {
      title: t('knowledge.apiType'),
      dataIndex: 'apiType',
      key: 'apiType',
      width: 160,
      render: (type: ApiHistoryResponse['apiType']) => (
        <span className="kailo-row-title">{apiTypeLabel(locale, type)}</span>
      ),
    },
    {
      title: t('knowledge.status'),
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 112,
      render: (status: number) => statusTag(status),
    },
    {
      title: t('knowledge.questionOrSql'),
      dataIndex: 'requestPayload',
      key: 'requestPayload',
      render: (payload: Record<string, any>, record: ApiHistoryResponse) => {
        const sql = record.apiType === ApiType.RUN_SQL && payload?.sql;
        const value = sql || payload?.question || payload?.sql;
        if (!value) return <span className="kailo-row-secondary">—</span>;
        return sql ? (
          <code className="kailo-sql-snippet" title={sql}>
            {String(sql).replace(/\s+/g, ' ').trim()}
          </code>
        ) : (
          <Typography.Text ellipsis title={String(value)}>
            {String(value)}
          </Typography.Text>
        );
      },
    },
    {
      title: t('knowledge.threadId'),
      dataIndex: 'threadId',
      key: 'threadId',
      width: 148,
      render: (threadId: string) => {
        if (!threadId) return <span className="kailo-row-secondary">—</span>;
        return (
          <Button
            type="link"
            size="small"
            className="kailo-link-cell"
            title={threadId}
            onClick={(event) => {
              event.stopPropagation();
              list.update({ thread: threadId });
            }}
          >
            {threadId.length > 12 ? `${threadId.slice(0, 12)}…` : threadId}
          </Button>
        );
      },
    },
    {
      // DD-133 §3: the Kailo user behind the call (none for older rows and
      // for the instance's own service calls).
      title: kailoText(locale, 'owner'),
      dataIndex: 'owner',
      key: 'owner',
      width: 156,
      render: (owner) => (
        <KailoUser user={owner} emptyText={kailoText(locale, 'ownerUnknown')} />
      ),
    },
    {
      title: t('knowledge.duration'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 96,
      align: 'right',
      render: (durationMs: number) => (
        <span className="kailo-row-secondary kailo-num">
          {durationMs ? `${durationMs.toLocaleString()} ms` : '—'}
        </span>
      ),
    },
    {
      title: t('knowledge.actions'),
      key: 'actions',
      width: 88,
      align: 'center',
      render: (record) => (
        <Button
          type="text"
          size="small"
          icon={<EyeIcon className="mr-1" />}
          onClick={(event) => {
            event?.stopPropagation?.();
            return readSelectedHistory(record.id);
          }}
        >
          {t('knowledge.details')}
        </Button>
      ),
    },
  ];

  // DD-157: Kailo page header — API 记录 (no page action).
  useKailoPage({
    title: kailoText(locale, 'apiHistory'),
    ready: !loading,
  });

  const total = page?.total ?? 0;
  const clearFilters = () =>
    list.update({
      type: undefined,
      status: undefined,
      time: undefined,
      thread: undefined,
    });
  // 20 §15.4: first read and every refresh of this private list are
  // skeleton rows (the rows are never kept across an identity check).
  const tableState = () => {
    if (loading) return <KailoSkeletonRows rows={Math.min(list.size, 10)} />;
    if (pageError)
      return (
        <KailoLoadError
          error={null}
          item="list.itemApiHistory"
          reason={pageError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      );
    if (filtered)
      return (
        <div className="kailo-no-match">
          <div className="kailo-no-match__title">
            {t('list.noMatch', { item: t('list.itemApiHistory') })}
          </div>
          <div className="kailo-no-match__hint">{t('list.noMatchHint')}</div>
          <Button size="small" onClick={clearFilters}>
            {t('list.clearFilters')}
          </Button>
        </div>
      );
    return (
      <KailoEmpty
        icon={CodeIcon}
        title={t('knowledge.apiHistoryEmptyTitle')}
        description={t('knowledge.apiHistoryEmptyDescription')}
      />
    );
  };

  return (
    <SimpleLayout loading={false}>
      <div className="kailo-list-page">
        <KailoToolbar
          left={
            <>
              <Select
                className="kailo-filter"
                aria-label={t('list.filterType')}
                value={apiTypeFilter ?? ''}
                dropdownMatchSelectWidth={false}
                onChange={(value) => list.update({ type: value || undefined })}
                options={[
                  { value: '', label: t('list.allTypes') },
                  ...Object.values(ApiType).map((type) => ({
                    value: type,
                    label: apiTypeLabel(locale, type),
                  })),
                ]}
              />
              <Select
                className="kailo-filter"
                aria-label={t('list.filterStatus')}
                value={statusFilter ? String(statusFilter) : ''}
                dropdownMatchSelectWidth={false}
                onChange={(value) =>
                  list.update({ status: value || undefined })
                }
                options={[
                  { value: '', label: t('list.allStatuses') },
                  { value: '200', label: t('knowledge.status2xx') },
                  { value: '400', label: t('knowledge.status4xx') },
                  { value: '500', label: t('knowledge.status5xx') },
                ]}
              />
              <Select
                className="kailo-filter"
                aria-label={t('list.filterTime')}
                value={timeFilter ?? ''}
                dropdownMatchSelectWidth={false}
                onChange={(value) => list.update({ time: value || undefined })}
                options={[
                  { value: '', label: t('list.anyTime') },
                  { value: '24h', label: t('list.last24h') },
                  { value: '7d', label: t('list.last7d') },
                  { value: '30d', label: t('list.last30d') },
                ]}
              />
              {threadFilter && (
                <span className="kailo-filter-chip">
                  {t('list.threadIdFilter', {
                    id:
                      threadFilter.length > 12
                        ? `${threadFilter.slice(0, 12)}…`
                        : threadFilter,
                  })}
                  <Button
                    type="text"
                    size="small"
                    aria-label={t('list.clearFilters')}
                    icon={<XIcon size={12} />}
                    onClick={() => list.update({ thread: undefined })}
                  />
                </span>
              )}
              {filtered && (
                <Button
                  type="text"
                  size="small"
                  className="kailo-clear-filters"
                  onClick={clearFilters}
                >
                  {t('list.clearFilters')}
                </Button>
              )}
            </>
          }
        />
        <div
          className="kailo-list"
          aria-busy={loading || observing || undefined}
        >
          <KailoListProgress active={observing} />
          <Table
            className="ant-table-has-header"
            dataSource={page?.items || []}
            locale={{ emptyText: tableState() }}
            columns={columns}
            rowKey="id"
            pagination={false}
            tableLayout="fixed"
            rowClassName="kailo-row-clickable"
            onRow={(record) => ({
              onClick: () => readSelectedHistory(record.id),
            })}
          />
          {!loading && !pageError && total > 0 && (
            <KailoPagination
              total={total}
              page={Math.min(list.page, pageCount(total, list.size))}
              size={list.size}
              onChange={list.setPage}
            />
          )}
        </div>
        <DetailsDrawer
          {...detailsDrawer.state}
          onClose={closeDetails}
          loading={observing}
          onObserve={(record) => {
            if (selectedHistory.current?.id !== record.id)
              return Promise.resolve();
            return readSelectedHistory(record.id);
          }}
        />
      </div>
    </SimpleLayout>
  );
}

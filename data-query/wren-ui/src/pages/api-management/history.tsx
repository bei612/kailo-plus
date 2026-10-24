import { useEffect, useRef, useState } from 'react';
import { Table, TableColumnsType, Button, Tag, Typography } from 'antd';
import { getAbsoluteTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import { getColumnSearchProps } from '@/utils/table';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import { EyeIcon } from '@/components/kailo/KailoIcons';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import SQLCodeBlock from '@/components/code/SQLCodeBlock';
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

const PAGE_SIZE = 10;

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

export default function APIHistory() {
  const detailsDrawer = useDrawerAction();
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filters, setFilters] = useState<Record<string, any>>({});
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
              offset: (currentPage - 1) * PAGE_SIZE,
              limit: PAGE_SIZE,
            },
            filter: {
              ...(identity && {
                queryScope: identity.queryScope,
                generation: identity.generation,
              }),
              apiType: filters['apiType']?.[0],
              statusCode: filters['statusCode']?.[0],
              threadId: filters['threadId']?.[0],
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
  }, [currentPage, filters]);

  const columns: TableColumnsType<ApiHistoryResponse> = [
    {
      title: t('knowledge.timestamp'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (timestamp: string) => (
        <div className="gray-7">{getAbsoluteTime(timestamp)}</div>
      ),
    },
    {
      title: t('knowledge.apiType'),
      dataIndex: 'apiType',
      key: 'apiType',
      width: 180,
      render: (type: ApiHistoryResponse['apiType']) => (
        <Tag>{apiTypeLabel(locale, type)}</Tag>
      ),
      filters: Object.keys(ApiType).map((type) => ({
        text: apiTypeLabel(locale, ApiType[type]),
        value: type,
      })),
      filteredValue: filters['apiType'],
      filterMultiple: false,
    },
    {
      title: t('knowledge.status'),
      dataIndex: 'statusCode',
      key: 'statusCode',
      width: 100,
      render: (status: number) => {
        if (status === 202) return <Tag color="warning">{text.unknown}</Tag>;
        const icon =
          status >= 200 && status < 300 ? (
            <CheckCircleOutlined />
          ) : (
            <CloseCircleOutlined />
          );
        const color = status >= 200 && status < 300 ? 'success' : 'error';
        return (
          <Tag icon={icon} color={color}>
            {status}
          </Tag>
        );
      },
      filters: [
        { text: t('knowledge.status2xx'), value: 200 },
        { text: t('knowledge.status4xx'), value: 400 },
        { text: t('knowledge.status5xx'), value: 500 },
      ],
      filteredValue: filters['statusCode'],
      filterMultiple: false,
    },
    {
      title: t('knowledge.questionOrSql'),
      dataIndex: 'requestPayload',
      key: 'requestPayload',
      render: (payload: Record<string, any>, record: ApiHistoryResponse) => {
        if (record.apiType === ApiType.RUN_SQL && payload?.sql) {
          return (
            <div style={{ width: '100%' }}>
              <SQLCodeBlock code={payload.sql} maxHeight="130" />
            </div>
          );
        }
        return <div>{payload?.question || payload?.sql || '-'}</div>;
      },
    },
    {
      title: t('knowledge.threadId'),
      dataIndex: 'threadId',
      key: 'threadId',
      width: 200,
      render: (threadId: string) => {
        if (!threadId) return <div className="gray-7">-</div>;
        return (
          <Typography.Text
            ellipsis
            className="gray-7"
            copyable={{ text: threadId }}
          >
            {threadId}
          </Typography.Text>
        );
      },
      ...getColumnSearchProps({
        dataIndex: 'threadId',
        placeholder: t('knowledge.searchThreadId'),
        filteredValue: filters['threadId'],
      }),
    },
    {
      // DD-133 §3: the Kailo user behind the call (none for older rows and
      // for the instance's own service calls).
      title: kailoText(locale, 'owner'),
      dataIndex: 'owner',
      key: 'owner',
      width: 160,
      render: (owner) => (
        <KailoUser user={owner} emptyText={kailoText(locale, 'ownerUnknown')} />
      ),
    },
    {
      title: t('knowledge.durationMs'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 124,
      render: (durationMs: number) => (
        <div className="gray-7 text-right">{durationMs || '-'}</div>
      ),
    },
    {
      title: t('knowledge.actions'),
      key: 'actions',
      width: 110,
      align: 'center',
      fixed: 'right',
      render: (record) => (
        <Button
          type="text"
          size="small"
          icon={<EyeIcon className="mr-1" />}
          onClick={() => readSelectedHistory(record.id)}
        >
          {t('knowledge.details')}
        </Button>
      ),
    },
  ];

  // DD-152: Kailo page header — API 记录 (no page action).
  useKailoPage({
    title: kailoText(locale, 'apiHistory'),
    ready: !loading,
  });

  return (
    <SiderLayout loading={false} sidebar={null}>
      <PageLayout
        title={kailoText(locale, 'apiHistory')}
        description={t('knowledge.apiHistoryDescription')}
      >
        <Table
          className="ant-table-has-header"
          dataSource={page?.items || []}
          loading={loading || observing}
          locale={{
            emptyText: pageError || (
              <KailoEmpty
                title={t('knowledge.apiHistoryEmptyTitle')}
                description={t('knowledge.apiHistoryEmptyDescription')}
              />
            ),
          }}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: PAGE_SIZE,
            size: 'small',
            total: page?.total,
          }}
          scroll={{ x: 1200 }}
          onChange={(pagination, filters, _sorter) => {
            setCurrentPage(pagination.current);
            setFilters(filters);
          }}
        />
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
      </PageLayout>
    </SiderLayout>
  );
}

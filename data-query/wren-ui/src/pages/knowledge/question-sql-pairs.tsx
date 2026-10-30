import { useEffect, useMemo } from 'react';
import { Button, Table, TableColumnsType, Typography } from 'antd';
import { format } from 'sql-formatter';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { EyeIcon, ListIcon } from '@/components/kailo/KailoIcons';
import {
  KailoListFrame,
  KailoPagination,
  KailoSearch,
  KailoTime,
  KailoToolbar,
} from '@/components/kailo/KailoList';
import { notify } from '@/utils/kailoHost';
import KailoUser from '@/components/kailo/KailoUser';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';
import useKailoPage from '@/hooks/useKailoPage';
import useListRoute from '@/hooks/useListRoute';
import { MORE_ACTION } from '@/utils/enum';
import { getAbsoluteTime, getRelativeTime } from '@/utils/time';
import {
  clampPage,
  matchesSearch,
  pageCount,
  slicePage,
} from '@/utils/kailoList';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import { MoreButton } from '@/components/ActionButton';
import { SQLPairDropdown } from '@/components/diagram/CustomDropdown';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import SQLPairDrawer from '@/components/pages/knowledge/SQLPairDrawer';
import KnowledgeSegments from '@/components/pages/knowledge/KnowledgeSegments';
import { SqlPair } from '@/apollo/client/graphql/__types__';
import {
  useSqlPairsQuery,
  useCreateSqlPairMutation,
  useUpdateSqlPairMutation,
  useDeleteSqlPairMutation,
} from '@/apollo/client/graphql/sqlPairs.generated';
import { v4 as uuidv4 } from 'uuid';
import { getUserConfig } from '@/utils/env';
import { getApiHistoryText, getNativeWriteText } from '@/utils/language';
import { nativeWriteEvidence } from '@/utils/errorHandler';
import { useRouter } from 'next/router';

const { Paragraph } = Typography;

type Dated = { updatedAt?: string | null; createdAt?: string | null };
const recent = (pair: Dated) => pair.updatedAt || pair.createdAt || '';

// DD-167 (`20` §15.1/§15.3/§15.4): 知识 › 问答对. A bounded list (one
// project's saved pairs) counted and paged in the browser: search, newest
// first, "共 N 条" and the pager, page/size/search in the route; skeleton,
// inline error, first-use and no-match states. Writing is the admins'.
export default function ManageQuestionSQLPairs() {
  const locale = useRouter().locale;
  const t = useKailoText();
  // DD-133 §3: knowledge changes are Kailo Tenant admin actions.
  const { isAdmin } = useKailoSession();
  const questionSqlPairModal = useModalAction();
  const sqlPairDrawer = useDrawerAction();
  const list = useListRoute();
  const search = list.text('q');

  const { data, loading, error, refetch } = useSqlPairsQuery({
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });
  const sqlPairs = useMemo(
    () =>
      [...(data?.sqlPairs || [])]
        .filter(Boolean)
        .sort((a, b) => recent(b).localeCompare(recent(a))),
    [data?.sqlPairs],
  );
  const filtered = useMemo(
    () =>
      sqlPairs.filter((pair) => matchesSearch(search, pair.question, pair.sql)),
    [sqlPairs, search],
  );
  const page = clampPage(list.page, filtered.length, list.size);
  const rows = slicePage(filtered, page, list.size);
  useEffect(() => {
    if (data && list.page > pageCount(filtered.length, list.size))
      list.update({ page });
  }, [data, list.page, filtered.length, list.size]);

  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries: ['SqlPairs'],
      awaitRefetchQueries: true,
      ...options,
    };
  };

  const [createSqlPairMutation, { loading: createSqlPairLoading }] =
    useCreateSqlPairMutation(
      getBaseOptions({
        onError: undefined,
      }),
    );

  const [deleteSqlPairMutation] = useDeleteSqlPairMutation(
    getBaseOptions({
      onError: undefined,
    }),
  );

  const [editSqlPairMutation, { loading: editSqlPairLoading }] =
    useUpdateSqlPairMutation(
      getBaseOptions({
        onError: undefined,
      }),
    );

  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      const config = await getUserConfig();
      if (config.nativeBindingConfigured === false) {
        await deleteSqlPairMutation({ variables: { where: { id: data.id } } });
        notify.success(t('knowledge.sqlPairDeleted'));
        return;
      }
      const text = getNativeWriteText(locale);
      if (
        config.nativeBindingConfigured !== true ||
        !/^[a-f0-9]{64}$/.test(config.queryScope) ||
        !Number.isSafeInteger(config.nativeBindingGeneration)
      )
        throw new Error(text.scopeError);
      const slot = `kailo.native-sql-pair.${config.queryScope}.${data.id}.delete`;
      const retained = sessionStorage.getItem(slot);
      const intent = retained
        ? JSON.parse(retained)
        : { key: uuidv4(), generation: config.nativeBindingGeneration };
      if (intent.generation !== config.nativeBindingGeneration)
        throw new Error(text.scopeError);
      sessionStorage.setItem(slot, JSON.stringify(intent));
      try {
        const current = await getUserConfig();
        if (
          current.queryScope !== config.queryScope ||
          current.nativeBindingGeneration !== intent.generation
        )
          throw new Error(text.scopeError);
        const response = await deleteSqlPairMutation({
          variables: { where: { id: data.id, idempotencyKey: intent.key } },
          context: { nativeWriteGuarded: true },
        });
        if (response.errors || response.data?.deleteSqlPair !== true)
          throw response;
        const after = await getUserConfig();
        if (
          after.queryScope !== config.queryScope ||
          after.nativeBindingGeneration !== intent.generation
        )
          throw new Error(text.scopeError);
        sessionStorage.removeItem(slot);
        notify.success(t('knowledge.sqlPairDeleted'));
      } catch (error) {
        if (
          nativeWriteEvidence(error)?.outcome === 'NOT_STARTED' &&
          !error.networkError
        ) {
          sessionStorage.removeItem(slot);
          throw error;
        }
        notify.warning(text.unknown);
      }
    } else if (type === MORE_ACTION.EDIT) {
      questionSqlPairModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_SQL_PAIR) {
      sqlPairDrawer.openDrawer({ ...data, sql: format(data.sql) });
    }
  };

  const view = (record: unknown) =>
    onMoreClick({ type: MORE_ACTION.VIEW_SQL_PAIR, data: record });

  const columns: TableColumnsType<SqlPair> = [
    {
      title: t('knowledge.question'),
      dataIndex: 'question',
      render: (question, record) => (
        <div className="d-flex align-center gx-2">
          <Paragraph
            className="kailo-row-title mb-0"
            title={question}
            ellipsis={{ rows: 2 }}
          >
            {question}
          </Paragraph>
          {record.nativeWritePending && (
            <span className="kailo-badge kailo-badge--warning flex-shrink-0">
              {getApiHistoryText(locale).unknown}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('knowledge.sqlStatement'),
      dataIndex: 'sql',
      width: '38%',
      render: (sql: string) => (
        <code className="kailo-sql-snippet" title={sql}>
          {(sql || '').replace(/\s+/g, ' ').trim()}
        </code>
      ),
    },
    {
      // DD-133 §3: the Kailo user who saved it.
      title: t('owner'),
      dataIndex: 'owner',
      width: 168,
      render: (owner) => (
        <KailoUser user={owner} emptyText={t('ownerUnknown')} />
      ),
    },
    {
      title: t('list.updatedTime'),
      key: 'updatedAt',
      width: 128,
      render: (_, record) => (
        <KailoTime
          value={recent(record)}
          relative={getRelativeTime}
          absolute={getAbsoluteTime}
        />
      ),
    },
    {
      key: 'action',
      width: 56,
      align: 'center',
      render: (_, record) => (
        <span onClick={(event) => event.stopPropagation()}>
          {isAdmin ? (
            <SQLPairDropdown onMoreClick={onMoreClick} data={record}>
              <MoreButton className="gray-8" />
            </SQLPairDropdown>
          ) : (
            <Button
              type="text"
              size="small"
              aria-label={t('knowledge.view')}
              icon={<EyeIcon />}
              onClick={() => view(record)}
            />
          )}
        </span>
      ),
    },
  ];

  // DD-157: Kailo page header — 问答对, primary 添加问答对 (admins).
  const { hosted } = useKailoPage({
    title: t('questionSqlPairs'),
    ready: !(loading && !data),
    actions: isAdmin
      ? [
          {
            id: 'add',
            label: t('addQuestionSqlPair'),
            variant: 'primary',
            icon: 'plus',
          },
        ]
      : [],
    onAction: (id) => id === 'add' && questionSqlPairModal.openModal(),
  });

  return (
    <SimpleLayout loading={false}>
      <div className="kailo-list-page">
        <KailoToolbar
          left={
            <>
              <KnowledgeSegments active="sqlPairs" />
              <KailoSearch
                value={search}
                placeholder={t('list.searchSqlPairs')}
                onChange={(q) => list.update({ q })}
              />
            </>
          }
          right={
            !hosted &&
            isAdmin && (
              <Button
                type="primary"
                onClick={() => questionSqlPairModal.openModal()}
              >
                {t('addQuestionSqlPair')}
              </Button>
            )
          }
        />
        <KailoListFrame
          item="list.itemSqlPairs"
          loading={loading && !data}
          refreshing={loading && !!data}
          error={!data ? error : undefined}
          onRetry={() => refetch()}
          isEmpty={sqlPairs.length === 0}
          noMatch={filtered.length === 0}
          onClearFilters={() => list.update({ q: undefined })}
          skeletonRows={list.size}
          skeletonColumns={[30, 38, 14, 10]}
          empty={
            <KailoEmpty
              icon={ListIcon}
              title={t('knowledge.sqlPairsEmptyTitle')}
              description={
                isAdmin
                  ? t('knowledge.sqlPairsEmptyDescription')
                  : t('list.readonlyHint')
              }
              actionLabel={isAdmin ? t('addQuestionSqlPair') : undefined}
              onAction={() => questionSqlPairModal.openModal()}
            />
          }
          pager={
            <KailoPagination
              total={filtered.length}
              page={page}
              size={list.size}
              onChange={list.setPage}
            />
          }
        >
          <Table
            className="ant-table-has-header"
            dataSource={rows}
            columns={columns}
            rowKey="id"
            pagination={false}
            tableLayout="fixed"
            rowClassName="kailo-row-clickable"
            onRow={(record) => ({ onClick: () => view(record) })}
          />
        </KailoListFrame>
        <SQLPairDrawer
          {...sqlPairDrawer.state}
          onClose={sqlPairDrawer.closeDrawer}
        />
        <QuestionSQLPairModal
          {...questionSqlPairModal.state}
          onClose={questionSqlPairModal.closeModal}
          loading={createSqlPairLoading || editSqlPairLoading}
          onSubmit={async ({ id, data, nativeWriteGuarded }) => {
            if (id) {
              return await editSqlPairMutation({
                variables: { where: { id }, data },
                context: { nativeWriteGuarded },
              });
            } else {
              return await createSqlPairMutation({
                variables: { data },
                context: { nativeWriteGuarded },
              });
            }
          }}
        />
      </div>
    </SimpleLayout>
  );
}

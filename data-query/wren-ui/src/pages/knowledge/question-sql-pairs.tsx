import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button, message, Table, TableColumnsType, Typography } from 'antd';
import { format } from 'sql-formatter';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import { MoreButton } from '@/components/ActionButton';
import { SQLPairDropdown } from '@/components/diagram/CustomDropdown';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import SQLPairDrawer from '@/components/pages/knowledge/SQLPairDrawer';
import { SqlPair } from '@/apollo/client/graphql/__types__';
import {
  useSqlPairsQuery,
  useCreateSqlPairMutation,
  useUpdateSqlPairMutation,
  useDeleteSqlPairMutation,
} from '@/apollo/client/graphql/sqlPairs.generated';
import { v4 as uuidv4 } from 'uuid';
import { getUserConfig } from '@/utils/env';
import { getNativeWriteText } from '@/utils/language';
import { nativeWriteEvidence } from '@/utils/errorHandler';
import { useRouter } from 'next/router';

const SQLCodeBlock = dynamic(() => import('@/components/code/SQLCodeBlock'), {
  ssr: false,
});

const { Paragraph, Text } = Typography;

export default function ManageQuestionSQLPairs() {
  const locale = useRouter().locale;
  const questionSqlPairModal = useModalAction();
  const sqlPairDrawer = useDrawerAction();

  const { data, loading } = useSqlPairsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const sqlPairs = data?.sqlPairs || [];

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
        message.success('Successfully deleted question-sql pair.');
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
        message.success('Successfully deleted question-sql pair.');
      } catch (error) {
        if (
          nativeWriteEvidence(error)?.outcome === 'NOT_STARTED' &&
          !error.networkError
        ) {
          sessionStorage.removeItem(slot);
          throw error;
        }
        message.warning(text.unknown);
      }
    } else if (type === MORE_ACTION.EDIT) {
      questionSqlPairModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_SQL_PAIR) {
      sqlPairDrawer.openDrawer({ ...data, sql: format(data.sql) });
    }
  };

  const columns: TableColumnsType<SqlPair> = [
    {
      title: 'Question',
      dataIndex: 'question',
      width: 300,
      render: (question) => (
        <Paragraph title={question} ellipsis={{ rows: 2 }}>
          {question}
        </Paragraph>
      ),
    },
    {
      title: 'SQL statement',
      dataIndex: 'sql',
      width: '60%',
      render: (sql) => (
        <div style={{ width: '100%' }}>
          <SQLCodeBlock code={sql} maxHeight="130" />
        </div>
      ),
    },
    {
      title: 'Created time',
      dataIndex: 'createdAt',
      width: 130,
      render: (time) => <Text className="gray-7">{getCompactTime(time)}</Text>,
    },
    {
      key: 'action',
      width: 64,
      align: 'center',
      fixed: 'right',
      render: (_, record) => (
        <SQLPairDropdown onMoreClick={onMoreClick} data={record}>
          <MoreButton className="gray-8" />
        </SQLPairDropdown>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <PageLayout
        title={
          <>
            <FunctionOutlined className="mr-2 gray-8" />
            Manage question-SQL pairs
          </>
        }
        titleExtra={
          <Button
            type="primary"
            className=""
            onClick={() => questionSqlPairModal.openModal()}
          >
            Add question-SQL pair
          </Button>
        }
        description={
          <>
            On this page, you can manage your saved question-SQL pairs. These
            pairs help Wren AI learn how your organization writes SQL, allowing
            it to generate queries that better align with your expectations.{' '}
            <Link
              className="gray-8 underline"
              href="https://docs.getwren.ai/oss/guide/knowledge/question-sql-pairs"
              rel="noopener noreferrer"
              target="_blank"
            >
              Learn more.
            </Link>
          </>
        }
      >
        <Table
          className="ant-table-has-header"
          dataSource={sqlPairs}
          loading={loading}
          columns={columns}
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
          scroll={{ x: 1080 }}
        />
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
      </PageLayout>
    </SiderLayout>
  );
}

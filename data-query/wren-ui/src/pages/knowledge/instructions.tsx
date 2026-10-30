import { useEffect, useMemo } from 'react';
import { Button, Table, TableColumnsType, Typography } from 'antd';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { EyeIcon, FileTextIcon } from '@/components/kailo/KailoIcons';
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
import { MoreButton } from '@/components/ActionButton';
import { InstructionDropdown } from '@/components/diagram/CustomDropdown';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import InstructionModal from '@/components/modals/InstructionModal';
import InstructionDrawer from '@/components/pages/knowledge/InstructionDrawer';
import KnowledgeSegments from '@/components/pages/knowledge/KnowledgeSegments';
import { Instruction } from '@/apollo/client/graphql/__types__';
import {
  useInstructionsQuery,
  useCreateInstructionMutation,
  useUpdateInstructionMutation,
  useDeleteInstructionMutation,
} from '@/apollo/client/graphql/instructions.generated';

const { Paragraph } = Typography;

type Dated = { updatedAt?: string | null; createdAt?: string | null };
const recent = (item: Dated) => item.updatedAt || item.createdAt || '';

// DD-167 (`20` §15.1/§15.3/§15.4): 知识 › 指令. A bounded list counted and
// paged in the browser (instruction, where it applies, creator, updated),
// search, newest first, page/size/search in the route, every list state.
// Writing is the admins'.
export default function ManageInstructions() {
  const t = useKailoText();
  // DD-133 §3: knowledge changes are Kailo Tenant admin actions.
  const { isAdmin } = useKailoSession();
  const instructionModal = useModalAction();
  const instructionDrawer = useDrawerAction();
  const list = useListRoute();
  const search = list.text('q');

  const { data, loading, error, refetch } = useInstructionsQuery({
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });
  const instructions = useMemo(
    () =>
      [...(data?.instructions || [])]
        .filter(Boolean)
        .sort((a, b) => recent(b).localeCompare(recent(a))),
    [data?.instructions],
  );
  const filtered = useMemo(
    () =>
      instructions.filter((item) =>
        matchesSearch(search, item.instruction, item.questions),
      ),
    [instructions, search],
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
      refetchQueries: ['Instructions'],
      awaitRefetchQueries: true,
      ...options,
    };
  };
  const [createInstructionMutation, { loading: createInstructionLoading }] =
    useCreateInstructionMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(t('knowledge.instructionCreated'));
        },
      }),
    );
  const [updateInstructionMutation, { loading: updateInstructionLoading }] =
    useUpdateInstructionMutation(
      getBaseOptions({
        onCompleted: () => {
          notify.success(t('knowledge.instructionUpdated'));
        },
      }),
    );
  const [deleteInstructionMutation] = useDeleteInstructionMutation(
    getBaseOptions({
      onCompleted: () => {
        notify.success(t('knowledge.instructionDeleted'));
      },
    }),
  );
  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      await deleteInstructionMutation({
        variables: { where: { id: data.id } },
      });
    } else if (type === MORE_ACTION.EDIT) {
      instructionModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_INSTRUCTION) {
      instructionDrawer.openDrawer(data);
    }
  };
  const view = (record: unknown) =>
    onMoreClick({ type: MORE_ACTION.VIEW_INSTRUCTION, data: record });

  const columns: TableColumnsType<Instruction> = [
    {
      title: t('knowledge.instructionDetails'),
      dataIndex: 'instruction',
      render: (instruction) => (
        <Paragraph
          className="kailo-row-title mb-0"
          title={instruction}
          ellipsis={{ rows: 2 }}
        >
          {instruction}
        </Paragraph>
      ),
    },
    {
      title: t('knowledge.applyInstructionTo'),
      dataIndex: 'questions',
      width: '34%',
      render: (questions: string[], record) => {
        if (record.isDefault)
          return (
            <span className="kailo-badge kailo-badge--plain">
              {t('knowledge.global')}
            </span>
          );
        const [firstQuestion] = questions;
        const moreCount = questions.length - 1;
        return (
          <div
            className="kailo-row-secondary text-truncate"
            title={questions.join('\n')}
          >
            {firstQuestion}
            {moreCount > 0 && (
              <span className="kailo-badge kailo-badge--plain ml-2">
                +{moreCount}
              </span>
            )}
          </div>
        );
      },
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
            <InstructionDropdown onMoreClick={onMoreClick} data={record}>
              <MoreButton className="gray-8" />
            </InstructionDropdown>
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

  // DD-157: Kailo page header — 指令, primary 添加指令 (admins).
  const { hosted } = useKailoPage({
    title: t('instructions'),
    ready: !(loading && !data),
    actions: isAdmin
      ? [
          {
            id: 'add',
            label: t('addInstruction'),
            variant: 'primary',
            icon: 'plus',
          },
        ]
      : [],
    onAction: (id) => id === 'add' && instructionModal.openModal(),
  });

  return (
    <SimpleLayout loading={false}>
      <div className="kailo-list-page">
        <KailoToolbar
          left={
            <>
              <KnowledgeSegments active="instructions" />
              <KailoSearch
                value={search}
                placeholder={t('list.searchInstructions')}
                onChange={(q) => list.update({ q })}
              />
            </>
          }
          right={
            !hosted &&
            isAdmin && (
              <Button
                type="primary"
                onClick={() => instructionModal.openModal()}
              >
                {t('addInstruction')}
              </Button>
            )
          }
        />
        <KailoListFrame
          item="list.itemInstructions"
          loading={loading && !data}
          refreshing={loading && !!data}
          error={!data ? error : undefined}
          onRetry={() => refetch()}
          isEmpty={instructions.length === 0}
          noMatch={filtered.length === 0}
          onClearFilters={() => list.update({ q: undefined })}
          skeletonRows={list.size}
          skeletonColumns={[38, 30, 14, 10]}
          empty={
            <KailoEmpty
              icon={FileTextIcon}
              title={t('knowledge.instructionsEmptyTitle')}
              description={
                isAdmin
                  ? t('knowledge.instructionsEmptyDescription')
                  : t('list.readonlyHint')
              }
              actionLabel={isAdmin ? t('addInstruction') : undefined}
              onAction={() => instructionModal.openModal()}
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
        <InstructionDrawer
          {...instructionDrawer.state}
          onClose={instructionDrawer.closeDrawer}
        />
        <InstructionModal
          {...instructionModal.state}
          onClose={instructionModal.closeModal}
          loading={createInstructionLoading || updateInstructionLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateInstructionMutation({
                variables: { where: { id }, data },
              });
            } else {
              await createInstructionMutation({ variables: { data } });
            }
          }}
        />
      </div>
    </SimpleLayout>
  );
}

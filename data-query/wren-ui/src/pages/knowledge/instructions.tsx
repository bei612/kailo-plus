import { Button, Tag, Table, TableColumnsType, Typography } from 'antd';
import styled from 'styled-components';
import SiderLayout from '@/components/layouts/SiderLayout';
import PageLayout from '@/components/layouts/PageLayout';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import {
  EyeIcon,
  FileTextIcon,
  MessageSquareIcon,
} from '@/components/kailo/KailoIcons';
import { notify } from '@/utils/kailoHost';
import KailoUser from '@/components/kailo/KailoUser';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';
import useKailoPage from '@/hooks/useKailoPage';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { MoreButton } from '@/components/ActionButton';
import { InstructionDropdown } from '@/components/diagram/CustomDropdown';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import InstructionModal from '@/components/modals/InstructionModal';
import InstructionDrawer from '@/components/pages/knowledge/InstructionDrawer';
import { Instruction } from '@/apollo/client/graphql/__types__';
import {
  useInstructionsQuery,
  useCreateInstructionMutation,
  useUpdateInstructionMutation,
  useDeleteInstructionMutation,
} from '@/apollo/client/graphql/instructions.generated';

const { Paragraph, Text } = Typography;

const StyledQuestionsBlock = styled.div`
  margin: -2px -4px;
`;

const StyledTag = styled(Tag)`
  &.ant-tag.ant-tag {
    display: inline-block;
    margin: 2px 4px;
    max-width: 100%;
  }
`;

export default function ManageInstructions() {
  const t = useKailoText();
  // DD-133 §3: knowledge changes are Kailo Tenant admin actions.
  const { isAdmin } = useKailoSession();
  const instructionModal = useModalAction();
  const instructionDrawer = useDrawerAction();

  const { data, loading } = useInstructionsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const instructions = data?.instructions || [];

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

  const columns: TableColumnsType<Instruction> = [
    {
      title: t('knowledge.instructionDetails'),
      dataIndex: 'instruction',
      render: (instruction) => (
        <Paragraph title={instruction} ellipsis={{ rows: 3 }}>
          {instruction}
        </Paragraph>
      ),
    },
    {
      title: t('knowledge.matchingQuestions'),
      dataIndex: 'questions',
      width: '50%',
      render: (questions, record) => {
        if (record.isDefault) return <GlobalLabel />;

        const displayQuestions = questions.slice(0, 2);
        const moreCount = questions.length - 2;

        return (
          <StyledQuestionsBlock>
            {displayQuestions.map((question) => (
              <div key={question} className="mb-1">
                <StyledTag className="text-truncate">
                  <MessageSquareIcon size={12} className="gray-7 mr-1" />
                  <Text className="gray-9" title={question}>
                    {question}
                  </Text>
                </StyledTag>
              </div>
            ))}
            {moreCount > 0 && (
              <div className="text-sm gray-7 pl-1">
                {t('knowledge.moreQuestions', { count: moreCount })}
              </div>
            )}
          </StyledQuestionsBlock>
        );
      },
    },
    {
      // DD-133 §3: the Kailo user who saved it.
      title: t('owner'),
      dataIndex: 'owner',
      width: 160,
      render: (owner) => (
        <KailoUser user={owner} emptyText={t('ownerUnknown')} />
      ),
    },
    {
      title: t('knowledge.createdTime'),
      dataIndex: 'createdAt',
      width: 130,
      render: (time) => <Text className="gray-7">{getCompactTime(time)}</Text>,
    },
    {
      key: 'action',
      width: 64,
      align: 'center',
      fixed: 'right',
      render: (_, record) =>
        isAdmin ? (
          <InstructionDropdown onMoreClick={onMoreClick} data={record}>
            <MoreButton className="gray-8" />
          </InstructionDropdown>
        ) : (
          <Button
            type="text"
            size="small"
            aria-label={t('knowledge.view')}
            icon={<EyeIcon />}
            onClick={() =>
              onMoreClick({ type: MORE_ACTION.VIEW_INSTRUCTION, data: record })
            }
          />
        ),
    },
  ];

  // DD-157: Kailo page header — 指令, primary 添加指令 (admins).
  useKailoPage({
    title: t('instructions'),
    ready: !loading,
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
    <SiderLayout loading={false}>
      <PageLayout
        title={t('instructions')}
        titleExtra={
          isAdmin && (
            <Button type="primary" onClick={() => instructionModal.openModal()}>
              {t('addInstruction')}
            </Button>
          )
        }
        description={t('knowledge.instructionsDescription')}
      >
        {!loading && instructions.length === 0 ? (
          <KailoEmpty
            icon={FileTextIcon}
            title={t('knowledge.instructionsEmptyTitle')}
            description={t('knowledge.instructionsEmptyDescription')}
            actionLabel={isAdmin ? t('addInstruction') : undefined}
            onAction={() => instructionModal.openModal()}
          />
        ) : (
          <Table
            className="ant-table-has-header"
            dataSource={instructions}
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
        )}
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
      </PageLayout>
    </SiderLayout>
  );
}

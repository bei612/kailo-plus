import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import styled from 'styled-components';
import { ChevronDownIcon } from '@/components/kailo/KailoIcons';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import { MORE_ACTION } from '@/utils/enum';
import usePromptThreadStore from './store';
import useDropdown from '@/hooks/useDropdown';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { AdjustAnswerDropdown } from '@/components/diagram/CustomDropdown';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';
import { ThreadResponseAnswerStatus } from '@/apollo/client/graphql/__types__';
import useGovernedPreview from '@/hooks/useGovernedPreview';
import { getQueryPreviewText } from '@/utils/language';
import { useRouter } from 'next/router';
import { queryReceiptState } from '@/utils/queryReceipt';
import useKailoText from '@/utils/kailoI18n';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export const getAnswerIsFinished = (status: ThreadResponseAnswerStatus) =>
  [
    ThreadResponseAnswerStatus.FINISHED,
    ThreadResponseAnswerStatus.FAILED,
    ThreadResponseAnswerStatus.INTERRUPTED,
  ].includes(status);

const getIsLoadingFinished = (status: ThreadResponseAnswerStatus) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

export default function TextBasedAnswer(props: AnswerResultProps) {
  const {
    onGenerateTextBasedAnswer,
    onOpenAdjustReasoningStepsModal,
    onOpenAdjustSQLModal,
  } = usePromptThreadStore();
  const { isLastThreadResponse, onInitPreviewDone, threadResponse } = props;
  const { id } = threadResponse;
  const text = getQueryPreviewText(useRouter().locale);
  const t = useKailoText();
  const answerQuery = queryReceiptState(threadResponse.queryReceipt);
  const answerUnknown =
    answerQuery.completed && !threadResponse.answerDetail?.queryId;
  const { content, error, numRowsUsedInLLM, status, queryId } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<{
    responseId: number;
    queryId: string | null | undefined;
    content: string;
  } | null>(null);
  const adjustResultsDropdown = useDropdown();

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask();

  const sameAnswer =
    answerStreamTaskResult.responseId === id &&
    answerStreamTaskResult.queryId === queryId;
  const answerStreamTask = sameAnswer ? answerStreamTaskResult.data : '';
  const streamCompleted = sameAnswer && answerStreamTaskResult.completed;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

  // Adapt askingTask and adjustment reasoning data to dropdown
  const adjustAnswerDropdownData = useMemo(() => {
    const { payload } = threadResponse.adjustment || {};
    return {
      responseId: threadResponse.id,
      sql: threadResponse.sql,
      retrievedTables:
        threadResponse.askingTask?.retrievedTables ||
        payload?.retrievedTables ||
        [],
      sqlGenerationReasoning:
        threadResponse.askingTask?.sqlGenerationReasoning ||
        payload?.sqlGenerationReasoning ||
        '',
    };
  }, [
    threadResponse.id,
    threadResponse.sql,
    threadResponse.adjustment?.payload,
    threadResponse.askingTask?.retrievedTables,
    threadResponse.askingTask?.sqlGenerationReasoning,
  ]);

  useEffect(() => {
    setTextAnswer({
      responseId: id,
      queryId,
      content: isStreaming ? answerStreamTask : content,
    });
  }, [answerStreamTask, isStreaming, content, id, queryId]);

  useEffect(() => {
    if (isStreaming && queryId) {
      fetchAnswerStreamingTask(id, queryId);
    } else {
      answerStreamTaskResult.onReset();
    }
  }, [
    isStreaming,
    id,
    queryId,
    fetchAnswerStreamingTask,
    answerStreamTaskResult.onReset,
  ]);

  const rowsUsed = useMemo(
    () =>
      status === ThreadResponseAnswerStatus.FINISHED ? numRowsUsedInLLM : 0,
    [numRowsUsedInLLM, status],
  );

  const allowPreviewData = useMemo(() => Boolean(rowsUsed > 0), [rowsUsed]);

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });
  const query = useGovernedPreview(
    'response',
    id,
    async (where) => {
      const { id: responseId, ...identity } = where;
      const result = await previewData({
        variables: { where: { responseId, ...identity } },
      });
      return result.data?.previewData;
    },
    previewDataResult.data?.previewData,
    previewDataResult.error,
  );
  const hasPreviewData = query.completed && !!query.data;
  const onPreviewData = query.preview;

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
  };

  useEffect(() => {
    if (isLastThreadResponse) {
      if (allowPreviewData) {
        autoTriggerPreviewDataButton();
      }

      onInitPreviewDone();
    }
  }, [isLastThreadResponse, allowPreviewData]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = () => {
    setTextAnswer(null);
    onGenerateTextBasedAnswer(id);
  };

  const onMoreClick = async (payload: {
    type: MORE_ACTION;
    data: typeof adjustAnswerDropdownData;
  }) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.ADJUST_STEPS) {
      onOpenAdjustReasoningStepsModal({
        responseId: data.responseId,
        retrievedTables: data.retrievedTables,
        sqlGenerationReasoning: data.sqlGenerationReasoning,
      });
    } else if (type === MORE_ACTION.ADJUST_SQL) {
      onOpenAdjustSQLModal({ responseId: id, sql: data.sql });
    }
  };

  const adjustAnswerDropdown = (
    <AdjustAnswerDropdown
      onMoreClick={onMoreClick}
      data={adjustAnswerDropdownData}
      onDropdownVisibleChange={adjustResultsDropdown.onVisibleChange}
    >
      <Button
        className="px-0"
        type="link"
        size="small"
        icon={<EditOutlined />}
        onClick={(event) => event.stopPropagation()}
      >
        {t('home.adjustAnswer')}
        <ChevronDownIcon
          size={14}
          className="ml-1"
          style={{
            transform: adjustResultsDropdown.visible
              ? 'rotate(180deg)'
              : undefined,
          }}
        />
      </Button>
    </AdjustAnswerDropdown>
  );

  if (error) {
    return (
      <>
        <div className="py-4 px-6">
          <div className="text-right">{adjustAnswerDropdown}</div>
          <Alert
            className="mt-4 mb-2"
            message={error.shortMessage}
            description={error.message}
            type="error"
            showIcon
          />
        </div>
      </>
    );
  }

  return (
    <>
      {answerQuery.pending ? (
        <Alert type="info" message={text.pending} />
      ) : null}
      {answerUnknown ? <Alert type="warning" message={text.unknown} /> : null}
      {answerQuery.denied ? (
        <Alert type="warning" message={text.denied} />
      ) : null}
      {answerQuery.ended ? <Alert type="error" message={text.ended} /> : null}
      {answerQuery.pending || answerUnknown ? (
        <Button onClick={() => onGenerateTextBasedAnswer(id)}>
          {text.check}
        </Button>
      ) : null}
      <StyledSkeleton
        active
        loading={loading}
        paragraph={{ rows: 4 }}
        title={false}
      >
        <div className="text-md gray-10 py-4 px-6">
          <div className="text-right mb-4">{adjustAnswerDropdown}</div>
          <MarkdownBlock
            content={
              textAnswer?.responseId === id && textAnswer?.queryId === queryId
                ? textAnswer.content
                : ''
            }
          />
          {isStreaming && !streamCompleted && (
            <LoadingOutlined className="kailo-text-brand" spin />
          )}
          {status === ThreadResponseAnswerStatus.INTERRUPTED && (
            <div className="mt-2 text-right">
              <Button
                icon={<ReloadOutlined />}
                size="small"
                type="link"
                title={t('home.regenerateAnswer')}
                onClick={onRegenerateAnswer}
              >
                {t('home.regenerate')}
              </Button>
            </div>
          )}
          {allowPreviewData ? (
            <div className="mt-6">
              <Button
                size="small"
                icon={
                  <BinocularsIcon
                    style={{
                      paddingBottom: 2,
                      marginRight: 8,
                    }}
                  />
                }
                loading={previewDataResult.loading || query.preparing}
                onClick={onPreviewData}
              >
                {query.pending || query.error ? text.check : text.results}
              </Button>
              {query.storageError ? (
                <Alert type="error" message={text.storageError} />
              ) : null}
              {query.scopeError ? (
                <Alert type="error" message={text.scopeError} />
              ) : null}
              {query.pending ? (
                <Alert type="info" message={text.pending} />
              ) : null}
              {query.error ? (
                <Alert type="warning" message={text.unknown} />
              ) : null}
              {query.ended ? <Alert type="error" message={text.ended} /> : null}
              {query.denied ? (
                <Alert type="warning" message={text.denied} />
              ) : null}

              <div
                className="mt-2 mb-3"
                data-guideid="text-answer-preview-data"
              >
                {hasPreviewData && (
                  <Text type="secondary" className="text-sm">
                    {t('home.previewRowsHint')}
                  </Text>
                )}
                <PreviewData
                  error={query.error}
                  loading={
                    previewDataResult.loading ||
                    query.preparing ||
                    Boolean(query.pending)
                  }
                  previewData={query.completed ? query.data : undefined}
                />
              </div>
            </div>
          ) : (
            <>
              {!isStreaming && (
                <Alert message={t('home.noDataHint')} type="info" />
              )}
            </>
          )}
        </div>
      </StyledSkeleton>
    </>
  );
}

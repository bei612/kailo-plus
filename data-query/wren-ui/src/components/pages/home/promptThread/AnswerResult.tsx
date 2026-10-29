import { useEffect, useMemo } from 'react';
import { isEmpty, debounce } from 'lodash';
import clsx from 'clsx';
import { Button, Typography, Tabs, Tag, Tooltip } from 'antd';
import styled from 'styled-components';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import PieChartOutlined from '@ant-design/icons/PieChartOutlined';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import { RobotSVG } from '@/utils/svgs';
import { ANSWER_TAB_KEYS } from '@/utils/enum';
import { canGenerateAnswer } from '@/hooks/useAskPrompt';
import usePromptThreadStore from './store';
import { RecommendedQuestionsProps } from '@/components/pages/home/promptThread';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
} from '@/components/pages/home/RecommendedQuestions';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import ViewSQLTabContent from '@/components/pages/home/promptThread/ViewSQLTabContent';
import TextBasedAnswer, {
  getAnswerIsFinished,
} from '@/components/pages/home/promptThread/TextBasedAnswer';
import ChartAnswer from '@/components/pages/home/promptThread/ChartAnswer';
import Preparation from '@/components/pages/home/preparation';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText, { KailoTextKey } from '@/utils/kailoI18n';
import {
  AskingTaskStatus,
  ThreadResponse,
  ThreadResponseAnswerDetail,
  ThreadResponseAnswerStatus,
  ThreadResponseAdjustment,
  ThreadResponseAdjustmentType,
} from '@/apollo/client/graphql/__types__';

const { Title, Text } = Typography;

const adjustmentType: Record<ThreadResponseAdjustmentType, KailoTextKey> = {
  [ThreadResponseAdjustmentType.APPLY_SQL]: 'home.adjustmentAppliedSql',
  [ThreadResponseAdjustmentType.REASONING]: 'home.adjustmentReasoning',
};

// DD-157 (20 §13 标签页): line tabs, 2px brand underline, selected text
// 600, unselected muted; single-colour line icons.
const StyledTabs = styled(Tabs)`
  .ant-tabs-nav {
    margin-bottom: 0;
  }

  .ant-tabs-tab {
    padding: 10px 0;

    .ant-typography,
    .anticon {
      color: var(--kailo-color-muted-foreground);
    }

    &.ant-tabs-tab-active {
      .ant-typography {
        color: var(--kailo-color-foreground);
        font-weight: 600;
      }
      .anticon {
        color: var(--kailo-color-foreground);
      }
    }
  }
`;

export interface Props {
  motion: boolean;
  threadResponse: ThreadResponse;
  isLastThreadResponse: boolean;
  isOpeningQuestion: boolean;
  onInitPreviewDone: () => void;
}

const QuestionTitle = (props) => {
  const { question, className } = props;
  return (
    <Title
      className={clsx('d-flex mt-0', className)}
      level={4}
      style={{ fontSize: 17, lineHeight: '24px', fontWeight: 600 }}
    >
      <MessageOutlined className="gray-7 mt-1 mr-3" />
      <Text className="gray-10">{question}</Text>
    </Title>
  );
};

const renderRecommendedQuestions = (
  isLastThreadResponse: boolean,
  recommendedQuestionProps,
  onSelect: RecommendedQuestionsProps['onSelect'],
) => {
  if (!isLastThreadResponse || !recommendedQuestionProps.show) return null;

  return (
    <RecommendedQuestions
      className="mt-5 mb-4"
      {...recommendedQuestionProps.state}
      onSelect={onSelect}
    />
  );
};

const AdjustmentInformation = (props: {
  adjustment: ThreadResponseAdjustment;
}) => {
  const { adjustment } = props;
  const t = useKailoText();
  const typeKey = adjustmentType[adjustment.type];

  return (
    <div className="kailo-soft-block gray-7 py-2 px-3 mb-2">
      <div className="d-flex align-center gx-2">
        <ShareAltOutlined className="gray-7" />
        <div className="flex-grow-1 gray-7">
          {t('home.adjustedAnswer')}
          <Tag className="ml-3">{typeKey ? t(typeKey) : adjustment.type}</Tag>
        </div>
      </div>
    </div>
  );
};

const isNeedGenerateAnswer = (answerDetail: ThreadResponseAnswerDetail) => {
  const isFinished = getAnswerIsFinished(answerDetail?.status);
  // it means the background task has not started yet, but answer is pending for generating
  const isProcessing = [
    ThreadResponseAnswerStatus.NOT_STARTED,
    ThreadResponseAnswerStatus.PREPROCESSING,
    ThreadResponseAnswerStatus.FETCHING_DATA,
  ].includes(answerDetail?.status);
  return answerDetail?.queryId === null && !isFinished && !isProcessing;
};

export default function AnswerResult(props: Props) {
  const { threadResponse, isLastThreadResponse, isOpeningQuestion } = props;
  // DD-133 §3: knowledge and views are Kailo Tenant admin changes.
  const { isAdmin } = useKailoSession();
  const t = useKailoText();

  const {
    onOpenSaveAsViewModal,
    onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer,
    onGenerateChartAnswer,
    onOpenSaveToKnowledgeModal,
    // recommend questions
    recommendedQuestions,
    showRecommendedQuestions,
    onSelectRecommendedQuestion,
    preparation,
  } = usePromptThreadStore();

  const {
    askingTask,
    adjustmentTask,
    answerDetail,
    breakdownDetail,
    id,
    question,
    sql,
    view,
    adjustment,
  } = threadResponse;

  const resultStyle = isLastThreadResponse
    ? { minHeight: 'calc(100vh - (194px))' }
    : null;

  const isAdjustment = !!adjustment;

  const recommendedQuestionProps = getRecommendedQuestionProps(
    recommendedQuestions,
    showRecommendedQuestions,
  );

  const isAnswerPrepared = !!answerDetail?.queryId || !!answerDetail?.status;
  const isBreakdownOnly = useMemo(() => {
    // we support rendering different types of answers now, so we need to check if it's old data.
    // existing thread response's answerDetail is null.
    return answerDetail === null && !isEmpty(breakdownDetail);
  }, [answerDetail, breakdownDetail]);

  // initialize generate answer
  useEffect(() => {
    if (isBreakdownOnly) return;
    if (
      canGenerateAnswer(askingTask, adjustmentTask) &&
      isNeedGenerateAnswer(answerDetail)
    ) {
      const debouncedGenerateAnswer = debounce(
        () => {
          onGenerateTextBasedAnswer(id);
          if (isLastThreadResponse) onGenerateThreadRecommendedQuestions(id);
        },
        250,
        { leading: false, trailing: true },
      );
      debouncedGenerateAnswer();

      return () => {
        debouncedGenerateAnswer.cancel();
      };
    }
  }, [
    isBreakdownOnly,
    isLastThreadResponse,
    askingTask?.status,
    adjustmentTask?.status,
    answerDetail?.status,
  ]);

  const onTabClick = (activeKey: string) => {
    if (activeKey === ANSWER_TAB_KEYS.CHART && !threadResponse.chartDetail) {
      onGenerateChartAnswer(id);
    }
  };

  const showAnswerTabs =
    askingTask?.status === AskingTaskStatus.FINISHED ||
    isAnswerPrepared ||
    isBreakdownOnly;

  const rephrasedQuestion =
    threadResponse?.askingTask?.rephrasedQuestion || question;

  const questionForSaveAsView = useMemo(() => {
    // use rephrased question for follow-up questions, otherwise use the original question

    if (isOpeningQuestion) return question;

    return rephrasedQuestion;
  }, [rephrasedQuestion, question, isOpeningQuestion]);

  return (
    <div style={resultStyle} data-jsid="answerResult">
      {isAdjustment && <AdjustmentInformation adjustment={adjustment} />}
      <QuestionTitle className="mb-4" question={question} />
      <Preparation
        className="mb-3"
        {...preparation}
        data={threadResponse}
        minimized={isAnswerPrepared}
      />
      {showAnswerTabs && (
        <>
          <StyledTabs size="small" onTabClick={onTabClick}>
            {!isBreakdownOnly && (
              <Tabs.TabPane
                key={ANSWER_TAB_KEYS.ANSWER}
                tab={
                  <div className="select-none">
                    <CheckCircleOutlined className="mr-2" />
                    <Text>{t('home.tabAnswer')}</Text>
                  </div>
                }
              >
                <TextBasedAnswer {...props} />
              </Tabs.TabPane>
            )}
            <Tabs.TabPane
              key={ANSWER_TAB_KEYS.VIEW_SQL}
              tab={
                <div className="select-none">
                  <CodeOutlined className="mr-2" />
                  <Text>{t('home.tabViewSql')}</Text>
                </div>
              }
            >
              <ViewSQLTabContent {...props} />
            </Tabs.TabPane>
            <Tabs.TabPane
              key="chart"
              tab={
                <div className="select-none">
                  <PieChartOutlined className="mr-2" />
                  <Text>{t('home.tabChart')}</Text>
                </div>
              }
            >
              <ChartAnswer {...props} />
            </Tabs.TabPane>
          </StyledTabs>
          {isAdmin && (
            <div className="mt-2 d-flex align-center">
              <Tooltip
                overlayInnerStyle={{ width: 'max-content' }}
                placement="topLeft"
                title={t('home.saveToKnowledgeHint')}
              >
                <Button
                  type="link"
                  size="small"
                  className="mr-2"
                  onClick={() =>
                    onOpenSaveToKnowledgeModal(
                      {
                        question: rephrasedQuestion,
                        sql,
                      },
                      { isCreateMode: true },
                    )
                  }
                  data-guideid="save-to-knowledge"
                >
                  <div className="d-flex align-center">
                    <RobotSVG className="mr-2" />
                    {t('home.saveToKnowledge')}
                  </div>
                </Button>
              </Tooltip>
              <ViewBlock
                view={view}
                onClick={() =>
                  onOpenSaveAsViewModal(
                    { sql, responseId: id },
                    {
                      rephrasedQuestion: questionForSaveAsView,
                    },
                  )
                }
              />
            </div>
          )}
          {renderRecommendedQuestions(
            isLastThreadResponse,
            recommendedQuestionProps,
            onSelectRecommendedQuestion,
          )}
        </>
      )}
    </div>
  );
}

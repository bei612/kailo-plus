import { useState, useMemo } from 'react';
import clsx from 'clsx';
import styled from 'styled-components';
import { Space, Button, Row, Col } from 'antd';
import ColumnHeightOutlined from '@ant-design/icons/ColumnHeightOutlined';
import MinusOutlined from '@ant-design/icons/MinusOutlined';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import { Logo } from '@/components/Logo';
import { makeIterable } from '@/utils/iteration';
import { GroupedQuestion } from '@/hooks/useRecommendedQuestionsInstruction';
import useKailoText from '@/utils/kailoI18n';

// DD-157 (20 §13 卡片): card surface, 1px line, radius 12, no shadow;
// clickable cards lift with shadow-sm on hover.
const CategorySectionBlock = styled.div`
  background: var(--kailo-color-card);
  border: 1px solid var(--kailo-color-border);
  border-radius: 12px;
  padding: 16px;
`;

const QuestionBlock = styled.div`
  background: var(--kailo-color-card);
  color: var(--kailo-color-foreground);
  user-select: none;
  height: 150px;
  border-radius: 12px !important;
  transition:
    border-color var(--kailo-duration-fast) var(--kailo-ease-standard),
    box-shadow var(--kailo-duration-fast) var(--kailo-ease-standard),
    transform var(--kailo-duration-fast) var(--kailo-ease-standard);

  &:hover:not(.is-disabled) {
    border-color: var(--kailo-color-line-strong) !important;
    box-shadow: var(--kailo-shadow-sm);
    transform: translateY(-1px);
  }

  &.is-active {
    border-color: var(--kailo-color-brand) !important;
  }

  &.is-disabled {
    opacity: 0.8;
  }
`;

const MAX_EXPANDED_QUESTIONS = 9;

interface Props {
  onSelect: (payload: { sql: string; question: string }) => void;
  recommendedQuestions: GroupedQuestion[];
  loading: boolean;
}

const QuestionTemplate = ({
  category,
  sql,
  question,
  onSelect,
  loading,
  selectedQuestion,
}) => {
  const isSelected = selectedQuestion === question;
  const isDisabled = loading && !isSelected;

  const onClick = () => {
    if (loading) return;
    onSelect({ sql, question });
  };

  return (
    <Col span={8}>
      <QuestionBlock
        className={clsx(
          'border border-gray-5 rounded px-3 pt-3 pb-4',
          loading ? 'cursor-wait' : 'cursor-pointer',
          {
            'is-active': isSelected,
            'is-disabled cursor-not-allowed': isDisabled,
          },
        )}
        onClick={onClick}
      >
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div className="kailo-tag text-truncate" title={category}>
            {category}
          </div>
          {isSelected && loading && <LoadingOutlined className="ml-1 gray-7" />}
        </div>
        <EllipsisWrapper multipleLine={4} text={question} />
      </QuestionBlock>
    </Col>
  );
};

const QuestionColumnIterator = makeIterable(QuestionTemplate);

export default function RecommendedQuestionsPrompt(props: Props) {
  const { onSelect, recommendedQuestions, loading } = props;
  const t = useKailoText();

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');

  const questionList = useMemo(() => {
    return recommendedQuestions.slice(
      0,
      isExpanded ? undefined : MAX_EXPANDED_QUESTIONS,
    );
  }, [recommendedQuestions, isExpanded]);

  const onHandleToggle = () => setIsExpanded((prev) => !prev);

  const showExpandButton = recommendedQuestions.length > MAX_EXPANDED_QUESTIONS;

  const onSelectQuestion = (payload: { sql: string; question: string }) => {
    onSelect(payload);
    setSelectedQuestion(payload.question);
  };

  return (
    <div className="px-10 py-6">
      <div className="d-flex align-center mb-3">
        <Logo size={24} />
        <div className="kailo-section-title mx-3">{t('askAboutData')}</div>
        <div className="gray-7">{t('tryAsking')}</div>
      </div>
      <Space
        style={{ width: 680 }}
        className="gray-8"
        direction="vertical"
        size={[0, 16]}
      >
        <CategorySectionBlock>
          <Row gutter={[16, 16]} className="mt-3">
            <QuestionColumnIterator
              data={questionList}
              onSelect={onSelectQuestion}
              loading={loading}
              selectedQuestion={selectedQuestion}
            />
          </Row>
          {showExpandButton && (
            <div className="text-right">
              <Button
                onClick={() => onHandleToggle()}
                className="gray-7 mt-3"
                type="text"
                size="small"
                icon={isExpanded ? <MinusOutlined /> : <ColumnHeightOutlined />}
              >
                {isExpanded ? t('home.collapse') : t('home.expandAll')}
              </Button>
            </div>
          )}
        </CategorySectionBlock>
      </Space>
    </div>
  );
}

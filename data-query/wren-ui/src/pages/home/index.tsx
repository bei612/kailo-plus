import { ComponentRef, useRef } from 'react';
import { useRouter } from 'next/router';
import { Button, Typography } from 'antd';
import { Logo } from '@/components/Logo';
import { Path } from '@/utils/enum';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useAskPrompt from '@/hooks/useAskPrompt';
import useRecommendedQuestionsInstruction from '@/hooks/useRecommendedQuestionsInstruction';
import RecommendedQuestionsPrompt from '@/components/pages/home/prompt/RecommendedQuestionsPrompt';
import {
  useCreateThreadMutation,
  useThreadLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import useKailoSession from '@/hooks/useKailoSession';
import useKailoText from '@/utils/kailoI18n';
import useKailoPage from '@/hooks/useKailoPage';
import { CreateThreadInput } from '@/apollo/client/graphql/__types__';

const { Text } = Typography;

const Wrapper = ({ children }) => {
  const t = useKailoText();
  return (
    <div
      className="d-flex align-center justify-center flex-column"
      style={{ height: '100%' }}
    >
      <Logo size={48} />
      <div className="kailo-empty__title mt-3">{t('askAboutData')}</div>
      {children}
    </div>
  );
};

function RecommendedQuestionsInstruction(props) {
  const { onSelect, loading } = props;

  const {
    buttonProps,
    generating,
    recommendedQuestions,
    showRetry,
    showRecommendedQuestionsPromptMode,
  } = useRecommendedQuestionsInstruction();
  // DD-133 §3: generating the project's recommended questions writes project
  // state (Core `manage` / Kailo Tenant admin); members ask directly.
  const { isAdmin } = useKailoSession();
  const t = useKailoText();

  return showRecommendedQuestionsPromptMode ? (
    <div
      className="d-flex align-center flex-column pt-10"
      style={{ margin: 'auto' }}
    >
      <RecommendedQuestionsPrompt
        recommendedQuestions={recommendedQuestions}
        onSelect={onSelect}
        loading={loading}
      />
      <div className="py-12" />
    </div>
  ) : (
    <Wrapper>
      {isAdmin && <Button className="mt-6" {...buttonProps} />}
      {generating && (
        <Text className="mt-3 text-sm gray-7">
          {t('home.generatingQuestions')}
        </Text>
      )}
      {!generating && showRetry && (
        <Text className="mt-3 text-sm gray-7 text-center">
          {t('home.questionsUnavailable')}
        </Text>
      )}
    </Wrapper>
  );
}

export default function Home() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const homeSidebar = useHomeSidebar();
  const askPrompt = useAskPrompt();
  const t = useKailoText();

  // DD-157: Kailo page header — 新对话, primary 新建对话 (starts over).
  useKailoPage({
    title: t('newConversation'),
    actions: [
      {
        id: 'new-conversation',
        label: t('newConversationAction'),
        variant: 'primary',
        icon: 'message-square-plus',
      },
    ],
    onAction: (id) => {
      if (id !== 'new-conversation') return;
      $prompt.current?.close();
      router.push(Path.Home);
    },
  });

  const [createThread, { loading: threadCreating }] = useCreateThreadMutation({
    onError: (error) => console.error(error),
    onCompleted: () => homeSidebar.refetch(),
  });
  const [preloadThread] = useThreadLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  const onCreateResponse = async (payload: CreateThreadInput) => {
    try {
      askPrompt.onStopPolling();
      const response = await createThread({ variables: { data: payload } });
      const threadId = response.data.createThread.id;
      await preloadThread({ variables: { threadId } });
      router.push(Path.Home + `/${threadId}`);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      {/* DD-133 §1: the upstream sample-dataset questions are not offered. */}
      <RecommendedQuestionsInstruction
        onSelect={onCreateResponse}
        loading={threadCreating}
      />
      <Prompt
        ref={$prompt}
        {...askPrompt}
        onCreateResponse={onCreateResponse}
      />
    </SiderLayout>
  );
}

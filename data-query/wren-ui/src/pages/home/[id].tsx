import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isEmpty } from 'lodash';
import { Button } from 'antd';
import { notify } from '@/utils/kailoHost';
import { ShareIcon } from '@/components/kailo/KailoIcons';
import client from '@/apollo/client';
import { LIST_VIEWS } from '@/apollo/client/graphql/view';
import { runNativeMetadataWrite } from '@/utils/errorHandler';
import { Path } from '@/utils/enum';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt, {
  getIsFinished,
  canFetchThreadResponse,
  isRecommendedFinished,
} from '@/hooks/useAskPrompt';
import useAdjustAnswer from '@/hooks/useAdjustAnswer';
import useModalAction from '@/hooks/useModalAction';
import PromptThread from '@/components/pages/home/promptThread';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import AdjustReasoningStepsModal from '@/components/modals/AdjustReasoningStepsModal';
import AdjustSQLModal from '@/components/modals/AdjustSQLModal';
import { useKailoShare } from '@/components/kailo/KailoShare';
import useKailoPage from '@/hooks/useKailoPage';
import useKailoText from '@/utils/kailoI18n';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import { getIsChartFinished } from '@/components/pages/home/promptThread/ChartAnswer';
import { PromptThreadProvider } from '@/components/pages/home/promptThread/store';
import {
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
  useUpdateThreadResponseMutation,
  useGenerateThreadRecommendationQuestionsMutation,
  useGetThreadRecommendationQuestionsLazyQuery,
  useGenerateThreadResponseAnswerMutation,
  useGenerateThreadResponseChartMutation,
  useAdjustThreadResponseChartMutation,
} from '@/apollo/client/graphql/home.generated';
import { useCreateViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  AdjustThreadResponseChartInput,
  CreateThreadResponseInput,
  ThreadResponse,
  CreateSqlPairInput,
} from '@/apollo/client/graphql/__types__';
import { useCreateSqlPairMutation } from '@/apollo/client/graphql/sqlPairs.generated';
import { v4 as uuidv4 } from 'uuid';
import { getUserConfig } from '@/utils/env';
import { queryReceiptState } from '@/utils/queryReceipt';
import useGovernedSqlPreview from '@/hooks/useGovernedSqlPreview';
import { getQueryPreviewText } from '@/utils/language';

// Reuse the original response polling cadence for the admitted SQL receipt.
const RESPONSE_POLL_INTERVAL = 1000;

const getThreadResponseIsFinished = (threadResponse: ThreadResponse) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  // it means it's the old data before support text based answer
  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  // false make it keep polling when the text based answer is default needed.
  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  // answerDetail status can be FAILED before getting queryId from Wren AI adapter
  if (answerDetail?.queryId || answerDetail?.status) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (chartDetail?.queryId || chartDetail?.status) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }
  // if equal false, it means it has task & the task is not finished
  return isAnswerFinished !== false && isChartFinished !== false;
};

// Public config correlates an original observation; server admission remains
// authoritative. A missing governed identity never selects standalone mode.
function operationConfiguration(
  config: Awaited<ReturnType<typeof getUserConfig>>,
) {
  if (
    config.nativeBindingConfigured === false &&
    config.queryScope === undefined &&
    config.nativeBindingGeneration === undefined
  )
    return 'standalone';
  if (
    config.nativeBindingConfigured !== true ||
    !/^[a-f0-9]{64}$/.test(config.queryScope ?? '') ||
    !Number.isSafeInteger(config.nativeBindingGeneration) ||
    config.nativeBindingGeneration <= 0
  )
    throw new Error('NATIVE_AUTHENTICATION_REQUIRED');
  return `${config.queryScope}:${config.nativeBindingGeneration}`;
}

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const params = useParams();
  const homeSidebar = useHomeSidebar();
  const threadId = useMemo(() => Number(params?.id) || null, [params]);
  const t = useKailoText();
  const share = useKailoShare(threadId !== null ? { threadId } : null);
  const askPrompt = useAskPrompt(threadId);
  const adjustAnswer = useAdjustAnswer(threadId);
  const saveAsViewModal = useModalAction();
  const saveViewQuery = useGovernedSqlPreview(
    saveAsViewModal.state.defaultValue?.sql,
    !!saveAsViewModal.state.visible,
  );
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();
  const answerRequests = useRef(new Set<string>());
  const answerGeneration = useRef(0);
  const answerOwner = useMemo(() => ({ active: true }), [threadId]);
  const answerOwnerRef = useRef(answerOwner);
  answerOwnerRef.current = answerOwner;
  const sqlFix = useMemo(() => ({ pending: undefined as Promise<void> | undefined }), [answerOwner]);
  const [fixingSqlOwner, setFixingSqlOwner] = useState<typeof answerOwner | null>(null);
  const [answerReceipts, setAnswerReceipts] = useState<Record<number, any>>({});
  const [chartReceipts, setChartReceipts] = useState<Record<number, any>>({});

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);

  const [createViewMutation, { loading: creating }] = useCreateViewMutation();

  const { data, updateQuery: updateThreadQuery } = useThreadQuery({
    variables: { threadId },
    fetchPolicy: 'cache-and-network',
    skip: threadId === null,
    onError: () => router.push(Path.Home),
  });
  const [createThreadResponse] = useCreateThreadResponseMutation({
    onError: (error) => console.error(error),
    onCompleted(next) {
      const nextResponse = next.createThreadResponse;
      updateThreadQuery((prev) => {
        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: [...prev.thread.responses, nextResponse],
          },
        };
      });
    },
  });
  const [updateThreadResponse, { loading: threadResponseUpdating }] =
    useUpdateThreadResponseMutation({
      onError: (error) => console.error(error),
    });
  const [readThreadResponse] = useThreadResponseLazyQuery({
    fetchPolicy: 'no-cache',
  });
  const responseObservation = useRef<{
    owner: typeof answerOwner;
    responseId: number;
    identity?: string;
    timer?: number;
    pending?: Promise<void>;
  } | null>(null);
  const [observedResponse, setObservedResponse] = useState<{
    owner: typeof answerOwner;
    response: ThreadResponse;
  } | null>(null);
  const stopThreadResponsePolling = useCallback(() => {
    const observation = responseObservation.current;
    if (observation?.owner !== answerOwner) return;
    responseObservation.current = null;
    if (observation.timer !== undefined) window.clearTimeout(observation.timer);
  }, [answerOwner]);
  const fetchThreadResponse = useCallback(
    (options: { variables: { responseId: number } }) => {
      if (!answerOwner.active || answerOwnerRef.current !== answerOwner) return;
      const { responseId } = options.variables;
      const previous = responseObservation.current;
      if (previous?.owner === answerOwner && previous.responseId === responseId)
        return previous.pending;
      if (previous?.timer !== undefined) window.clearTimeout(previous.timer);
      const observation: NonNullable<typeof responseObservation.current> = {
        owner: answerOwner,
        responseId,
      };
      responseObservation.current = observation;
      setObservedResponse(null);
      const active = () =>
        answerOwner.active &&
        answerOwnerRef.current === answerOwner &&
        responseObservation.current === observation;
      const observe = async () => {
        if (!active()) return;
        try {
          const before = operationConfiguration(await getUserConfig());
          if (!active()) return;
          if (
            observation.identity !== undefined &&
            observation.identity !== before
          ) {
            responseObservation.current = null;
            return;
          }
          observation.identity = before;
          // Apollo's hook-level completion callback follows its latest render.
          // Consume this exact read promise instead, with no shared cache/dedup
          // result standing in for this owner's fresh original response read.
          const result = await readThreadResponse({
            variables: { responseId },
            fetchPolicy: 'no-cache',
            context: { queryDeduplication: false },
          });
          const after = operationConfiguration(await getUserConfig());
          if (!active()) return;
          if (after !== observation.identity) {
            responseObservation.current = null;
            return;
          }
          const next = result.data?.threadResponse;
          if (
            !result.error &&
            next?.id === responseId &&
            next.threadId === threadId
          ) {
            setObservedResponse({ owner: answerOwner, response: next });
            updateThreadQuery((prev) =>
              !active() || String(prev.thread?.id) !== String(threadId)
                ? prev
                : {
                    ...prev,
                    thread: {
                      ...prev.thread,
                      responses: prev.thread.responses.map((response) =>
                        response.id === responseId ? next : response,
                      ),
                    },
                  },
            );
            if (getThreadResponseIsFinished(next)) {
              responseObservation.current = null;
              return;
            }
          }
        } catch {
          // A missing read is not a new generation or terminal failure. Continue
          // only this original read at its existing interval while still owned.
        }
        if (active())
          observation.timer = window.setTimeout(() => {
            observation.timer = undefined;
            observation.pending = observe();
          }, RESPONSE_POLL_INTERVAL);
      };
      observation.pending = observe();
      return observation.pending;
    },
    [answerOwner, readThreadResponse, threadId, updateThreadQuery],
  );

  const [generateThreadRecommendationQuestions] =
    useGenerateThreadRecommendationQuestionsMutation({
      onError: (error) => console.error(error),
    });

  const [
    fetchThreadRecommendationQuestions,
    threadRecommendationQuestionsResult,
  ] = useGetThreadRecommendationQuestionsLazyQuery({
    pollInterval: 1000,
  });

  const [generateThreadResponseAnswer] =
    useGenerateThreadResponseAnswerMutation({
      onError: (error) => console.error(error),
    });

  const [generateThreadResponseChart] = useGenerateThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });
  const [adjustThreadResponseChart] = useAdjustThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });

  const [createSqlPairMutation, { loading: createSqlPairLoading }] =
    useCreateSqlPairMutation({
      refetchQueries: ['SqlPairs'],
      awaitRefetchQueries: true,
    });

  const thread = useMemo(() => data?.thread || null, [data]);
  const responses = useMemo(
    () =>
      (thread?.responses || []).map((response) => ({
        ...response,
        queryReceipt: answerReceipts[response.id],
        chartQueryReceipt: chartReceipts[response.id],
      })),
    [thread, answerReceipts, chartReceipts],
  );
  const pollingResponse =
    observedResponse?.owner === answerOwner ? observedResponse.response : null;
  const isPollingResponseFinished = useMemo(
    () => getThreadResponseIsFinished(pollingResponse),
    [pollingResponse],
  );

  const onFixSQLStatement = (responseId: number, sql: string): Promise<void> => {
    const active = () =>
      answerOwner.active && answerOwnerRef.current === answerOwner;
    if (!active()) return Promise.resolve();
    if (sqlFix.pending) return sqlFix.pending;
    setFixingSqlOwner(answerOwner);
    const run = async () => {
      try {
        const identity = operationConfiguration(await getUserConfig());
        if (!active()) return;
        // Apollo does not await async completion callbacks. Keep the original
        // modal's submit promise pending through the current-identity read.
        const result = await updateThreadResponse({
          variables: { where: { id: responseId }, data: { sql } },
          fetchPolicy: 'no-cache',
        });
        if (!active()) return;
        const next = result.data?.updateThreadResponse;
        if (result.errors?.length || !next)
          throw new Error('NATIVE_OUTCOME_UNKNOWN');
        const current = operationConfiguration(await getUserConfig());
        if (!active()) return;
        if (current !== identity || next.id !== responseId || next.threadId !== threadId)
          throw new Error('NATIVE_OUTCOME_UNKNOWN');
        updateThreadQuery((prev) =>
          !active() || String(prev.thread?.id) !== String(threadId)
            ? prev
            : {
                ...prev,
                thread: {
                  ...prev.thread,
                  responses: prev.thread.responses.map((response) =>
                    response.id === responseId ? next : response,
                  ),
                },
              },
        );
        notify.success(t('home.sqlUpdated'));
        onGenerateThreadResponseAnswer(responseId);
      } finally {
        sqlFix.pending = undefined;
        if (active()) setFixingSqlOwner(null);
      }
    };
    sqlFix.pending = run();
    return sqlFix.pending;
  };

  const generateResponseArtifact = async (
    responseId: number,
    artifact: 'answer' | 'chart',
    adjustment?: AdjustThreadResponseChartInput,
  ) => {
    if (!answerOwner.active || answerOwnerRef.current !== answerOwner) return;
    const request = `${artifact}.${responseId}`;
    if (answerRequests.current.has(request)) return;
    answerRequests.current.add(request);
    const generation = answerGeneration.current;
    const active = () =>
      answerOwner.active &&
      answerOwnerRef.current === answerOwner &&
      generation === answerGeneration.current;
    const publishReceipt =
      artifact === 'answer' ? setAnswerReceipts : setChartReceipts;
    const create = async (identity: {
      idempotencyKey?: string;
      idempotencyScope?: string;
    }): Promise<ThreadResponse | undefined> => {
      if (artifact === 'answer')
        return (
          await generateThreadResponseAnswer({
            variables: { responseId, ...identity },
            fetchPolicy: 'no-cache',
          })
        ).data?.generateThreadResponseAnswer;
      if (adjustment)
        return (
          await adjustThreadResponseChart({
            variables: { responseId, data: adjustment, ...identity },
            fetchPolicy: 'no-cache',
          })
        ).data?.adjustThreadResponseChart;
      return (
        await generateThreadResponseChart({
          variables: { responseId, ...identity },
          fetchPolicy: 'no-cache',
        })
      ).data?.generateThreadResponseChart;
    };
    try {
      const config = await getUserConfig();
      if (!active()) return;
      const identity = operationConfiguration(config);
      const scope = config.queryScope;
      const sameConfiguration = (
        current: Awaited<ReturnType<typeof getUserConfig>>,
      ) => operationConfiguration(current) === identity;
      if (config.nativeBindingConfigured === false) {
        await create({});
        const current = await getUserConfig();
        if (!active() || !sameConfiguration(current)) return;
        fetchThreadResponse({ variables: { responseId } });
        return;
      }
      const slot = `kailo.query.${artifact}${adjustment ? '.adjust' : ''}.${scope}.${responseId}`;
      const key = sessionStorage.getItem(slot) || uuidv4();
      sessionStorage.setItem(slot, key);
      while (active()) {
        const beforeDispatch = await getUserConfig();
        if (!active() || !sameConfiguration(beforeDispatch)) return;
        const response = await create({
          idempotencyKey: key,
          idempotencyScope: scope,
        });
        const afterDispatch = await getUserConfig();
        if (!active() || !sameConfiguration(afterDispatch)) return;
        if (response?.id === responseId)
          updateThreadQuery((previous) => ({
            ...previous,
            thread: {
              ...previous.thread,
              responses: previous.thread.responses.map((current) =>
                current.id === responseId
                  ? { ...current, ...response }
                  : current,
              ),
            },
          }));
        const receipt =
          artifact === 'answer'
            ? response?.queryReceipt
            : response?.chartQueryReceipt;
        publishReceipt((current) => ({
          ...current,
          [responseId]: receipt || {},
        }));
        const state = queryReceiptState(receipt);
        const detail =
          artifact === 'answer'
            ? response?.answerDetail
            : response?.chartDetail;
        if (state.completed && detail?.queryId) {
          if (sessionStorage.getItem(slot) === key)
            sessionStorage.removeItem(slot);
          fetchThreadResponse({ variables: { responseId } });
          return;
        }
        if (state.ended || state.denied) {
          if (sessionStorage.getItem(slot) === key)
            sessionStorage.removeItem(slot);
          return;
        }
        // UNKNOWN, malformed evidence and lost AI-create acknowledgement keep
        // this exact opaque key. No SQL, data or token is stored in the browser.
        await new Promise((resolve) =>
          window.setTimeout(resolve, RESPONSE_POLL_INTERVAL),
        );
      }
    } catch {
      // A lost transport/storage acknowledgement cannot authorize another key.
      if (active())
        publishReceipt((current) => ({ ...current, [responseId]: {} }));
    } finally {
      answerRequests.current.delete(request);
    }
  };

  const onGenerateThreadResponseAnswer = (responseId: number) =>
    generateResponseArtifact(responseId, 'answer');

  const onGenerateThreadResponseChart = async (responseId: number) => {
    await generateResponseArtifact(responseId, 'chart');
  };

  const onAdjustThreadResponseChart = async (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => {
    await generateResponseArtifact(responseId, 'chart', data);
  };

  const onGenerateThreadRecommendedQuestions = async () => {
    await generateThreadRecommendationQuestions({ variables: { threadId } });
    fetchThreadRecommendationQuestions({ variables: { threadId } });
  };

  const handleUnfinishedTasks = useCallback(
    (responses: ThreadResponse[]) => {
      // unfinished asking task
      const unfinishedAskingResponse = (responses || []).find(
        (response) =>
          response?.askingTask && !getIsFinished(response?.askingTask?.status),
      );
      if (unfinishedAskingResponse) {
        askPrompt.onFetching(unfinishedAskingResponse?.askingTask?.queryId);
        return;
      }

      // unfinished thread response
      const unfinishedThreadResponse = (responses || []).find(
        (response) => !getThreadResponseIsFinished(response),
      );

      if (
        canFetchThreadResponse(unfinishedThreadResponse?.askingTask) &&
        unfinishedThreadResponse
      ) {
        fetchThreadResponse({
          variables: { responseId: unfinishedThreadResponse.id },
        });
      }
    },
    [askPrompt, fetchThreadResponse],
  );

  // store thread questions for instant recommended questions
  const storeQuestionsToAskPrompt = useCallback(
    (responses: ThreadResponse[]) => {
      const questions = responses.flatMap((res) => res.question || []);
      if (questions) askPrompt.onStoreThreadQuestions(questions);
    },
    [askPrompt],
  );

  // stop all requests when change thread
  useEffect(() => {
    answerOwner.active = true;
    if (threadId !== null) {
      fetchThreadRecommendationQuestions({ variables: { threadId } });
      setShowRecommendedQuestions(true);
    }
    return () => {
      answerOwner.active = false;
      ++answerGeneration.current;
      askPrompt.onStopPolling();
      stopThreadResponsePolling();
      threadRecommendationQuestionsResult.stopPolling();
      $prompt.current?.close();
    };
  }, [threadId]);

  // initialize asking task
  useEffect(() => {
    if (!responses) return;
    handleUnfinishedTasks(responses);
    storeQuestionsToAskPrompt(responses);
  }, [responses]);

  useEffect(() => {
    if (pollingResponse && isPollingResponseFinished) {
      stopThreadResponsePolling();
      setShowRecommendedQuestions(true);
    }
  }, [isPollingResponseFinished]);

  const recommendedQuestions = useMemo(
    () =>
      threadRecommendationQuestionsResult.data
        ?.getThreadRecommendationQuestions || null,
    [threadRecommendationQuestionsResult.data],
  );

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      threadRecommendationQuestionsResult.stopPolling();
    }
  }, [recommendedQuestions]);

  const onCreateResponse = async (payload: CreateThreadResponseInput) => {
    try {
      askPrompt.onStopPolling();

      const threadId = thread.id;
      await createThreadResponse({
        variables: { threadId, data: payload },
      });
      setShowRecommendedQuestions(false);
    } catch (error) {
      console.error(error);
    }
  };

  const providerValue = {
    data: thread ? { ...thread, responses } : thread,
    recommendedQuestions,
    showRecommendedQuestions,
    preparation: {
      askingStreamTask: askPrompt.data?.askingStreamTask,
      onStopAskingTask: askPrompt.onStop,
      onReRunAskingTask: askPrompt.onReRun,
      onStopAdjustTask: adjustAnswer.onStop,
      onReRunAdjustTask: adjustAnswer.onReRun,
      onFixSQLStatement,
      fixStatementLoading: threadResponseUpdating || fixingSqlOwner === answerOwner,
    },
    onOpenSaveAsViewModal: saveAsViewModal.openModal,
    onSelectRecommendedQuestion: onCreateResponse,
    onGenerateThreadRecommendedQuestions: onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
    onGenerateChartAnswer: onGenerateThreadResponseChart,
    onAdjustChartAnswer: onAdjustThreadResponseChart,
    onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
    onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
    onOpenAdjustSQLModal: adjustSqlModal.openModal,
  };

  // DD-157: Kailo page header — the conversation's summary as title, 分享
  // (DD-138(4), 07 §4.8.3: notify Kailo members) and 新建对话.
  const threadTitle =
    homeSidebar.data?.threads?.find((thread) => thread.id === String(threadId))
      ?.name || data?.thread?.responses?.[0]?.question;
  const { hosted } = useKailoPage({
    title: threadTitle || t('threads'),
    ready: !!data?.thread,
    actions: [
      ...(share.available
        ? [
            {
              id: 'share',
              label: t('share'),
              variant: 'secondary' as const,
              icon: 'share' as const,
            },
          ]
        : []),
      {
        id: 'new-conversation',
        label: t('newConversationAction'),
        variant: 'primary',
        icon: 'message-square-plus',
      },
    ],
    onAction: (id) => {
      if (id === 'share') share.open();
      if (id === 'new-conversation') router.push(Path.Home);
    },
  });

  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      {!hosted && share.available && (
        <div className="d-flex justify-end px-4 pt-3">
          <Button icon={<ShareIcon className="mr-1" />} onClick={share.open}>
            {t('share')}
          </Button>
        </div>
      )}
      {share.modal}
      <PromptThreadProvider value={providerValue}>
        <PromptThread />
      </PromptThreadProvider>

      <div className="py-12" />
      <Prompt
        ref={$prompt}
        {...askPrompt}
        onCreateResponse={onCreateResponse}
      />
      <SaveAsViewModal
        {...saveAsViewModal.state}
        loading={creating}
        onClose={saveAsViewModal.closeModal}
        onSubmit={async (values) => {
          let queryHistoryId: string | undefined;
          await runNativeMetadataWrite({
            nativeType: 'view',
            variables: { data: values },
            locale: router.locale,
            beforeSubmit: async () => {
              const before = await getUserConfig();
              if (before.nativeBindingConfigured === false) return;
              if (
                !(await saveViewQuery.preview({
                  variables: {
                    data: {
                      sql: saveAsViewModal.state.defaultValue?.sql,
                      limit: 1,
                    },
                  },
                }))
              ) {
                notify.warning(getQueryPreviewText(router.locale).unknown);
                throw new Error('QUERY_EVIDENCE_UNAVAILABLE');
              }
              const completed = saveViewQuery.completedQuery();
              const after = await getUserConfig();
              if (
                !completed ||
                after.nativeBindingConfigured !== true ||
                before.queryScope !== completed.scope ||
                after.queryScope !== completed.scope ||
                after.nativeBindingGeneration !== before.nativeBindingGeneration
              )
                throw new Error('QUERY_IDENTITY_CHANGED');
              queryHistoryId = completed.historyId;
            },
            submit: (variables, guarded) =>
              createViewMutation({
                variables: {
                  ...variables,
                  data: {
                    ...variables.data,
                    ...(queryHistoryId ? { queryHistoryId } : {}),
                  },
                },
                ...(guarded ? { context: { nativeWriteGuarded: true } } : {}),
              }),
            observe: async (nativeId) => {
              const response = await client.query({
                query: LIST_VIEWS,
                fetchPolicy: 'no-cache',
              });
              return response.data?.listViews?.find(
                (row) => row.id === nativeId,
              );
            },
          });
          notify.success(t('home.viewCreated'));
        }}
      />
      <QuestionSQLPairModal
        {...questionSqlPairModal.state}
        onClose={questionSqlPairModal.closeModal}
        loading={createSqlPairLoading}
        onSubmit={async ({
          data,
          nativeWriteGuarded,
        }: {
          data: CreateSqlPairInput;
          nativeWriteGuarded?: boolean;
        }) => {
          return await createSqlPairMutation({
            variables: { data },
            context: { nativeWriteGuarded },
          });
        }}
      />

      <AdjustReasoningStepsModal
        {...adjustReasoningStepsModal.state}
        onClose={adjustReasoningStepsModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) => {
          await adjustAnswer.onAdjustReasoningSteps(
            values.responseId,
            values.data,
          );
        }}
      />

      <AdjustSQLModal
        {...adjustSqlModal.state}
        onClose={adjustSqlModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) =>
          await adjustAnswer.onAdjustSQL(values.responseId, values.sql)
        }
      />
    </SiderLayout>
  );
}

import {
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
} from '@/apollo/client/graphql/__types__';

type ObservedTask = Pick<RecommendedQuestionsTask, 'status' | 'threadId'>;

// Whether one successful read of a thread's recommendation task ends the
// thread page's 1 s observation. Only a GENERATING task can still change on the
// server: a new generation is claimed only by this page's own request, which
// observes again after it. A task the page does not adopt for display (none
// dispatched: no queryId; or one recorded for an older answer, including rows
// from before the source answer was recorded) is no reason to keep reading.
export const isRecommendationObservationDone = (
  task: ObservedTask | null | undefined,
  threadId: number | null,
) =>
  !!task &&
  task.threadId === threadId &&
  task.status !== RecommendedQuestionsTaskStatus.GENERATING;

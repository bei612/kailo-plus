import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import type { Knex } from 'knex';
import {
  AskResultStatus,
  RecommendationQuestionsResult,
  RecommendationQuestionsInput,
  RecommendationQuestion,
  WrenAIError,
  RecommendationQuestionStatus,
  ChartStatus,
  ChartAdjustmentOption,
  WrenAILanguage,
} from '@server/models/adaptor';
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IThreadRepository, Thread } from '../repositories/threadRepository';
import {
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAdjustmentType,
} from '../repositories/threadResponseRepository';
import { getLogger } from '@server/utils';
import { isEmpty, isNil } from 'lodash';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import {
  IAskingTaskRepository,
  AskingTask,
  IViewRepository,
  Project,
} from '../repositories';
import { IQueryService, PreviewDataResponse } from './queryService';
import { IMDLService } from './mdlService';
import {
  ThreadRecommendQuestionBackgroundTracker,
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
  AdjustmentBackgroundTaskTracker,
  TrackedAdjustmentResult,
} from '../backgrounds';
import { getConfig } from '@server/config';
import { TextBasedAnswerBackgroundTracker } from '../backgrounds/textBasedAnswerBackgroundTracker';
import { IAskingTaskTracker, TrackedAskingResult } from './askingTaskTracker';
import { canonical, NativeQueryRefusal } from './nativeQueryAdmission';

const config = getConfig();

const logger = getLogger('AskingService');
logger.level = 'debug';

// const QUERY_ID_PLACEHOLDER = '0';

export interface Task {
  id: string;
}

export interface AskingPayload {
  threadId?: number;
  language: string;
}

export interface AskingTaskInput {
  question: string;
}

export interface AskingDetailTaskInput {
  question?: string;
  sql?: string;
  trackedAskingResult?: TrackedAskingResult;
}

export interface AskingDetailTaskUpdateInput {
  summary?: string;
}

export enum RecommendQuestionResultStatus {
  NOT_STARTED = 'NOT_STARTED',
  GENERATING = 'GENERATING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
}

export interface ThreadRecommendQuestionResult {
  status: RecommendQuestionResultStatus;
  questions: RecommendationQuestion[];
  error?: WrenAIError;
}

export interface InstantRecommendedQuestionsInput {
  previousQuestions?: string[];
}

export enum ThreadResponseAnswerStatus {
  NOT_STARTED = 'NOT_STARTED',
  FETCHING_DATA = 'FETCHING_DATA',
  PREPROCESSING = 'PREPROCESSING',
  STREAMING = 'STREAMING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
  INTERRUPTED = 'INTERRUPTED',
}

// adjustment input
export interface AdjustmentReasoningInput {
  tables: string[];
  sqlGenerationReasoning: string;
  projectId: number;
}

export interface AdjustmentSqlInput {
  sql: string;
}

interface NativeChartConfigurations {
  language: string;
  nativeQuery?: {
    historyId: string;
    expected: ThreadResponse;
    data: PreviewDataResponse;
  };
}

export interface IAskingService {
  /**
   * Asking task.
   */
  createAskingTask(
    input: AskingTaskInput,
    payload: AskingPayload,
    // if the asking task is rerun from a cancelled thread response
    rerunFromCancelled?: boolean,
    // if the asking task is rerun from a cancelled thread response,
    // the previous task id is the task id of the cancelled thread response
    previousTaskId?: number,
    // if the asking task is rerun from a thread response
    // the thread response id is the id of the cancelled thread response
    threadResponseId?: number,
  ): Promise<Task>;
  rerunAskingTask(
    threadResponseId: number,
    payload: AskingPayload,
  ): Promise<Task>;
  cancelAskingTask(taskId: string): Promise<void>;
  getAskingTask(taskId: string): Promise<TrackedAskingResult>;
  getAskingTaskById(id: number): Promise<TrackedAskingResult>;

  /**
   * Asking detail task.
   */
  createThread(input: AskingDetailTaskInput): Promise<Thread>;
  updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread>;
  deleteThread(threadId: number): Promise<void>;
  listThreads(): Promise<Thread[]>;
  createThreadResponse(
    input: AskingDetailTaskInput,
    threadId: number,
  ): Promise<ThreadResponse>;
  updateThreadResponse(
    responseId: number,
    data: { sql: string },
  ): Promise<ThreadResponse>;
  getResponsesWithThread(threadId: number): Promise<ThreadResponse[]>;
  getResponse(responseId: number, project?: Project): Promise<ThreadResponse>;
  generateThreadResponseBreakdown(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  generateThreadResponseAnswer(
    threadResponseId: number,
    configurations: {
      language: string;
      nativeQuery?: {
        historyId: string;
        expected: ThreadResponse;
        data: PreviewDataResponse;
      };
    },
  ): Promise<ThreadResponse>;
  generateThreadResponseChart(
    threadResponseId: number,
    configurations: NativeChartConfigurations,
  ): Promise<ThreadResponse>;
  adjustThreadResponseChart(
    threadResponseId: number,
    input: ChartAdjustmentOption,
    configurations: NativeChartConfigurations,
  ): Promise<ThreadResponse>;
  adjustThreadResponseWithSQL(
    threadResponseId: number,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse>;
  adjustThreadResponseAnswer(
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  cancelAdjustThreadResponseAnswer(taskId: string): Promise<void>;
  rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    projectId: number,
    configurations: { language: string },
  ): Promise<{ queryId: string }>;
  getAdjustmentTask(taskId: string): Promise<TrackedAdjustmentResult>;
  getAdjustmentTaskById(id: number): Promise<TrackedAdjustmentResult>;
  changeThreadResponseAnswerDetailStatus(
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse>;

  /**
   * Recommendation questions
   */
  createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
  ): Promise<Task>;
  getInstantRecommendedQuestions(
    queryId: string,
  ): Promise<RecommendationQuestionsResult>;
  generateThreadRecommendationQuestions(threadId: number): Promise<void>;
  getThreadRecommendationQuestions(
    threadId: number,
  ): Promise<ThreadRecommendQuestionResult>;

  deleteAllByProjectId(projectId: number, tx?: Knex.Transaction): Promise<void>;
  assertProjectTasksSettled(projectId: number): Promise<void>;
}

/**
 * utility function to check if the status is finalized
 */
const isFinalized = (status: AskResultStatus) => {
  return (
    status === AskResultStatus.FAILED ||
    status === AskResultStatus.FINISHED ||
    status === AskResultStatus.STOPPED
  );
};

/**
 * Given a list of steps, construct the SQL statement with CTEs
 * If stepIndex is provided, only construct the SQL from top to that step
 * @param steps
 * @param stepIndex
 * @returns string
 */
export const constructCteSql = (
  steps: Array<{ cteName: string; summary: string; sql: string }>,
  stepIndex?: number,
): string => {
  // validate stepIndex
  if (!isNil(stepIndex) && (stepIndex < 0 || stepIndex >= steps.length)) {
    throw new Error(`Invalid stepIndex: ${stepIndex}`);
  }

  const slicedSteps = isNil(stepIndex) ? steps : steps.slice(0, stepIndex + 1);

  // if there's only one step, return the sql directly
  if (slicedSteps.length === 1) {
    return `-- ${slicedSteps[0].summary}\n${slicedSteps[0].sql}`;
  }

  let sql = 'WITH ';
  slicedSteps.forEach((step, index) => {
    if (index === slicedSteps.length - 1) {
      // if it's the last step, remove the trailing comma.
      // no need to wrap with WITH
      sql += `\n-- ${step.summary}\n`;
      sql += `${step.sql}`;
    } else if (index === slicedSteps.length - 2) {
      // if it's the last two steps, remove the trailing comma.
      // wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql})`;
    } else {
      // if it's not the last step, wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql}),`;
    }
  });

  return sql;
};

/**
 * Background tracker to track the status of the asking breakdown task
 */
class BreakdownBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    logger.info('Background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the answer detail
          const breakdownDetail = threadResponse.breakdownDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getAskDetailResult(
            breakdownDetail.queryId,
          );

          // check if status change
          if (breakdownDetail.status === result.status) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          const updatedBreakdownDetail = {
            queryId: breakdownDetail.queryId,
            status: result?.status,
            error: result?.error,
            description: result?.response?.description,
            steps: result?.response?.steps,
          };
          logger.debug(`Job ${threadResponse.id} status changed, updating`);
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            breakdownDetail: updatedBreakdownDetail,
          });

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            const eventProperties = {
              question: threadResponse.question,
              error: result.error,
            };
            if (result.status === AskResultStatus.FINISHED) {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                eventProperties,
              );
            } else {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                eventProperties,
                WrenService.AI,
                false,
              );
            }
            logger.debug(`Job ${threadResponse.id} is finalized, removing`);
            delete this.tasks[threadResponse.id];
          }

          // mark the job as finished
          this.runningJobs.delete(threadResponse.id);
        },
      );

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }
}

export class AskingService implements IAskingService {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployService: IDeployService;
  private projectService: IProjectService;
  private viewRepository: IViewRepository;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private breakdownBackgroundTracker: BreakdownBackgroundTracker;
  private textBasedAnswerBackgroundTracker: TextBasedAnswerBackgroundTracker;
  private chartBackgroundTracker: ChartBackgroundTracker;
  private chartAdjustmentBackgroundTracker: ChartAdjustmentBackgroundTracker;
  private threadRecommendQuestionBackgroundTracker: ThreadRecommendQuestionBackgroundTracker;
  private queryService: IQueryService;
  private telemetry: PostHogTelemetry;
  private mdlService: IMDLService;
  private askingTaskTracker: IAskingTaskTracker;
  private askingTaskRepository: IAskingTaskRepository;
  private adjustmentBackgroundTracker: AdjustmentBackgroundTaskTracker;

  constructor({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    askingTaskRepository,
    queryService,
    mdlService,
    askingTaskTracker,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    deployService: IDeployService;
    projectService: IProjectService;
    viewRepository: IViewRepository;
    threadRepository: IThreadRepository;
    threadResponseRepository: IThreadResponseRepository;
    askingTaskRepository: IAskingTaskRepository;
    queryService: IQueryService;
    mdlService: IMDLService;
    askingTaskTracker: IAskingTaskTracker;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployService = deployService;
    this.projectService = projectService;
    this.viewRepository = viewRepository;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.telemetry = telemetry;
    this.queryService = queryService;
    this.breakdownBackgroundTracker = new BreakdownBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.textBasedAnswerBackgroundTracker =
      new TextBasedAnswerBackgroundTracker({
        wrenAIAdaptor,
        threadResponseRepository,
        projectService,
        deployService,
        queryService,
      });
    this.chartBackgroundTracker = new ChartBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.chartAdjustmentBackgroundTracker =
      new ChartAdjustmentBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.threadRecommendQuestionBackgroundTracker =
      new ThreadRecommendQuestionBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadRepository,
      });
    this.adjustmentBackgroundTracker = new AdjustmentBackgroundTaskTracker({
      telemetry,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    });

    this.askingTaskRepository = askingTaskRepository;
    this.mdlService = mdlService;
    this.askingTaskTracker = askingTaskTracker;
  }

  private async currentThread(threadId: number, project?: Project) {
    const currentProject =
      project ?? (await this.projectService.getCurrentProject());
    const thread = await this.threadRepository.findOneBy({
      id: threadId,
      projectId: currentProject.id,
    });
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    return thread;
  }

  private async currentTask(
    filter: Partial<Pick<AskingTask, 'id' | 'queryId'>>,
    project?: Project,
    adjustment = false,
  ) {
    if (!filter.id && !filter.queryId) return null;
    const currentProject =
      project ?? (await this.projectService.getCurrentProject());
    const task = await this.askingTaskRepository.findOneBy({
      ...filter,
      projectId: currentProject.id,
    });
    if (
      !task ||
      Boolean((task.detail as { adjustment?: boolean })?.adjustment) !==
        adjustment
    )
      return null;
    if (task.threadId != null)
      await this.currentThread(task.threadId, currentProject);
    return task;
  }

  public async getThreadRecommendationQuestions(
    threadId: number,
  ): Promise<ThreadRecommendQuestionResult> {
    const thread = await this.currentThread(threadId);

    // handle not started
    const res: ThreadRecommendQuestionResult = {
      status: RecommendQuestionResultStatus.NOT_STARTED,
      questions: [],
      error: null,
    };
    if (thread.queryId && thread.questionsStatus) {
      res.status = RecommendQuestionResultStatus[thread.questionsStatus]
        ? RecommendQuestionResultStatus[thread.questionsStatus]
        : res.status;
      res.questions = thread.questions || [];
      res.error = thread.questionsError as WrenAIError;
    }
    return res;
  }

  public async generateThreadRecommendationQuestions(
    threadId: number,
  ): Promise<void> {
    const project = await this.projectService.getCurrentProject();
    const thread = await this.currentThread(threadId, project);

    if (this.threadRecommendQuestionBackgroundTracker.isExist(thread)) {
      logger.debug(
        `thread "${threadId}" recommended questions are generating, skip the current request`,
      );
      return;
    }

    const { manifest } = await this.mdlService.makeCurrentModelMDL(project);

    const threadResponses = await this.threadResponseRepository.findAllBy({
      threadId,
    });
    // descending order and get the latest 5
    const slicedThreadResponses = threadResponses
      .sort((a, b) => b.id - a.id)
      .slice(0, 5);
    const questions = slicedThreadResponses.map(({ question }) => question);
    const recommendQuestionData: RecommendationQuestionsInput = {
      manifest,
      previousQuestions: questions,
      ...this.getThreadRecommendationQuestionsConfig(project),
    };

    const result = await this.wrenAIAdaptor.generateRecommendationQuestions(
      recommendQuestionData,
    );
    // reset thread recommended questions
    const updatedThread = await this.threadRepository.updateOne(threadId, {
      queryId: result.queryId,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      questionsError: null,
    });
    this.threadRecommendQuestionBackgroundTracker.addTask(updatedThread);
    return;
  }

  public async initialize() {
    // list thread responses from database
    // filter status not finalized and put them into background tracker
    const threadResponses = await this.threadResponseRepository.findAll();
    const unfininshedBreakdownThreadResponses = threadResponses.filter(
      (threadResponse) =>
        threadResponse?.breakdownDetail?.status &&
        !isFinalized(
          threadResponse?.breakdownDetail?.status as AskResultStatus,
        ),
    );
    logger.info(
      `Initialization: adding unfininshed breakdown thread responses (total: ${unfininshedBreakdownThreadResponses.length}) to background tracker`,
    );
    for (const threadResponse of unfininshedBreakdownThreadResponses) {
      this.breakdownBackgroundTracker.addTask(threadResponse);
    }
  }

  /**
   * Asking task.
   */
  public async createAskingTask(
    input: AskingTaskInput,
    payload: AskingPayload,
    rerunFromCancelled?: boolean,
    previousTaskId?: number,
    threadResponseId?: number,
  ): Promise<Task> {
    const { threadId, language } = payload;
    const project = await this.projectService.getCurrentProject();
    const deployId = await this.getDeployId(project);

    // if it's a follow-up question, then the input will have a threadId
    // then use the threadId to get the sql and get the steps of last thread response
    // construct it into AskHistory and pass to ask
    const histories = threadId
      ? await this.getAskingHistory(threadId, threadResponseId, project)
      : null;
    const response = await this.askingTaskTracker.createAskingTask({
      projectId: project.id,
      query: input.question,
      histories,
      deployId,
      configurations: { language },
      rerunFromCancelled,
      previousTaskId,
      threadResponseId,
    });
    return {
      id: response.queryId,
    };
  }

  public async rerunAskingTask(
    threadResponseId: number,
    payload: AskingPayload,
  ): Promise<Task> {
    const threadResponse = await this.getResponse(threadResponseId);

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // get the original question and ask again
    const question = threadResponse.question;
    const input = {
      question,
    };
    const askingPayload = {
      ...payload,
      // it's possible that the threadId is not provided in the payload
      // so we'll just use the threadId from the thread response
      threadId: threadResponse.threadId,
    };
    const task = await this.createAskingTask(
      input,
      askingPayload,
      true,
      threadResponse.askingTaskId,
      threadResponseId,
    );
    return task;
  }

  public async cancelAskingTask(taskId: string): Promise<void> {
    if (!(await this.currentTask({ queryId: taskId })))
      throw new Error('Asking task not found');
    const eventName = TelemetryEvent.HOME_CANCEL_ASK;
    try {
      await this.askingTaskTracker.cancelAskingTask(taskId);
      this.telemetry.sendEvent(eventName, {});
    } catch (err: any) {
      this.telemetry.sendEvent(eventName, {}, err.extensions?.service, false);
      throw err;
    }
  }

  public async getAskingTask(
    taskId: string,
  ): Promise<TrackedAskingResult | null> {
    if (!(await this.currentTask({ queryId: taskId }))) return null;
    return this.askingTaskTracker.getAskingResult(taskId);
  }

  public async getAskingTaskById(
    id: number,
  ): Promise<TrackedAskingResult | null> {
    const task = await this.currentTask({ id });
    return task ? this.askingTaskTracker.getAskingResult(task.queryId) : null;
  }

  /**
   * Asking detail task.
   * The process of creating a thread is as follows:
   * 1. create a thread and the first thread response
   * 2. create a task on AI service to generate the detail
   * 3. update the thread response with the task id
   */
  public async createThread(input: AskingDetailTaskInput): Promise<Thread> {
    const project = await this.projectService.getCurrentProject();
    const tracked = input.trackedAskingResult;
    if (tracked && (!tracked.taskId || !tracked.queryId))
      throw new Error('Asking task not found');
    const task = tracked
      ? await this.currentTask(
          { id: tracked.taskId, queryId: tracked.queryId },
          project,
        )
      : null;
    if (tracked && !task) throw new Error('Asking task not found');
    if (task?.threadResponseId) {
      const response = await this.threadResponseRepository.findOneBy({
        id: task.threadResponseId,
        threadId: task.threadId,
        askingTaskId: task.id,
      });
      if (!response) throw new Error('Thread response not found');
      return this.currentThread(task.threadId, project);
    }
    const tx = await this.threadRepository.transaction();
    try {
      const thread = await this.threadRepository.createOne(
        { projectId: project.id, summary: input.question },
        { tx },
      );
      const response = await this.threadResponseRepository.createOne(
        {
          threadId: thread.id,
          question: input.question,
          sql: input.sql,
          askingTaskId: task?.id,
        },
        { tx },
      );
      if (task)
        await this.askingTaskTracker.bindThreadResponse(
          task.id,
          task.queryId,
          thread.id,
          response.id,
          project.id,
          tx,
        );
      await this.threadRepository.commit(tx);
      return thread;
    } catch (error) {
      await this.threadRepository.rollback(tx);
      throw error;
    }
  }

  public async listThreads(): Promise<Thread[]> {
    const { id } = await this.projectService.getCurrentProject();
    return await this.threadRepository.listAllTimeDescOrder(id);
  }

  public async updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread> {
    // if input is empty, throw error
    if (isEmpty(input)) {
      throw new Error('Update thread input is empty');
    }

    await this.currentThread(threadId);

    return this.threadRepository.updateOne(threadId, {
      summary: input.summary,
    });
  }

  public async deleteThread(threadId: number): Promise<void> {
    await this.currentThread(threadId);
    await this.threadRepository.deleteOne(threadId);
  }

  public async createThreadResponse(
    input: AskingDetailTaskInput,
    threadId: number,
  ): Promise<ThreadResponse> {
    const project = await this.projectService.getCurrentProject();
    const thread = await this.currentThread(threadId, project);
    const tracked = input.trackedAskingResult;
    if (tracked && (!tracked.taskId || !tracked.queryId))
      throw new Error('Asking task not found');
    const task = tracked
      ? await this.currentTask(
          { id: tracked.taskId, queryId: tracked.queryId },
          project,
        )
      : null;
    if (tracked && !task) throw new Error('Asking task not found');
    if (task?.threadResponseId) {
      if (task.threadId !== thread.id)
        throw new Error('Asking task already bound');
      const response = await this.threadResponseRepository.findOneBy({
        id: task.threadResponseId,
        threadId: thread.id,
        askingTaskId: task.id,
      });
      if (!response) throw new Error('Thread response not found');
      return response;
    }
    const tx = await this.threadRepository.transaction();
    try {
      const response = await this.threadResponseRepository.createOne(
        {
          threadId: thread.id,
          question: input.question,
          sql: input.sql,
          askingTaskId: task?.id,
        },
        { tx },
      );
      if (task)
        await this.askingTaskTracker.bindThreadResponse(
          task.id,
          task.queryId,
          thread.id,
          response.id,
          project.id,
          tx,
        );
      await this.threadRepository.commit(tx);
      return response;
    } catch (error) {
      await this.threadRepository.rollback(tx);
      throw error;
    }
  }

  public async updateThreadResponse(
    responseId: number,
    data: { sql: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.getResponse(responseId);
    if (!threadResponse) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    return await this.threadResponseRepository.updateOne(responseId, {
      sql: data.sql,
    });
  }

  public async generateThreadResponseBreakdown(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const { language } = configurations;
    const threadResponse = await this.getResponse(threadResponseId);

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: threadResponse.question,
      sql: threadResponse.sql,
      configurations: { language },
    });

    // 2. update the thread response with breakdown detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        breakdownDetail: {
          queryId: response.queryId,
          status: AskResultStatus.UNDERSTANDING,
        },
      },
    );

    // 3. put the task into background tracker
    this.breakdownBackgroundTracker.addTask(updatedThreadResponse);

    // return the task id
    return updatedThreadResponse;
  }

  public async generateThreadResponseAnswer(
    threadResponseId: number,
    configurations?: {
      language: string;
      nativeQuery?: {
        historyId: string;
        expected: ThreadResponse;
        data: PreviewDataResponse;
      };
    },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.getResponse(threadResponseId);

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
      const native = configurations?.nativeQuery;
      if (!native)
        throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
      if (
        native.expected.id !== threadResponse.id ||
        native.expected.threadId !== threadResponse.threadId ||
        native.expected.question !== threadResponse.question ||
        native.expected.sql !== threadResponse.sql
      )
        throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      if (threadResponse.answerDetail?.queryHistoryId === native.historyId) {
        // A missing AI id is an indeterminate original create, not authority
        // to invoke the original non-idempotent AI endpoint again.
        if (
          threadResponse.answerDetail.queryId &&
          threadResponse.answerDetail.status ===
            ThreadResponseAnswerStatus.PREPROCESSING
        )
          this.textBasedAnswerBackgroundTracker.addTask(threadResponse);
        return threadResponse;
      }
      if (
        threadResponse.answerDetail &&
        [
          ThreadResponseAnswerStatus.FETCHING_DATA,
          ThreadResponseAnswerStatus.PREPROCESSING,
          ThreadResponseAnswerStatus.STREAMING,
        ].includes(
          threadResponse.answerDetail.status as ThreadResponseAnswerStatus,
        )
      )
        throw new NativeQueryRefusal(409, 'NATIVE_EXECUTION_UNKNOWN');
      const claimed = await this.threadResponseRepository.claimNativeAnswer(
        threadResponse,
        {
          queryHistoryId: native.historyId,
          status: ThreadResponseAnswerStatus.PREPROCESSING,
        },
      );
      if (!claimed) {
        const current = await this.getResponse(threadResponseId);
        if (current?.answerDetail?.queryHistoryId === native.historyId)
          return current;
        throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      }
      // Only the current HUMAN's disclosed, frozen result enters the original
      // AI service. No credential is retained and no background SQL is run.
      const response = await this.wrenAIAdaptor.createTextBasedAnswer({
        query: claimed.question,
        sql: claimed.sql,
        sqlData: native.data,
        threadId: claimed.threadId.toString(),
        configurations: { language: configurations.language },
      });
      if (typeof response?.queryId !== 'string' || !response.queryId.trim())
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      const accepted = await this.threadResponseRepository.claimNativeAnswer(
        claimed,
        { ...claimed.answerDetail, queryId: response.queryId },
      );
      if (!accepted) throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      this.textBasedAnswerBackgroundTracker.addTask(accepted);
      return accepted;
    }

    // update with initial status
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        answerDetail: {
          status: ThreadResponseAnswerStatus.NOT_STARTED,
        },
      },
    );

    // put the task into background tracker
    this.textBasedAnswerBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  public async generateThreadResponseChart(
    threadResponseId: number,
    configurations: NativeChartConfigurations,
  ): Promise<ThreadResponse> {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      return this.createNativeChart(threadResponseId, configurations);
    const threadResponse = await this.getResponse(threadResponseId);

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to generate the chart
    const response = await this.wrenAIAdaptor.generateChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      configurations,
    });

    // 2. update the thread response with chart detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        chartDetail: {
          queryId: response.queryId,
          status: ChartStatus.FETCHING,
        },
      },
    );

    // 3. put the task into background tracker
    this.chartBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  public async adjustThreadResponseChart(
    threadResponseId: number,
    input: ChartAdjustmentOption,
    configurations: NativeChartConfigurations,
  ): Promise<ThreadResponse> {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      return this.createNativeChart(threadResponseId, configurations, input);
    const threadResponse = await this.getResponse(threadResponseId);

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to adjust the chart
    const response = await this.wrenAIAdaptor.adjustChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      adjustmentOption: input,
      chartSchema: threadResponse.chartDetail?.chartSchema,
      configurations,
    });

    // 2. update the thread response with chart detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        chartDetail: {
          queryId: response.queryId,
          status: ChartStatus.FETCHING,
          adjustment: true,
        },
      },
    );

    // 3. put the task into background tracker
    this.chartAdjustmentBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  private async createNativeChart(
    responseId: number,
    configurations: NativeChartConfigurations,
    adjustmentOption?: ChartAdjustmentOption,
  ): Promise<ThreadResponse> {
    const native = configurations.nativeQuery;
    if (!native)
      throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
    const current = await this.getResponse(responseId);
    const intent = (response: ThreadResponse) => ({
      id: response.id,
      threadId: response.threadId,
      question: response.question,
      sql: response.sql,
    });
    if (
      !current ||
      canonical(intent(current)) !== canonical(intent(native.expected))
    )
      throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    const tracker = adjustmentOption
      ? this.chartAdjustmentBackgroundTracker
      : this.chartBackgroundTracker;
    const detail = current.chartDetail;
    if (detail?.queryHistoryId === native.historyId) {
      if (
        canonical(detail.adjustmentOption || null) !==
        canonical(adjustmentOption || null)
      )
        throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      if (
        detail.queryId &&
        [ChartStatus.FETCHING, ChartStatus.GENERATING].includes(
          detail.status as ChartStatus,
        )
      )
        tracker.addTask(current);
      return current;
    }
    if (
      detail &&
      [ChartStatus.FETCHING, ChartStatus.GENERATING].includes(
        detail.status as ChartStatus,
      )
    )
      throw new NativeQueryRefusal(409, 'NATIVE_EXECUTION_UNKNOWN');
    if (
      canonical(detail || null) !==
      canonical(native.expected.chartDetail || null)
    )
      throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    if (
      adjustmentOption &&
      (!detail?.chartSchema || detail.status !== ChartStatus.FINISHED)
    )
      throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
    // Persist the exact original response and previous chart before the native
    // non-idempotent create. Lost acknowledgement remains this original claim.
    const claimed = await this.threadResponseRepository.claimNativeChart(
      current,
      {
        queryHistoryId: native.historyId,
        status: ChartStatus.GENERATING,
        ...(adjustmentOption ? { adjustment: true, adjustmentOption } : {}),
      },
    );
    if (!claimed) {
      const latest = await this.getResponse(responseId);
      if (
        latest?.chartDetail?.queryHistoryId === native.historyId &&
        canonical(latest.chartDetail.adjustmentOption || null) ===
          canonical(adjustmentOption || null)
      )
        return latest;
      throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    }
    const input = {
      query: claimed.question,
      sql: claimed.sql,
      data: native.data,
      configurations: { language: configurations.language },
    };
    const created = adjustmentOption
      ? await this.wrenAIAdaptor.adjustChart({
          ...input,
          adjustmentOption,
          chartSchema: detail.chartSchema,
        })
      : await this.wrenAIAdaptor.generateChart(input);
    if (typeof created?.queryId !== 'string' || !created.queryId.trim())
      throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
    const accepted = await this.threadResponseRepository.claimNativeChart(
      claimed,
      {
        ...claimed.chartDetail,
        queryId: created.queryId,
      },
    );
    if (!accepted) throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    tracker.addTask(accepted);
    return accepted;
  }

  public async getResponsesWithThread(threadId: number) {
    await this.currentThread(threadId);
    return this.threadResponseRepository.getResponsesWithThread(threadId);
  }

  public async getResponse(responseId: number, project?: Project) {
    const response = await this.threadResponseRepository.findOneBy({
      id: responseId,
    });
    if (!response) return null;
    const currentProject =
      project ?? (await this.projectService.getCurrentProject());
    const thread = await this.threadRepository.findOneBy({
      id: response.threadId,
      projectId: currentProject.id,
    });
    return thread ? response : null;
  }

  public async createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
  ): Promise<Task> {
    const project = await this.projectService.getCurrentProject();
    const { manifest } = await this.deployService.getLastDeployment(project.id);

    const response = await this.wrenAIAdaptor.generateRecommendationQuestions({
      manifest,
      previousQuestions: input.previousQuestions,
      ...this.getThreadRecommendationQuestionsConfig(project),
    });
    return { id: response.queryId };
  }

  public async getInstantRecommendedQuestions(
    queryId: string,
  ): Promise<RecommendationQuestionsResult> {
    const response =
      await this.wrenAIAdaptor.getRecommendationQuestionsResult(queryId);
    return response;
  }

  public async deleteAllByProjectId(
    projectId: number,
    tx?: Knex.Transaction,
  ): Promise<void> {
    // delete all threads
    await this.threadRepository.deleteAllBy({ projectId }, { tx });
  }

  public async assertProjectTasksSettled(projectId: number): Promise<void> {
    const task = await this.askingTaskRepository.findUnsettled(projectId);
    if (!task) return;
    // Reattach the acknowledged query to the original polling loop after restart.
    // A cancellation acknowledgement is not an observed native terminal result.
    if (task.detail && 'adjustment' in task.detail && task.detail.adjustment) {
      await this.adjustmentBackgroundTracker.getAdjustmentResult(task.queryId);
    } else {
      await this.askingTaskTracker.getAskingResult(task.queryId);
    }
    throw new Error(
      `Native asking task ${task.id} has no observed terminal result; retry deletion after observation`,
    );
  }

  public async changeThreadResponseAnswerDetailStatus(
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse> {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    if (response.answerDetail?.status === status) {
      return;
    }

    const updatedResponse = await this.threadResponseRepository.updateOne(
      responseId,
      {
        answerDetail: {
          ...response.answerDetail,
          status,
          content,
        },
      },
    );

    return updatedResponse;
  }

  private async getDeployId(project: Project) {
    const lastDeploy = await this.deployService.getLastDeployment(project.id);
    return lastDeploy.hash;
  }

  public async adjustThreadResponseWithSQL(
    threadResponseId: number,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse> {
    const response = await this.getResponse(threadResponseId);
    if (!response) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    return await this.threadResponseRepository.createOne({
      sql: input.sql,
      threadId: response.threadId,
      question: response.question,
      adjustment: {
        type: ThreadResponseAdjustmentType.APPLY_SQL,
        payload: {
          originalThreadResponseId: response.id,
          sql: input.sql,
        },
      },
    });
  }

  public async adjustThreadResponseAnswer(
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const project = await this.projectService.getCurrentProject();
    if (input.projectId !== project.id) throw new Error('Project not found');
    const originalThreadResponse = await this.getResponse(
      threadResponseId,
      project,
    );
    if (!originalThreadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    const { createdThreadResponse } =
      await this.adjustmentBackgroundTracker.createAdjustmentTask({
        threadId: originalThreadResponse.threadId,
        tables: input.tables,
        sqlGenerationReasoning: input.sqlGenerationReasoning,
        sql: originalThreadResponse.sql,
        projectId: input.projectId,
        configurations,
        question: originalThreadResponse.question,
        originalThreadResponseId: originalThreadResponse.id,
      });
    return createdThreadResponse;
  }

  public async cancelAdjustThreadResponseAnswer(taskId: string): Promise<void> {
    if (!(await this.currentTask({ queryId: taskId }, undefined, true)))
      throw new Error('Adjustment task not found');
    // call cancelAskFeedback on AI service
    await this.adjustmentBackgroundTracker.cancelAdjustmentTask(taskId);
  }

  public async rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    projectId: number,
    configurations: { language: string },
  ): Promise<{ queryId: string }> {
    const project = await this.projectService.getCurrentProject();
    if (projectId !== project.id) throw new Error('Project not found');
    const threadResponse = await this.getResponse(threadResponseId, project);
    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    const { queryId } =
      await this.adjustmentBackgroundTracker.rerunAdjustmentTask({
        threadId: threadResponse.threadId,
        threadResponseId,
        projectId,
        configurations,
      });
    return { queryId };
  }

  public async getAdjustmentTask(
    taskId: string,
  ): Promise<TrackedAdjustmentResult | null> {
    if (!(await this.currentTask({ queryId: taskId }, undefined, true)))
      return null;
    return this.adjustmentBackgroundTracker.getAdjustmentResult(taskId);
  }

  public async getAdjustmentTaskById(
    id: number,
  ): Promise<TrackedAdjustmentResult | null> {
    const task = await this.currentTask({ id }, undefined, true);
    return task
      ? this.adjustmentBackgroundTracker.getAdjustmentResult(task.queryId)
      : null;
  }

  /**
   * Get the thread response of a thread for asking
   * @param threadId
   * @returns Promise<ThreadResponse[]>
   */
  private async getAskingHistory(
    threadId: number,
    excludeThreadResponseId?: number,
    project?: Project,
  ): Promise<ThreadResponse[]> {
    if (!threadId) {
      return [];
    }
    await this.currentThread(threadId, project);
    let responses = await this.threadResponseRepository.getResponsesWithThread(
      threadId,
      10,
    );

    // exclude the thread response if the excludeThreadResponseId is provided
    // it's used when rerun the asking task, we don't want include the cancelled thread response
    if (excludeThreadResponseId) {
      responses = responses.filter(
        (response) => response.id !== excludeThreadResponseId,
      );
    }

    // filter out the thread response with empty sql
    return responses.filter((response) => response.sql);
  }

  private getThreadRecommendationQuestionsConfig(project: Project) {
    return {
      maxCategories: config.threadRecommendationQuestionMaxCategories,
      maxQuestions: config.threadRecommendationQuestionsMaxQuestions,
      configuration: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };
  }
}

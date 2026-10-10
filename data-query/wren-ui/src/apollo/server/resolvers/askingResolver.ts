import {
  WrenAIError,
  WrenAILanguage,
  AskResultStatus,
  AskResultType,
  RecommendationQuestionStatus,
  ChartAdjustmentOption,
  ChartStatus,
  AskFeedbackStatus,
} from '@server/models/adaptor';
import { Thread } from '../repositories/threadRepository';
import {
  DetailStep,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { reduce } from 'lodash';
import { IContext } from '../types';
import { getLogger } from '@server/utils';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import {
  AskingDetailTaskInput,
  constructCteSql,
  ThreadRecommendQuestionResult,
} from '../services/askingService';
import {
  SuggestedQuestion,
  SampleDatasetName,
  getSampleAskQuestions,
} from '../data';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import { TrackedAskingResult, ThreadResponseAnswerStatus } from '../services';
import { View } from '../repositories/viewRepository';
import { ModelResolver } from './modelResolver';
import {
  nativePreviewScope,
  resolveNativeResource,
} from '../services/nativeHumanQuery';
import { DEFAULT_PREVIEW_LIMIT } from '../services/queryService';
import { queryReceiptState } from '@/utils/queryReceipt';
import { ApiHistoryResolver } from './apiHistoryResolver';
import {
  canonical,
  digest,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';

const logger = getLogger('AskingResolver');
logger.level = 'debug';

export interface SuggestedQuestionResponse {
  questions: SuggestedQuestion[];
}

export interface Task {
  id: string;
}

export interface AdjustmentTask {
  queryId: string;
  status: AskFeedbackStatus;
  error: WrenAIError | null;
  sql: string;
  traceId: string;
  invalidSql?: string;
}

export interface AskingTask {
  type: AskResultType | null;
  status: AskResultStatus;
  candidates: Array<{
    sql: string;
  }>;
  error: WrenAIError | null;
  rephrasedQuestion?: string;
  intentReasoning?: string;
  sqlGenerationReasoning?: string;
  retrievedTables?: string[];
  invalidSql?: string;
  traceId?: string;
  queryId?: string;
}

// DetailedThread is a type that represents a detailed thread, which is a thread with responses.
export interface DetailedThread {
  id: number; // ID
  sql: string; // SQL
  responses: ThreadResponse[];
}

export interface RecommendedQuestionsTask {
  questions: {
    question: string;
    category: string;
    sql: string;
  }[];
  status: RecommendationQuestionStatus;
  error: WrenAIError | null;
}

export class AskingResolver {
  private async nativeAskingScope(ctx: IContext) {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined)
      return undefined;
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const project = await ctx.projectService.getCurrentProject();
    if (project.id !== config.projectId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const deployment = await ctx.deployRepository.findLastProjectDeployLog(
      project.id,
    );
    if (!deployment || deployment.status !== 'SUCCESS')
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const mdl = await new ModelResolver().getMDL(
      null,
      { hash: deployment.hash },
      ctx,
    );
    return {
      bindingId: config.bindingId,
      identityScope: ctx.nativeIdentityScope,
      metadataReference: { hash: deployment.hash, digest: digest(mdl) },
    };
  }

  // The native task remains its original owner. No cached result or query ID
  // grants another HUMAN access to its prompt/reasoning stream.
  public async authorizeNativeAskingTask(
    queryId: string,
    ctx: IContext,
    adjustment = false,
  ) {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined)
      return undefined;
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const project = await ctx.projectService.getCurrentProject();
    const task = await ctx.askingTaskRepository.findOneBy({
      queryId,
      projectId: project.id,
    });
    const proof = task?.detail?.nativeScope;
    if (
      project.id !== config.projectId ||
      !task ||
      task.queryId !== queryId ||
      Boolean((task.detail as any)?.adjustment) !== adjustment ||
      proof?.bindingId !== config.bindingId ||
      proof.identityScope !== ctx.nativeIdentityScope ||
      typeof proof.metadataReference?.hash !== 'string' ||
      typeof proof.metadataReference.digest !== 'string'
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const mdl = await new ModelResolver().getMDL(
      null,
      { hash: proof.metadataReference.hash },
      ctx,
    );
    if (digest(mdl) !== proof.metadataReference.digest)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const current = await ctx.askingTaskRepository.findOneBy({
      id: task.id,
      queryId,
      projectId: project.id,
    });
    if (
      !current ||
      current.question !== task.question ||
      canonical(current.detail?.nativeScope) !== canonical(proof)
    )
      throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    return current;
  }

  private async authorizeNativeAdjustmentSource(
    responseId: number,
    ctx: IContext,
  ) {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined) return;
    const project = await ctx.projectService.getCurrentProject();
    const visited = new Set<number>();
    const references: ThreadResponse[] = [];
    let threadId: number | undefined;
    let id = responseId;
    while (!visited.has(id)) {
      visited.add(id);
      const response = await ctx.askingService.getResponse(id, project);
      if (!response) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      if (threadId !== undefined && response.threadId !== threadId)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      threadId = response.threadId;
      references.push(response);
      if (response.askingTaskId) {
        const task = await ctx.askingTaskRepository.findOneBy({
          id: response.askingTaskId,
          projectId: project.id,
        });
        if (!task)
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        await this.authorizeNativeAskingTask(
          task.queryId,
          ctx,
          Boolean((task.detail as any)?.adjustment),
        );
        for (const expected of references) {
          const current = await ctx.askingService.getResponse(
            expected.id,
            project,
          );
          if (canonical(current) !== canonical(expected))
            throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
        }
        return;
      }
      // Original SQL-only adjustments retain their original response reference,
      // not a second task or a copied user identity.
      id = response.adjustment?.payload?.originalThreadResponseId;
      if (!Number.isSafeInteger(id) || id <= 0) break;
    }
    throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
  }

  private async readNativeViews(
    ctx: IContext,
    viewIds: number[],
    expectedProjectId?: number,
  ): Promise<Map<number, View>> {
    const project = await ctx.projectService.getCurrentProject();
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    const token = ctx.nativeHumanToken;
    if (!token)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (
      config.projectId !== project.id ||
      (expectedProjectId !== undefined && expectedProjectId !== project.id)
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');

    const views = new Map<number, View>();
    const facts = new Map<number, string>();
    for (const id of new Set(viewIds)) {
      const resource = await resolveNativeResource(
        config,
        token,
        'view',
        id,
        'data_query.describe@v1',
      );
      const view = await ctx.viewRepository.findOneBy({
        id,
        projectId: project.id,
      });
      if (!view || view.id !== id || view.projectId !== project.id)
        throw new Error('View not found');
      views.set(id, view);
      facts.set(id, canonical({ resource, view }));
    }

    // A cached answer is not permission to disclose its original saved view.
    // Re-read native facts and current Resource permission before returning.
    for (const id of views.keys()) {
      const current = await ctx.viewRepository.findOneBy({
        id,
        projectId: project.id,
      });
      const resource = await resolveNativeResource(
        config,
        token,
        'view',
        id,
        'data_query.describe@v1',
      );
      if (!current || canonical({ resource, view: current }) !== facts.get(id))
        throw new NativeQueryRefusal(409, 'QUERY_EVIDENCE_UNAVAILABLE');
    }
    return views;
  }

  constructor() {
    this.createAskingTask = this.createAskingTask.bind(this);
    this.cancelAskingTask = this.cancelAskingTask.bind(this);
    this.rerunAskingTask = this.rerunAskingTask.bind(this);
    this.getAskingTask = this.getAskingTask.bind(this);
    this.createThread = this.createThread.bind(this);
    this.getThread = this.getThread.bind(this);
    this.updateThread = this.updateThread.bind(this);
    this.deleteThread = this.deleteThread.bind(this);
    this.listThreads = this.listThreads.bind(this);
    this.createThreadResponse = this.createThreadResponse.bind(this);
    this.updateThreadResponse = this.updateThreadResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.previewData = this.previewData.bind(this);
    this.previewBreakdownData = this.previewBreakdownData.bind(this);
    this.getSuggestedQuestions = this.getSuggestedQuestions.bind(this);
    this.createInstantRecommendedQuestions =
      this.createInstantRecommendedQuestions.bind(this);
    this.getInstantRecommendedQuestions =
      this.getInstantRecommendedQuestions.bind(this);
    this.generateThreadRecommendationQuestions =
      this.generateThreadRecommendationQuestions.bind(this);
    this.generateProjectRecommendationQuestions =
      this.generateProjectRecommendationQuestions.bind(this);

    this.getThreadRecommendationQuestions =
      this.getThreadRecommendationQuestions.bind(this);
    this.generateThreadResponseBreakdown =
      this.generateThreadResponseBreakdown.bind(this);
    this.generateThreadResponseAnswer =
      this.generateThreadResponseAnswer.bind(this);
    this.generateThreadResponseChart =
      this.generateThreadResponseChart.bind(this);
    this.adjustThreadResponseChart = this.adjustThreadResponseChart.bind(this);
    this.transformAskingTask = this.transformAskingTask.bind(this);

    this.adjustThreadResponse = this.adjustThreadResponse.bind(this);
    this.cancelAdjustThreadResponseAnswer =
      this.cancelAdjustThreadResponseAnswer.bind(this);
    this.rerunAdjustThreadResponseAnswer =
      this.rerunAdjustThreadResponseAnswer.bind(this);
    this.getAdjustmentTask = this.getAdjustmentTask.bind(this);
  }

  public async generateProjectRecommendationQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<boolean> {
    const project = await ctx.projectService.getCurrentProject();
    await ctx.projectService.generateProjectRecommendationQuestions(
      project,
      ctx.nativeProjectCheck,
    );
    return true;
  }

  public async generateThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<boolean> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    await askingService.generateThreadRecommendationQuestions(threadId);
    return true;
  }

  public async getThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<ThreadRecommendQuestionResult> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    return askingService.getThreadRecommendationQuestions(threadId);
  }

  public async getSuggestedQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<SuggestedQuestionResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { sampleDataset } = project;
    if (!sampleDataset) {
      return { questions: [] };
    }
    const questions = getSampleAskQuestions(sampleDataset as SampleDatasetName);
    return { questions };
  }

  public async createAskingTask(
    _root: any,
    args: { data: { question: string; threadId?: number } },
    ctx: IContext,
  ): Promise<Task> {
    const { question, threadId } = args.data;
    const project = await ctx.projectService.getCurrentProject();

    const askingService = ctx.askingService;
    const data = { question };
    const nativeScope = await this.nativeAskingScope(ctx);
    if (nativeScope && threadId) {
      for (const response of await askingService.getResponsesWithThread(
        threadId,
      )) {
        const previous = await ctx.askingTaskRepository.findOneBy({
          id: response.askingTaskId,
          projectId: project.id,
        });
        if (!previous)
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        await this.authorizeNativeAskingTask(previous.queryId, ctx);
      }
    }
    const task = await askingService.createAskingTask(data, {
      threadId,
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      nativeScope,
      authorizeNative: nativeScope
        ? (queryId) => this.authorizeNativeAskingTask(queryId, ctx)
        : undefined,
    });
    ctx.telemetry.sendEvent(TelemetryEvent.HOME_ASK_CANDIDATE, {
      question,
      taskId: task.id,
    });
    return task;
  }

  public async cancelAskingTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.authorizeNativeAskingTask(taskId, ctx);
    await askingService.cancelAskingTask(taskId, () =>
      this.authorizeNativeAskingTask(taskId, ctx),
    );
    return true;
  }

  public async getAskingTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AskingTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.authorizeNativeAskingTask(taskId, ctx);
    const askResult = await askingService.getAskingTask(taskId);

    if (!askResult) {
      return null;
    }

    const task = await this.transformAskingTask(askResult, ctx);

    // telemetry
    const eventName = TelemetryEvent.HOME_ASK_CANDIDATE;
    if (askResult.status === AskResultStatus.FINISHED) {
      ctx.telemetry.sendEvent(eventName, {
        taskId,
        status: askResult.status,
        candidates: askResult.response,
      });
    }
    if (askResult.status === AskResultStatus.FAILED) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          taskId,
          status: askResult.status,
          error: askResult.error,
        },
        WrenService.AI,
        false,
      );
    }

    return task;
  }

  public async createThread(
    _root: any,
    args: {
      data: {
        question?: string;
        taskId?: string;
        // if we use recommendation questions, sql will be provided
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<Thread> {
    const { data } = args;

    const askingService = ctx.askingService;

    // if taskId is provided, use the result from the asking task
    // otherwise, use the input data
    let threadInput: AskingDetailTaskInput;
    if (data.taskId) {
      await this.authorizeNativeAskingTask(data.taskId, ctx);
      const askingTask = await askingService.getAskingTask(data.taskId);
      if (!askingTask) {
        throw new Error(`Asking task ${data.taskId} not found`);
      }

      threadInput = {
        question: askingTask.question,
        trackedAskingResult: askingTask,
      };
    } else {
      // when we use recommendation questions, there's no task to track
      threadInput = data;
    }

    const eventName = TelemetryEvent.HOME_CREATE_THREAD;
    try {
      const thread = await askingService.createThread(threadInput);
      ctx.telemetry.sendEvent(eventName, {});
      return thread;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
    // telemetry
  }

  public async getThread(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<DetailedThread> {
    const { threadId } = args;

    const askingService = ctx.askingService;
    const responses = await askingService.getResponsesWithThread(threadId);
    await this.readNativeViews(
      ctx,
      responses
        .filter(
          (response) =>
            response.viewId !== null && response.viewId !== undefined,
        )
        .map((response) => response.viewId),
    );
    // reduce responses to group by thread id
    const thread = reduce(
      responses,
      (acc, response) => {
        if (!acc.id) {
          acc.id = response.threadId;
          acc.sql = response.sql;
          acc.responses = [];
        }

        acc.responses.push({
          id: response.id,
          viewId: response.viewId,
          threadId: response.threadId,
          question: response.question,
          sql: response.sql,
          askingTaskId: response.askingTaskId,
          breakdownDetail: response.breakdownDetail,
          answerDetail: response.answerDetail,
          chartDetail: response.chartDetail,
          adjustment: response.adjustment,
        });

        return acc;
      },
      {} as any,
    );

    return thread;
  }

  public async updateThread(
    _root: any,
    args: { where: { id: number }; data: { summary: string } },
    ctx: IContext,
  ): Promise<Thread> {
    const { where, data } = args;

    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_UPDATE_THREAD_SUMMARY;
    const newSummary = data.summary;
    try {
      const thread = await askingService.updateThread(
        where.id,
        data,
        ctx.nativeProjectCheck,
      );
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        new_summary: newSummary,
      });
      return thread;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          new_summary: newSummary,
        },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteThread(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    const { where } = args;

    const askingService = ctx.askingService;
    await askingService.deleteThread(where.id, ctx.nativeProjectCheck);
    return true;
  }

  public async listThreads(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Thread[]> {
    const threads = await ctx.askingService.listThreads();
    return threads;
  }

  public async createThreadResponse(
    _root: any,
    args: {
      threadId: number;
      data: {
        question?: string;
        taskId?: string;
        // if we use recommendation questions, sql will be provided
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;

    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_ASK_FOLLOWUP_QUESTION;

    // if taskId is provided, use the result from the asking task
    // otherwise, use the input data
    let threadResponseInput: AskingDetailTaskInput;
    if (data.taskId) {
      await this.authorizeNativeAskingTask(data.taskId, ctx);
      const askingTask = await askingService.getAskingTask(data.taskId);
      if (!askingTask) {
        throw new Error(`Asking task ${data.taskId} not found`);
      }

      threadResponseInput = {
        question: askingTask.question,
        trackedAskingResult: askingTask,
      };
    } else {
      // when we use recommendation questions, there's no task to track
      threadResponseInput = data;
    }

    try {
      const response = await askingService.createThreadResponse(
        threadResponseInput,
        threadId,
      );
      ctx.telemetry.sendEvent(eventName, { data });
      return response;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async updateThreadResponse(
    _root: any,
    args: { where: { id: number }; data: { sql: string } },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { where, data } = args;
    const askingService = ctx.askingService;
    const response = await askingService.updateThreadResponse(
      where.id,
      data,
      ctx.nativeProjectCheck,
    );
    return response;
  }

  public async rerunAskingTask(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<Task> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const project = await ctx.projectService.getCurrentProject();
    const nativeScope = await this.nativeAskingScope(ctx);
    if (nativeScope) {
      const response = await askingService.getResponse(responseId, project);
      const previous =
        response &&
        (await ctx.askingTaskRepository.findOneBy({
          id: response.askingTaskId,
          projectId: project.id,
        }));
      if (!previous)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      await this.authorizeNativeAskingTask(previous.queryId, ctx);
    }
    const task = await askingService.rerunAskingTask(responseId, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      nativeScope,
      authorizeNative: nativeScope
        ? (queryId) => this.authorizeNativeAskingTask(queryId, ctx)
        : undefined,
    });
    ctx.telemetry.sendEvent(TelemetryEvent.HOME_RERUN_ASKING_TASK, {
      responseId,
    });
    return task;
  }

  public async adjustThreadResponse(
    _root: any,
    args: {
      responseId: number;
      data: {
        tables?: string[];
        sqlGenerationReasoning?: string;
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId, data } = args;
    const askingService = ctx.askingService;
    const project = await ctx.projectService.getCurrentProject();
    const nativeScope = await this.nativeAskingScope(ctx);
    const authorizeSource = async () => {
      await this.authorizeNativeAdjustmentSource(responseId, ctx);
      if (
        canonical(await this.nativeAskingScope(ctx)) !== canonical(nativeScope)
      )
        throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    };
    await authorizeSource();

    if (data.sql) {
      const response = await askingService.adjustThreadResponseWithSQL(
        responseId,
        {
          sql: data.sql,
        },
        authorizeSource,
      );
      ctx.telemetry.sendEvent(
        TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_WITH_SQL,
        {
          sql: data.sql,
          responseId,
        },
      );
      return response;
    }

    return askingService.adjustThreadResponseAnswer(
      responseId,
      {
        projectId: project.id,
        tables: data.tables,
        sqlGenerationReasoning: data.sqlGenerationReasoning,
      },
      {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
        nativeScope,
        authorizeNative: nativeScope
          ? async (id) => {
              await authorizeSource();
              return this.authorizeNativeAskingTask(id, ctx, true);
            }
          : undefined,
        authorizeSource,
      },
    );
  }

  public async cancelAdjustThreadResponseAnswer(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.authorizeNativeAskingTask(taskId, ctx, true);
    await askingService.cancelAdjustThreadResponseAnswer(taskId, () =>
      this.authorizeNativeAskingTask(taskId, ctx, true),
    );
    return true;
  }

  public async rerunAdjustThreadResponseAnswer(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<boolean> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const project = await ctx.projectService.getCurrentProject();
    const nativeScope = await this.nativeAskingScope(ctx);
    const authorizeSource = async () => {
      await this.authorizeNativeAdjustmentSource(responseId, ctx);
      if (
        canonical(await this.nativeAskingScope(ctx)) !== canonical(nativeScope)
      )
        throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    };
    await authorizeSource();
    await askingService.rerunAdjustThreadResponseAnswer(
      responseId,
      project.id,
      {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
        nativeScope,
        authorizeNative: nativeScope
          ? async (id) => {
              await authorizeSource();
              return this.authorizeNativeAskingTask(id, ctx, true);
            }
          : undefined,
        authorizeSource,
      },
    );
    return true;
  }

  public async getAdjustmentTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AdjustmentTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.authorizeNativeAskingTask(taskId, ctx, true);
    const adjustmentTask = await askingService.getAdjustmentTask(taskId);
    await this.authorizeNativeAskingTask(taskId, ctx, true);
    return {
      queryId: adjustmentTask?.queryId,
      status: adjustmentTask?.status,
      error: adjustmentTask?.error,
      sql: adjustmentTask?.response?.[0]?.sql,
      traceId: adjustmentTask?.traceId,
      invalidSql: adjustmentTask?.invalidSql
        ? safeFormatSQL(adjustmentTask.invalidSql)
        : null,
    };
  }

  public async generateThreadResponseBreakdown(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    const breakdownDetail = await askingService.generateThreadResponseBreakdown(
      responseId,
      { language: WrenAILanguage[project.language] || WrenAILanguage.EN },
    );
    return breakdownDetail;
  }

  public async generateThreadResponseAnswer(
    _root: any,
    args: {
      responseId: number;
      idempotencyKey?: string;
      idempotencyScope?: string;
    },
    ctx: IContext,
  ): Promise<ThreadResponse & { queryReceipt?: any }> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
      const expected = await askingService.getResponse(responseId);
      if (!expected?.sql)
        throw new NativeQueryRefusal(404, 'NATIVE_OBJECT_UNAVAILABLE');
      if (
        expected.answerDetail?.queryHistoryId &&
        [
          ThreadResponseAnswerStatus.PREPROCESSING,
          ThreadResponseAnswerStatus.STREAMING,
        ].includes(expected.answerDetail.status as ThreadResponseAnswerStatus)
      ) {
        const history = await ctx.apiHistoryRepository.findOneBy({
          id: expected.answerDetail.queryHistoryId,
        });
        if (!history || history.governanceKey !== args.idempotencyKey)
          throw new NativeQueryRefusal(409, 'NATIVE_EXECUTION_UNKNOWN');
      }
      const receipt = await new ModelResolver().previewSql(
        null,
        {
          data: {
            sql: expected.sql,
            projectId: String(project.id),
            limit: DEFAULT_PREVIEW_LIMIT,
            idempotencyKey: args.idempotencyKey,
            idempotencyScope: args.idempotencyScope,
          },
        },
        ctx,
      );
      const state = queryReceiptState(receipt);
      if (!state.completed) return { ...expected, queryReceipt: receipt };
      if (
        receipt.nativeType !== 'wren.api_history' ||
        typeof receipt.nativeId !== 'string' ||
        !Array.isArray(receipt.data?.columns) ||
        !Array.isArray(receipt.data?.data)
      )
        throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
      const response = await askingService.generateThreadResponseAnswer(
        responseId,
        {
          language: WrenAILanguage[project.language] || WrenAILanguage.EN,
          nativeQuery: {
            historyId: receipt.nativeId,
            expected,
            data: receipt.data,
          },
        },
      );
      return { ...response, queryReceipt: receipt };
    }
    return askingService.generateThreadResponseAnswer(responseId, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
  }

  public async generateThreadResponseChart(
    _root: any,
    args: {
      responseId: number;
      idempotencyKey?: string;
      idempotencyScope?: string;
    },
    ctx: IContext,
  ): Promise<ThreadResponse & { chartQueryReceipt?: any }> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      return this.generateNativeChart(args, ctx);
    return askingService.generateThreadResponseChart(responseId, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
  }

  public async adjustThreadResponseChart(
    _root: any,
    args: {
      responseId: number;
      data: ChartAdjustmentOption;
      idempotencyKey?: string;
      idempotencyScope?: string;
    },
    ctx: IContext,
  ): Promise<ThreadResponse & { chartQueryReceipt?: any }> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId, data } = args;
    const askingService = ctx.askingService;
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      return this.generateNativeChart(args, ctx);
    return askingService.adjustThreadResponseChart(responseId, data, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
  }

  private async generateNativeChart(
    args: {
      responseId: number;
      data?: ChartAdjustmentOption;
      idempotencyKey?: string;
      idempotencyScope?: string;
    },
    ctx: IContext,
  ): Promise<ThreadResponse & { chartQueryReceipt?: any }> {
    const project = await ctx.projectService.getCurrentProject();
    const expected = await ctx.askingService.getResponse(
      args.responseId,
      project,
    );
    if (!expected?.sql)
      throw new NativeQueryRefusal(404, 'NATIVE_OBJECT_UNAVAILABLE');
    if (
      expected.chartDetail?.queryHistoryId &&
      [ChartStatus.FETCHING, ChartStatus.GENERATING].includes(
        expected.chartDetail.status as ChartStatus,
      )
    ) {
      const history = await ctx.apiHistoryRepository.findOneBy({
        id: expected.chartDetail.queryHistoryId,
      });
      if (!history || history.governanceKey !== args.idempotencyKey)
        throw new NativeQueryRefusal(409, 'NATIVE_EXECUTION_UNKNOWN');
    }
    const receipt = await new ModelResolver().previewSql(
      null,
      {
        data: {
          sql: expected.sql,
          projectId: String(project.id),
          limit: DEFAULT_PREVIEW_LIMIT,
          idempotencyKey: args.idempotencyKey,
          idempotencyScope: args.idempotencyScope,
        },
      },
      ctx,
    );
    if (!queryReceiptState(receipt).completed)
      return { ...expected, chartQueryReceipt: receipt };
    if (
      receipt.nativeType !== 'wren.api_history' ||
      typeof receipt.nativeId !== 'string' ||
      !Array.isArray(receipt.data?.columns) ||
      !Array.isArray(receipt.data?.data)
    )
      throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
    const configurations = {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      nativeQuery: {
        historyId: receipt.nativeId,
        expected,
        data: receipt.data,
      },
    };
    const response = args.data
      ? await ctx.askingService.adjustThreadResponseChart(
          args.responseId,
          args.data,
          configurations,
        )
      : await ctx.askingService.generateThreadResponseChart(
          args.responseId,
          configurations,
        );
    return { ...response, chartQueryReceipt: receipt };
  }

  public async getResponse(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const response = await askingService.getResponse(responseId);
    if (response)
      await this.readNativeViews(
        ctx,
        response.viewId === null || response.viewId === undefined
          ? []
          : [response.viewId],
      );

    return response;
  }

  public async previewData(
    _root: any,
    args: {
      where: {
        responseId: number;
        stepIndex?: number;
        limit?: number;
        idempotencyKey?: string;
        idempotencyScope?: string;
      };
    },
    ctx: IContext,
  ): Promise<any> {
    return this.previewResponseData(args.where, ctx, false);
  }

  public async previewBreakdownData(
    _root: any,
    args: {
      where: {
        responseId: number;
        stepIndex?: number;
        limit?: number;
        idempotencyKey?: string;
        idempotencyScope?: string;
      };
    },
    ctx: IContext,
  ): Promise<any> {
    return this.previewResponseData(args.where, ctx, true);
  }

  private async previewResponseData(
    where: {
      responseId: number;
      stepIndex?: number;
      limit?: number;
      idempotencyKey?: string;
      idempotencyScope?: string;
    },
    ctx: IContext,
    breakdown: boolean,
  ) {
    const independent = () =>
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      ctx.nativeIdentityScope === undefined &&
      ctx.nativeHumanToken === undefined;
    if (independent()) {
      const assertIndependent = () => {
        if (!independent())
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      };
      return breakdown
        ? ctx.askingService.previewBreakdownData(
            where.responseId,
            where.stepIndex,
            where.limit,
            assertIndependent,
          )
        : ctx.askingService.previewData(
            where.responseId,
            where.limit,
            assertIndependent,
          );
    }
    const config = await loadQueryDelivery();
    const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
    const identity = ctx.nativeIdentityScope;
    const token = ctx.nativeHumanToken;
    if (where.idempotencyScope !== scope)
      throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
    const response = await ctx.askingService.getResponse(where.responseId);
    if (!response) throw new Error('Thread response not found');
    if (response.id !== where.responseId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const saved = response.viewId !== null && response.viewId !== undefined;
    if (
      saved &&
      (!Number.isSafeInteger(response.viewId) || response.viewId <= 0)
    )
      throw new NativeQueryRefusal(503, 'QUERY_REFERENCE_UNAVAILABLE');
    const view = saved
      ? (await this.readNativeViews(ctx, [response.viewId])).get(
          response.viewId,
        )
      : undefined;
    if (breakdown && !response.breakdownDetail?.steps?.length)
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const sql = breakdown
      ? constructCteSql(response.breakdownDetail?.steps, where.stepIndex)
      : response.sql;
    if (!sql?.trim())
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    // A normal saved-view answer still consumes its exact original snapshot.
    // Partial CTEs instead need their own SQL/source evidence, never that ticket.
    const exactView =
      view && safeFormatSQL(sql) === safeFormatSQL(view.statement);
    if (view && !breakdown && !exactView)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    if (
      ctx.nativeIdentityScope !== identity ||
      ctx.nativeHumanToken !== token ||
      canonical(await loadQueryDelivery()) !== canonical(config)
    )
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const model = new ModelResolver();
    const receipt = exactView
      ? await model.previewViewSnapshotData(
          {
            where: {
              id: view.id,
              limit: where.limit,
              idempotencyKey: where.idempotencyKey,
              idempotencyScope: where.idempotencyScope,
            },
          },
          ctx,
          view.statement,
        )
      : await model.previewSql(
          null,
          {
            data: {
              sql,
              limit: where.limit ?? DEFAULT_PREVIEW_LIMIT,
              idempotencyKey: where.idempotencyKey,
              idempotencyScope: where.idempotencyScope,
            },
          },
          ctx,
        );

    const current = await ctx.askingService.getResponse(where.responseId);
    const currentViews = view
      ? await this.readNativeViews(ctx, [view.id])
      : undefined;
    const intent = (value: ThreadResponse) => ({
      id: value.id,
      threadId: value.threadId,
      viewId: value.viewId,
      sql: breakdown
        ? constructCteSql(value.breakdownDetail?.steps, where.stepIndex)
        : value.sql,
    });
    if (
      !current ||
      canonical(intent(current)) !== canonical(intent(response)) ||
      (view && canonical(currentViews.get(view.id)) !== canonical(view)) ||
      ctx.nativeIdentityScope !== identity ||
      ctx.nativeHumanToken !== token ||
      canonical(await loadQueryDelivery()) !== canonical(config)
    )
      throw new NativeQueryRefusal(409, 'QUERY_EVIDENCE_UNAVAILABLE');
    return {
      ...receipt,
      responseId: response.id,
      ...(exactView ? { viewId: view.id } : {}),
    };
  }

  public async createInstantRecommendedQuestions(
    _root: any,
    args: { data: { previousQuestions?: string[] } },
    ctx: IContext,
  ): Promise<Task> {
    const { data } = args;
    const askingService = ctx.askingService;
    return askingService.createInstantRecommendedQuestions(data);
  }

  public async getInstantRecommendedQuestions(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<RecommendedQuestionsTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    const result = await askingService.getInstantRecommendedQuestions(taskId);
    return {
      questions: result.response?.questions || [],
      status: result.status,
      error: result.error,
    };
  }

  /**
   * Nested resolvers
   */
  public getThreadResponseNestedResolver = () => ({
    chartDetail: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      if (!parent.chartDetail) return null;
      if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
        const detail = parent.chartDetail;
        if (Object.keys(detail).length === 0) return null;
        if (!detail.queryHistoryId)
          throw new NativeQueryRefusal(503, 'QUERY_TERMINAL_EVIDENCE_REQUIRED');
        const history = await ctx.apiHistoryRepository.findOneBy({
          id: detail.queryHistoryId,
        });
        if (!history || history.requestPayload?.sql !== parent.sql)
          throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
        await new ApiHistoryResolver()
          .getApiHistoryNestedResolver()
          .responsePayload(history, {}, ctx);
        const current = await ctx.askingService.getResponse(parent.id);
        const intent = (value: ThreadResponse) => ({
          id: value.id,
          threadId: value.threadId,
          question: value.question,
          sql: value.sql,
          chartDetail: value.chartDetail,
        });
        if (
          !current ||
          canonical(intent(current)) !== canonical(intent(parent))
        )
          throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      }
      return parent.chartDetail;
    },
    view: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      const viewId = parent.viewId;
      if (viewId === null || viewId === undefined) return null;
      const project = await ctx.projectService.getCurrentProject();
      const response = await ctx.askingService.getResponse(parent.id, project);
      if (!response || response.viewId !== viewId)
        throw new Error('Thread response not found');
      const view = (await this.readNativeViews(ctx, [viewId], project.id)).get(
        viewId,
      );
      const displayName = view.properties
        ? JSON.parse(view.properties)?.displayName
        : view.name;
      return { ...view, displayName };
    },
    answerDetail: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      if (!parent?.answerDetail) return null;
      if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
        if (!parent.answerDetail.queryHistoryId) {
          if (parent.answerDetail.queryId || parent.answerDetail.content)
            throw new NativeQueryRefusal(
              503,
              'QUERY_TERMINAL_EVIDENCE_REQUIRED',
            );
        } else {
          const history = await ctx.apiHistoryRepository.findOneBy({
            id: parent.answerDetail.queryHistoryId,
          });
          if (!history || history.requestPayload?.sql !== parent.sql)
            throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
          // Original GraphQL answer bodies and the stream share the already
          // implemented same-AE/current-HUMAN history disclosure consumer.
          await new ApiHistoryResolver()
            .getApiHistoryNestedResolver()
            .responsePayload(history, {}, ctx);
          const current = await ctx.askingService.getResponse(parent.id);
          const intent = (value: ThreadResponse) => ({
            id: value.id,
            threadId: value.threadId,
            question: value.question,
            sql: value.sql,
            answerDetail: value.answerDetail,
          });
          if (
            !current ||
            canonical(intent(current)) !== canonical(intent(parent))
          )
            throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
        }
      }

      const { content, ...rest } = parent.answerDetail;

      if (!content) return parent.answerDetail;

      const formattedContent = content
        // replace the \\n to \n
        .replace(/\\n/g, '\n')
        // replace the \\\" to \",
        .replace(/\\"/g, '"');

      return {
        ...rest,
        content: formattedContent,
      };
    },
    sql: (parent: ThreadResponse, _args: any, _ctx: IContext) => {
      if (parent.breakdownDetail && parent.breakdownDetail.steps) {
        // construct sql from breakdownDetail
        return safeFormatSQL(constructCteSql(parent.breakdownDetail.steps));
      }
      return parent.sql ? safeFormatSQL(parent.sql) : null;
    },
    askingTask: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      if (parent.adjustment) {
        return null;
      }
      const askingService = ctx.askingService;
      const askingTask = await askingService.getAskingTaskById(
        parent.askingTaskId,
      );
      if (!askingTask) return null;
      await this.authorizeNativeAskingTask(askingTask.queryId, ctx);
      return this.transformAskingTask(askingTask, ctx);
    },
    adjustmentTask: async (
      parent: ThreadResponse,
      _args: any,
      ctx: IContext,
    ): Promise<AdjustmentTask> => {
      if (!parent.adjustment) {
        return null;
      }
      const askingService = ctx.askingService;
      const adjustmentTask = await askingService.getAdjustmentTaskById(
        parent.askingTaskId,
      );
      if (!adjustmentTask) return null;
      await this.authorizeNativeAskingTask(adjustmentTask.queryId, ctx, true);
      return {
        queryId: adjustmentTask?.queryId,
        status: adjustmentTask?.status,
        error: adjustmentTask?.error,
        sql: adjustmentTask?.response?.[0]?.sql,
        traceId: adjustmentTask?.traceId,
        invalidSql: adjustmentTask?.invalidSql
          ? safeFormatSQL(adjustmentTask.invalidSql)
          : null,
      };
    },
  });

  public getDetailStepNestedResolver = () => ({
    sql: (parent: DetailStep, _args: any, _ctx: IContext) => {
      return safeFormatSQL(parent.sql);
    },
  });

  public getResultCandidateNestedResolver = () => ({
    sql: (parent: any, _args: any, _ctx: IContext) => {
      return safeFormatSQL(parent.sql);
    },
    view: async (parent: any, _args: any, ctx: IContext) => {
      if (!parent.view) return parent.view;
      const viewId = parent.view.id;
      const view = (
        await this.readNativeViews(ctx, [viewId], parent.view.projectId)
      ).get(viewId);

      const displayName = view.properties
        ? JSON.parse(view.properties).displayName
        : view.name;
      return {
        ...view,
        displayName,
      };
    },
  });

  private async transformAskingTask(
    askingTask: TrackedAskingResult,
    ctx: IContext,
  ): Promise<AskingTask> {
    const project = await ctx.projectService.getCurrentProject();
    if (askingTask.projectId !== project.id)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const responses = askingTask.response || [];
    let nativeSqlPairs;
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined &&
      responses.some((response) => response.sqlpairId)
    ) {
      const config = await loadQueryDelivery();
      nativePreviewScope(config, ctx.nativeIdentityScope);
      if (!ctx.nativeHumanToken)
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      nativeSqlPairs = await ctx.sqlPairService.getProjectSqlPairs(project.id, {
        config,
        identityScope: ctx.nativeIdentityScope,
        token: ctx.nativeHumanToken,
      });
    }
    const candidates = [];
    for (const response of responses) {
      const sqlPair = response.sqlpairId
        ? nativeSqlPairs
          ? nativeSqlPairs.find((pair) => pair.id === response.sqlpairId)
          : await ctx.sqlPairRepository.findOneBy({
              id: response.sqlpairId,
              projectId: askingTask.projectId,
            })
        : null;
      if (
        nativeSqlPairs &&
        response.sqlpairId &&
        (!sqlPair || sqlPair.nativeWritePending)
      )
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      if (response.sqlpairId && !sqlPair)
        throw new Error('Task resource not found');
      candidates.push({
        type: response.type,
        sql: response.sql,
        view: null,
        sqlPair,
      });
    }
    const views = await this.readNativeViews(
      ctx,
      responses
        .filter(
          (response) =>
            response.viewId !== null && response.viewId !== undefined,
        )
        .map((response) => response.viewId),
      askingTask.projectId,
    );
    for (let index = 0; index < responses.length; index++) {
      candidates[index].view = views.get(responses[index].viewId) || null;
    }

    // When the task got cancelled, the type is not set
    // we set it to TEXT_TO_SQL as default
    const type =
      askingTask?.status === AskResultStatus.STOPPED && !askingTask.type
        ? AskResultType.TEXT_TO_SQL
        : askingTask.type;
    return {
      type,
      status: askingTask.status,
      error: askingTask.error,
      candidates,
      queryId: askingTask.queryId,
      rephrasedQuestion: askingTask.rephrasedQuestion,
      intentReasoning: askingTask.intentReasoning,
      sqlGenerationReasoning: askingTask.sqlGenerationReasoning,
      retrievedTables: askingTask.retrievedTables,
      invalidSql: askingTask.invalidSql
        ? safeFormatSQL(askingTask.invalidSql)
        : null,
      traceId: askingTask.traceId,
    };
  }
}

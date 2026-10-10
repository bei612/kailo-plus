import { getLogger } from '@server/utils';
import {
  AskFeedbackInput,
  AskFeedbackResult,
  AskFeedbackStatus,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAdjustmentType,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import { PostHogTelemetry } from '../telemetry/telemetry';
import { randomUUID } from 'crypto';
import { GeneralErrorCodes } from '../utils/error';
import type { NativeAskingScope } from '../repositories/askingTaskRepository';
import {
  canonical,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';

const logger = getLogger('AdjustmentTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  projectId: number;
  queryId: string;
  taskId?: number;
  lastPolled: number;
  result?: AskFeedbackResult;
  isFinalized: boolean;
  threadResponseId: number;
  question: string;
  originalThreadResponseId: number;
  rerun?: boolean;
  adjustmentPayload?: {
    originalThreadResponseId: number;
    retrievedTables: string[];
    sqlGenerationReasoning: string;
  };
}

export type TrackedAdjustmentResult = AskFeedbackResult & {
  taskId?: number;
  queryId: string;
};

export type CreateAdjustmentTaskInput = AskFeedbackInput & {
  threadId: number;
  question: string;
  originalThreadResponseId: number;
  configurations: { language: string };
  nativeScope?: NativeAskingScope;
  authorizeNative?: (queryId: string) => Promise<unknown>;
  authorizeSource?: () => Promise<void>;
};

export type RerunAdjustmentTaskInput = {
  threadResponseId: number;
  threadId: number;
  projectId: number;
  configurations: { language: string };
  nativeScope?: NativeAskingScope;
  authorizeNative?: (queryId: string) => Promise<unknown>;
  authorizeSource?: () => Promise<void>;
};

export interface IAdjustmentBackgroundTaskTracker {
  createAdjustmentTask(
    input: CreateAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
  getAdjustmentResult(queryId: string): Promise<TrackedAdjustmentResult | null>;
  getAdjustmentResultById(id: number): Promise<TrackedAdjustmentResult | null>;
  cancelAdjustmentTask(queryId: string): Promise<void>;
  rerunAdjustmentTask(
    input: RerunAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
}

export class AdjustmentBackgroundTaskTracker
  implements IAdjustmentBackgroundTaskTracker
{
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    pollingInterval?: number;
    memoryRetentionTime?: number;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.startPolling();
  }

  public async createAdjustmentTask(
    input: CreateAdjustmentTaskInput,
  ): Promise<{ queryId: string; createdThreadResponse: ThreadResponse }> {
    try {
      const bound = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
      if (
        bound &&
        (!input.nativeScope || !input.authorizeNative || !input.authorizeSource)
      )
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      await input.authorizeSource?.();
      const queryId = bound
        ? randomUUID()
        : (await this.wrenAIAdaptor.createAskFeedback(input)).queryId;

      const tx = await this.askingTaskRepository.transaction();
      let createdAskingTask: AskingTask;
      let createdThreadResponse: ThreadResponse;
      try {
        // Native task and its response either become visible together or not at all.
        createdAskingTask = await this.askingTaskRepository.createOne(
          {
            projectId: input.projectId,
            queryId,
            question: input.question,
            threadId: input.threadId,
            detail: {
              adjustment: true,
              status: AskFeedbackStatus.UNDERSTANDING,
              response: [],
              error: null,
              ...(input.nativeScope ? { nativeScope: input.nativeScope } : {}),
            },
          },
          { tx },
        );

        // create a new thread response with adjustment payload
        createdThreadResponse = await this.threadResponseRepository.createOne(
          {
            question: input.question,
            threadId: input.threadId,
            askingTaskId: createdAskingTask.id,
            adjustment: {
              type: ThreadResponseAdjustmentType.REASONING,
              payload: {
                originalThreadResponseId: input.originalThreadResponseId,
                retrievedTables: input.tables,
                sqlGenerationReasoning: input.sqlGenerationReasoning,
              },
            },
          },
          { tx },
        );

        const bound = await this.askingTaskRepository.updateQuery(
          createdAskingTask.id,
          queryId,
          input.projectId,
          {
            threadResponseId: createdThreadResponse.id,
          },
          tx,
        );
        if (!bound) throw new Error('Adjustment task unavailable');
        await this.askingTaskRepository.commit(tx);
      } catch (error) {
        await this.askingTaskRepository.rollback(tx);
        throw error;
      }

      if (bound) {
        await this.authorizeDispatch(
          { taskId: createdAskingTask.id, queryId, projectId: input.projectId },
          async () => {
            await input.authorizeNative(queryId);
            await input.authorizeSource();
          },
        );
        try {
          const response = await this.wrenAIAdaptor.createAskFeedback({
            ...input,
            queryId,
          });
          if (response?.queryId !== queryId)
            logger.warn('Original adjustment acknowledgement unavailable');
        } catch {
          // The original row owns the fixed native ID. Observe it after a lost
          // acknowledgement; never create a replacement or invent FAILED.
          logger.warn('Original adjustment create outcome unavailable');
        }
      }

      // Start tracking this task
      const task = {
        projectId: input.projectId,
        taskId: createdAskingTask.id,
        queryId,
        lastPolled: Date.now(),
        isFinalized: false,
        originalThreadResponseId: input.originalThreadResponseId,
        threadResponseId: createdThreadResponse.id,
        question: input.question,
        adjustmentPayload: {
          originalThreadResponseId: input.originalThreadResponseId,
          retrievedTables: input.tables,
          sqlGenerationReasoning: input.sqlGenerationReasoning,
        },
      } as TrackedTask;
      this.trackedTasks.set(queryId, task);
      this.trackedTasksById.set(createdAskingTask.id, task);

      logger.info(`Created adjustment task with queryId: ${queryId}`);
      return { queryId, createdThreadResponse };
    } catch (err) {
      logger.error(`Failed to create adjustment task: ${err}`);
      throw err;
    }
  }

  public async rerunAdjustmentTask(
    input: RerunAdjustmentTaskInput,
  ): Promise<{ queryId: string }> {
    const currentThreadResponse = await this.threadResponseRepository.findOneBy(
      {
        id: input.threadResponseId,
      },
    );
    if (!currentThreadResponse) {
      throw new Error(`Thread response ${input.threadResponseId} not found`);
    }
    const previous = await this.askingTaskRepository.findOneBy({
      id: currentThreadResponse.askingTaskId,
      projectId: input.projectId,
      threadId: input.threadId,
      threadResponseId: input.threadResponseId,
    });
    if (!previous || currentThreadResponse.threadId !== input.threadId)
      throw new Error('Adjustment task not found');
    const bound = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
    if (
      bound &&
      (!input.nativeScope || !input.authorizeNative || !input.authorizeSource)
    )
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (
      bound &&
      (previous.detail?.nativeScope?.identityScope !==
        input.nativeScope.identityScope ||
        previous.detail.nativeScope.bindingId !== input.nativeScope.bindingId)
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    if (
      bound &&
      ![AskFeedbackStatus.FAILED, AskFeedbackStatus.STOPPED].includes(
        previous.detail?.status as AskFeedbackStatus,
      )
    )
      throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');

    const adjustment = currentThreadResponse.adjustment;
    if (!adjustment) {
      throw new Error(
        `Thread response ${input.threadResponseId} has no adjustment`,
      );
    }

    const originalThreadResponse =
      await this.threadResponseRepository.findOneBy({
        id: adjustment.payload?.originalThreadResponseId,
        threadId: input.threadId,
      });
    if (!originalThreadResponse) {
      throw new Error(
        `Original thread response ${adjustment.payload?.originalThreadResponseId} not found`,
      );
    }

    const feedback = {
      ...input,
      tables: adjustment.payload?.retrievedTables,
      sqlGenerationReasoning: adjustment.payload?.sqlGenerationReasoning,
      sql: originalThreadResponse.sql,
      question: originalThreadResponse.question,
    };
    const authorizeSource = async () => {
      await input.authorizeSource?.();
      if (!bound) return;
      const [current, original] = await Promise.all([
        this.threadResponseRepository.findOneBy({
          id: currentThreadResponse.id,
          threadId: input.threadId,
        }),
        this.threadResponseRepository.findOneBy({
          id: originalThreadResponse.id,
          threadId: input.threadId,
        }),
      ]);
      if (
        canonical(current) !== canonical(currentThreadResponse) ||
        canonical(original) !== canonical(originalThreadResponse)
      )
        throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    };
    await authorizeSource();
    const queryId = bound
      ? randomUUID()
      : (await this.wrenAIAdaptor.createAskFeedback(feedback)).queryId;

    // update asking task with new queryId
    const updated = await this.askingTaskRepository.updateQuery(
      previous.id,
      previous.queryId,
      input.projectId,
      {
        queryId,

        // reset detail
        detail: {
          adjustment: true,
          status: AskFeedbackStatus.UNDERSTANDING,
          response: [],
          error: null,
          ...(input.nativeScope ? { nativeScope: input.nativeScope } : {}),
        },
      },
    );
    if (!updated) throw new Error('Adjustment task changed during dispatch');
    this.trackedTasks.delete(previous.queryId);
    this.trackedTasksById.delete(previous.id);
    if (bound) {
      await this.authorizeDispatch(
        { taskId: previous.id, queryId, projectId: input.projectId },
        async () => {
          await input.authorizeNative(queryId);
          await authorizeSource();
        },
      );
      try {
        const response = await this.wrenAIAdaptor.createAskFeedback({
          ...feedback,
          queryId,
        });
        if (response?.queryId !== queryId)
          logger.warn('Original adjustment acknowledgement unavailable');
      } catch {
        logger.warn('Original adjustment create outcome unavailable');
      }
    }
    // schedule task
    const task = {
      projectId: input.projectId,
      taskId: previous.id,
      queryId,
      lastPolled: Date.now(),
      isFinalized: false,
      originalThreadResponseId: originalThreadResponse.id,
      threadResponseId: currentThreadResponse.id,
      question: originalThreadResponse.question,
      rerun: true,
      adjustmentPayload: {
        originalThreadResponseId: originalThreadResponse.id,
        retrievedTables: adjustment.payload?.retrievedTables,
        sqlGenerationReasoning: adjustment.payload?.sqlGenerationReasoning,
      },
    } as TrackedTask;
    this.trackedTasks.set(queryId, task);
    this.trackedTasksById.set(previous.id, task);

    logger.info(`Rerun adjustment task with queryId: ${queryId}`);
    return { queryId };
  }

  public async getAdjustmentResult(
    queryId: string,
  ): Promise<TrackedAdjustmentResult | null> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        queryId,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAdjustmentResultFromDB({ queryId });
  }

  public async getAdjustmentResultById(
    id: number,
  ): Promise<TrackedAdjustmentResult | null> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAdjustmentResult(task.queryId);
    }

    return this.getAdjustmentResultFromDB({ taskId: id });
  }

  public async cancelAdjustmentTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAskFeedback(queryId);

    // telemetry
    const eventName = TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_CANCEL;
    this.telemetry.sendEvent(eventName, {
      queryId,
    });
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  private startPolling(): void {
    this.pollingIntervalId = setInterval(() => {
      this.pollTasks();
    }, this.pollingInterval);
  }

  private async pollTasks(): Promise<void> {
    const now = Date.now();
    const tasksToRemove: string[] = [];

    // Create an array of job functions
    const jobs = Array.from(this.trackedTasks.entries()).map(
      ([queryId, task]) =>
        async () => {
          try {
            // Skip if the job is already running
            if (this.runningJobs.has(queryId)) {
              return;
            }

            // Skip finalized tasks that have been in memory too long
            if (
              task.isFinalized &&
              now - task.lastPolled > this.memoryRetentionTime
            ) {
              tasksToRemove.push(queryId);
              return;
            }

            // Skip finalized tasks
            if (task.isFinalized) {
              return;
            }

            // Mark the job as running
            this.runningJobs.add(queryId);

            // Poll for updates
            logger.info(`Polling for updates for task ${queryId}`);
            const result =
              await this.wrenAIAdaptor.getAskFeedbackResult(queryId);
            task.lastPolled = now;

            // if result is not changed, we don't need to update the database
            if (!this.isResultChanged(task.result, result)) {
              this.runningJobs.delete(queryId);
              return;
            }

            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              // update thread response if threadResponseId is provided
              await this.updateThreadResponseWhenTaskFinalized(task, result);

              // telemetry
              const eventName = task.rerun
                ? TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_RERUN
                : TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE;
              const eventProperties = {
                taskId: task.taskId,
                queryId: task.queryId,
                status: result.status,
                error: result.error,
                adjustmentPayload: task.adjustmentPayload,
              };
              if (result.status === AskFeedbackStatus.FINISHED) {
                this.telemetry.sendEvent(eventName, eventProperties);
              } else {
                this.telemetry.sendEvent(
                  eventName,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            }

            // update task in memory if any change
            // update the database
            logger.info(`Updating task ${queryId} in database`);
            if (!this.isTaskFinalized(result.status))
              await this.updateTaskInDatabase(task, result);
            task.result = result;
            task.isFinalized = this.isTaskFinalized(result.status);

            // Mark the job as finished
            this.runningJobs.delete(queryId);
          } catch (err) {
            this.runningJobs.delete(queryId);
            logger.error(err.stack);
            throw err;
          }
        },
    );

    // Run all jobs in parallel
    await Promise.allSettled(jobs.map((job) => job())).then((results) => {
      // Log any rejected promises
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Job ${index} failed: ${result.reason}`);
        }
      });

      // Clean up tasks that have been in memory too long
      if (tasksToRemove.length > 0) {
        logger.info(
          `Cleaning up tasks that have been in memory too long. Tasks: ${tasksToRemove.join(
            ', ',
          )}`,
        );
      }
      for (const queryId of tasksToRemove) {
        this.trackedTasks.delete(queryId);
      }
    });
  }

  private async updateThreadResponseWhenTaskFinalized(
    task: TrackedTask,
    result: AskFeedbackResult,
  ): Promise<void> {
    const response = result?.response?.[0];
    const tx = await this.askingTaskRepository.transaction();
    try {
      const record = await this.askingTaskRepository.lockQuery(
        task.taskId,
        task.queryId,
        task.projectId,
        tx,
      );
      if (!record || record.threadResponseId !== task.threadResponseId)
        throw new Error('Adjustment task changed during observation');
      if (response) {
        const target = await this.threadResponseRepository.findOneBy(
          {
            id: task.threadResponseId,
            threadId: record.threadId,
            askingTaskId: record.id,
          },
          { tx },
        );
        if (!target) throw new Error('Thread response not found');
        await this.threadResponseRepository.updateOne(
          task.threadResponseId,
          { sql: response.sql },
          { tx },
        );
      }
      if (
        !(await this.askingTaskRepository.updateQuery(
          record.id,
          task.queryId,
          task.projectId,
          {
            detail: {
              ...result,
              adjustment: true,
              ...(record.detail?.nativeScope
                ? { nativeScope: record.detail.nativeScope }
                : {}),
            },
          },
          tx,
        ))
      )
        throw new Error('Adjustment task changed during observation');
      await this.askingTaskRepository.commit(tx);
    } catch (error) {
      await this.askingTaskRepository.rollback(tx);
      throw error;
    }
  }

  private async getAdjustmentResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAdjustmentResult | null> {
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      return null;
    }

    if (
      !this.trackedTasks.has(taskRecord.queryId) &&
      !this.isTaskFinalized((taskRecord.detail as AskFeedbackResult)?.status)
    ) {
      const task: TrackedTask = {
        projectId: taskRecord.projectId,
        taskId: taskRecord.id,
        queryId: taskRecord.queryId,
        question: taskRecord.question,
        threadResponseId: taskRecord.threadResponseId,
        originalThreadResponseId: undefined,
        lastPolled: Date.now(),
        isFinalized: false,
      };
      this.trackedTasks.set(task.queryId, task);
      this.trackedTasksById.set(taskRecord.id, task);
    }

    return {
      ...(taskRecord?.detail as AskFeedbackResult),
      queryId: queryId || taskRecord?.queryId,
      taskId: taskRecord?.id,
    };
  }

  private async authorizeDispatch(
    task: Pick<TrackedTask, 'taskId' | 'queryId' | 'projectId'>,
    authorize: () => Promise<void>,
  ): Promise<void> {
    try {
      await authorize();
    } catch (error) {
      // No AI POST has occurred: this is a known admission failure, unlike a
      // lost acknowledgement after dispatch. Persist through the original CAS.
      await this.updateTaskInDatabase(task, {
        status: AskFeedbackStatus.FAILED,
        response: [],
        error: {
          code: GeneralErrorCodes.INTERNAL_SERVER_ERROR,
          message:
            error instanceof NativeQueryRefusal
              ? error.code
              : 'QUERY_ADMISSION_UNAVAILABLE',
        },
      });
      this.trackedTasks.delete(task.queryId);
      if (this.trackedTasksById.get(task.taskId)?.queryId === task.queryId)
        this.trackedTasksById.delete(task.taskId);
      throw error;
    }
  }

  private async updateTaskInDatabase(
    task: Pick<TrackedTask, 'taskId' | 'queryId' | 'projectId'>,
    result: AskFeedbackResult,
  ): Promise<void> {
    const tx = await this.askingTaskRepository.transaction();
    try {
      const record = await this.askingTaskRepository.lockQuery(
        task.taskId,
        task.queryId,
        task.projectId,
        tx,
      );
      if (!record)
        throw new Error('Adjustment task changed during observation');
      const updated = await this.askingTaskRepository.updateQuery(
        task.taskId,
        task.queryId,
        task.projectId,
        {
          detail: {
            adjustment: true,
            ...result,
            ...(record.detail?.nativeScope
              ? { nativeScope: record.detail.nativeScope }
              : {}),
          },
        },
        tx,
      );
      if (!updated)
        throw new Error('Adjustment task changed during observation');
      await this.askingTaskRepository.commit(tx);
    } catch (error) {
      await this.askingTaskRepository.rollback(tx);
      throw error;
    }
  }

  private isTaskFinalized(status: AskFeedbackStatus): boolean {
    return [
      AskFeedbackStatus.FINISHED,
      AskFeedbackStatus.FAILED,
      AskFeedbackStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskFeedbackResult,
    newResult: AskFeedbackResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }
}

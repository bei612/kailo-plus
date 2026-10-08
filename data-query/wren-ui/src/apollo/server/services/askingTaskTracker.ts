import { getLogger } from '@server/utils';
import {
  AskResult,
  AskResultType,
  AskResultStatus,
  AskInput,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  IThreadResponseRepository,
  IViewRepository,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';
import * as Errors from '@server/utils/error';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type { NativeAskingScope } from '../repositories/askingTaskRepository';
import { NativeQueryRefusal } from './nativeQueryAdmission';

const logger = getLogger('AskingTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  projectId: number;
  queryId: string;
  taskId?: number;
  lastPolled: number;
  question?: string;
  result?: AskResult;
  isFinalized: boolean;
  threadResponseId?: number;
  rerunFromCancelled?: boolean;
}

export type TrackedAskingResult = AskResult & {
  projectId: number;
  taskId?: number;
  queryId: string;
  question: string;
};

export type CreateAskingTaskInput = AskInput & {
  projectId: number;
  rerunFromCancelled?: boolean;
  previousTaskId?: number;
  threadResponseId?: number;
  nativeScope?: NativeAskingScope;
  authorizeNative?: (queryId: string) => Promise<unknown>;
};

export interface IAskingTaskTracker {
  createAskingTask(input: CreateAskingTaskInput): Promise<{ queryId: string }>;
  getAskingResult(queryId: string): Promise<TrackedAskingResult | null>;
  getAskingResultById(id: number): Promise<TrackedAskingResult | null>;
  cancelAskingTask(queryId: string): Promise<void>;
  bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
    projectId: number,
    tx?: Knex.Transaction,
  ): Promise<void>;
}

export class AskingTaskTracker implements IAskingTaskTracker {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private viewRepository: IViewRepository;

  constructor({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    viewRepository: IViewRepository;
    pollingInterval?: number;
    memoryRetentionTime?: number;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.viewRepository = viewRepository;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.startPolling();
  }

  public async createAskingTask(
    input: CreateAskingTaskInput,
  ): Promise<{ queryId: string }> {
    try {
      // validate the input
      if (
        input.rerunFromCancelled &&
        (!input.previousTaskId || !input.threadResponseId)
      ) {
        throw new Error(
          'Previous task id and thread response id are required if rerun from cancelled',
        );
      }

      const previous = input.rerunFromCancelled
        ? await this.askingTaskRepository.findOneBy({
            id: input.previousTaskId,
            projectId: input.projectId,
            threadResponseId: input.threadResponseId,
          })
        : null;
      if (input.rerunFromCancelled && !previous)
        throw new Error('Asking task not found');

      const bound = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
      if (bound && (!input.nativeScope || !input.authorizeNative))
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      if (
        bound &&
        previous &&
        (previous.detail?.nativeScope?.identityScope !==
          input.nativeScope.identityScope ||
          previous.detail.nativeScope.bindingId !== input.nativeScope.bindingId)
      )
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const queryId = bound
        ? input.queryId ?? randomUUID()
        : (await this.wrenAIAdaptor.ask(input)).queryId;
      const detail = {
        status: AskResultStatus.UNDERSTANDING,
        ...(input.nativeScope ? { nativeScope: input.nativeScope } : {}),
      } as AskResult;
      const record = previous
        ? await this.askingTaskRepository.updateQuery(
            previous.id,
            previous.queryId,
            input.projectId,
            { queryId, detail },
          )
        : await this.askingTaskRepository.createOne({
            queryId,
            projectId: input.projectId,
            question: input.query,
            detail,
          });
      if (!record) throw new Error('Asking task changed during dispatch');
      if (bound) {
        await input.authorizeNative(queryId);
        try {
          const response = await this.wrenAIAdaptor.ask({ ...input, queryId });
          if (response?.queryId !== queryId)
            logger.warn('Original native task acknowledgement unavailable');
        } catch {
          // This original row owns the fixed native ID. Reattach observation;
          // lost create ACK never authorizes a replacement POST or FAILED.
          logger.warn('Original native task create outcome unavailable');
        }
      }
      if (previous) this.trackedTasks.delete(previous.queryId);

      // Start tracking this task
      const task = {
        projectId: input.projectId,
        taskId: record.id,
        queryId,
        lastPolled: Date.now(),
        question: input.query,
        isFinalized: false,
        rerunFromCancelled: input.rerunFromCancelled,
      } as TrackedTask;
      this.trackedTasks.set(queryId, task);
      this.trackedTasksById.set(record.id, task);

      // if rerun from cancelled, we update the query id to the previous task
      if (
        input.rerunFromCancelled &&
        input.previousTaskId &&
        input.threadResponseId
      ) {
        // set the thread response id in memory to bind the task to the thread response
        // we don't have to update to database here because the thread response id is already set in database
        task.threadResponseId = input.threadResponseId;

        // update the task id in memory
        this.trackedTasksById.set(input.previousTaskId, task);
      }

      logger.info(`Created asking task with queryId: ${queryId}`);
      return { queryId };
    } catch (err) {
      logger.error(`Failed to create asking task: ${err}`);
      throw err;
    }
  }

  public async getAskingResult(
    queryId: string,
  ): Promise<TrackedAskingResult | null> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        projectId: trackedTask.projectId,
        queryId,
        question: trackedTask.question,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAskingResultFromDB({ queryId });
  }

  public async getAskingResultById(
    id: number,
  ): Promise<TrackedAskingResult | null> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAskingResult(task.queryId);
    }

    return this.getAskingResultFromDB({ taskId: id });
  }

  public async cancelAskingTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAsk(queryId);
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  public async bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
    projectId: number,
    tx?: Knex.Transaction,
  ): Promise<void> {
    const record = await this.askingTaskRepository.bindResponse(
      id,
      queryId,
      projectId,
      threadId,
      threadResponseId,
      tx,
    );
    if (!record) throw new Error('Asking task already bound or unavailable');
    const target = await this.threadResponseRepository.findOneBy(
      { id: threadResponseId, threadId, askingTaskId: id },
      { tx },
    );
    if (!target) throw new Error('Thread response not found');
    const result = record.detail as AskResult;
    const response = result?.response?.[0];
    if (response && this.isTaskFinalized(result.status)) {
      const view = response.viewId
        ? await this.viewRepository.findOneBy(
            { id: response.viewId, projectId },
            { tx },
          )
        : null;
      if (response.viewId && !view) throw new Error('View not found');
      await this.threadResponseRepository.updateOne(
        threadResponseId,
        {
          sql: view ? view.statement : response.sql,
          ...(view ? { viewId: view.id } : {}),
        },
        { tx },
      );
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
            const result = await this.wrenAIAdaptor.getAskResult(queryId);
            task.lastPolled = now;

            // if result is not changed, we don't need to update the database
            if (!this.isResultChanged(task.result, result)) {
              this.runningJobs.delete(queryId);
              return;
            }

            // if result is still understanding, we don't need to update the database
            if (result.status === AskResultStatus.UNDERSTANDING) {
              task.result = result;
              this.runningJobs.delete(queryId);
              return;
            }

            // if it's identified as GENERAL or MISLEADING_QUER
            // retain the native non-SQL result in its already-owned task row
            if (
              result.type === AskResultType.GENERAL ||
              result.type === AskResultType.MISLEADING_QUERY
            ) {
              // Only a finished non-SQL response is a failed SQL rerun.
              // Classification is not terminal evidence; preserve generation,
              // cancellation and native failure until the original query settles.
              if (
                task.rerunFromCancelled &&
                result.status === AskResultStatus.FINISHED
              ) {
                const errorCode =
                  result.type === AskResultType.GENERAL
                    ? Errors.GeneralErrorCodes.IDENTIED_AS_GENERAL
                    : Errors.GeneralErrorCodes.IDENTIED_AS_MISLEADING_QUERY;
                const error = {
                  code: errorCode,
                  message: Errors.errorMessages[errorCode],
                  shortMessage: Errors.shortMessages[errorCode],
                };
                await this.updateTaskInDatabase(
                  { queryId },
                  {
                    ...task,
                    // update the status to failed
                    // and the error message should be "IDENTIED_AS_GENERAL" or "IDENTIED_AS_MISLEADING_QUERY"
                    result: {
                      ...result,
                      status: AskResultStatus.FAILED,
                      error,
                    },
                  },
                );
              } else {
                await this.updateTaskInDatabase(
                  { queryId },
                  { ...task, result },
                );
              }
              task.result = result;
              task.isFinalized = this.isTaskFinalized(result.status);
              this.runningJobs.delete(queryId);
              return;
            }

            // update the database
            // note: type could be null if it's still being understood or it's stopped
            // we already filtered out the understanding status above
            // so we update to database if it's stopped as well here.
            logger.info(`Updating task ${queryId} in database`);
            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              // update thread response if threadResponseId is provided
              await this.updateThreadResponseWhenTaskFinalized({
                ...task,
                result,
              });
              task.isFinalized = true;

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            } else {
              await this.updateTaskInDatabase({ queryId }, { ...task, result });
            }

            task.result = result;

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
  ): Promise<void> {
    const response = task?.result?.response?.[0];
    const tx = await this.askingTaskRepository.transaction();
    try {
      const record = await this.askingTaskRepository.lockQuery(
        task.taskId,
        task.queryId,
        task.projectId,
        tx,
      );
      if (!record) throw new Error('Asking task changed during observation');
      if (response && record.threadResponseId) {
        const target = await this.threadResponseRepository.findOneBy(
          {
            id: record.threadResponseId,
            threadId: record.threadId,
            askingTaskId: record.id,
          },
          { tx },
        );
        if (!target) throw new Error('Thread response not found');
        const view = response.viewId
          ? await this.viewRepository.findOneBy(
              { id: response.viewId, projectId: task.projectId },
              { tx },
            )
          : null;
        if (response.viewId && !view) throw new Error('View not found');
        await this.threadResponseRepository.updateOne(
          record.threadResponseId,
          {
            sql: view ? view.statement : response.sql,
            ...(view ? { viewId: view.id } : {}),
          },
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
              ...task.result,
              ...(record.detail?.nativeScope
                ? { nativeScope: record.detail.nativeScope }
                : {}),
            },
          },
          tx,
        ))
      )
        throw new Error('Asking task changed during observation');
      await this.askingTaskRepository.commit(tx);
    } catch (error) {
      await this.askingTaskRepository.rollback(tx);
      throw error;
    }
  }

  private async getAskingResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAskingResult | null> {
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      return null;
    }

    // Reattach only the acknowledged native query. Reads never redispatch work.
    const detail = taskRecord.detail as AskResult;
    if (
      !this.trackedTasks.has(taskRecord.queryId) &&
      !this.isTaskFinalized(detail?.status)
    ) {
      const task: TrackedTask = {
        projectId: taskRecord.projectId,
        taskId: taskRecord.id,
        queryId: taskRecord.queryId,
        question: taskRecord.question,
        threadResponseId: taskRecord.threadResponseId,
        lastPolled: Date.now(),
        isFinalized: false,
      };
      this.trackedTasks.set(task.queryId, task);
      this.trackedTasksById.set(taskRecord.id, task);
    }

    return {
      ...(taskRecord?.detail as AskResult),
      projectId: taskRecord.projectId,
      queryId: queryId || taskRecord?.queryId,
      question: taskRecord?.question,
      taskId: taskRecord?.id,
    };
  }

  private async updateTaskInDatabase(
    filter: { queryId?: string; taskId?: number },
    trackedTask: TrackedTask,
  ): Promise<void> {
    const { queryId, taskId } = filter;
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findOneBy({
        queryId,
        projectId: trackedTask.projectId,
      });
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({
        id: taskId,
        projectId: trackedTask.projectId,
      });
    }
    if (
      !taskRecord ||
      !(await this.askingTaskRepository.updateQuery(
        taskRecord.id,
        trackedTask.queryId,
        trackedTask.projectId,
        {
          detail: {
            ...trackedTask.result,
            ...(taskRecord.detail?.nativeScope
              ? { nativeScope: taskRecord.detail.nativeScope }
              : {}),
          },
        },
      ))
    ) {
      throw new Error('Asking task changed during observation');
    }
  }

  private isTaskFinalized(status: AskResultStatus): boolean {
    return [
      AskResultStatus.FINISHED,
      AskResultStatus.FAILED,
      AskResultStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskResult,
    newResult: AskResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }
}

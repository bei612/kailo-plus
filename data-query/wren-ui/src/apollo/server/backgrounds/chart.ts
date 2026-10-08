import { ChartStatus, ChartType } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '@server/repositories';
import { getLogger } from '@server/utils/logger';
import { NativeQueryRefusal } from '../services/nativeQueryAdmission';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '@server/telemetry/telemetry';

const logger = getLogger('ChartBackgroundTracker');
logger.level = 'debug';

const isFinalized = (status: ChartStatus) => {
  return (
    status === ChartStatus.FINISHED ||
    status === ChartStatus.FAILED ||
    status === ChartStatus.STOPPED
  );
};

export class ChartBackgroundTracker {
  protected readonly adjustment: boolean = false;
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

  private start() {
    logger.info('Chart background tracker started');
    setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);
          try {
            // get the chart detail
            const chartDetail = threadResponse.chartDetail;

            // get the latest result from AI service
            const bound =
              process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
            if (bound && (!chartDetail?.queryHistoryId || !chartDetail.queryId))
              throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
            const result = await (this.adjustment
              ? this.wrenAIAdaptor.getChartAdjustmentResult(chartDetail.queryId)
              : this.wrenAIAdaptor.getChartResult(chartDetail.queryId));
            if (bound && !Object.values(ChartStatus).includes(result?.status))
              throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
            if (
              bound &&
              result.status === ChartStatus.FINISHED &&
              (!result.response ||
                typeof result.response.reasoning !== 'string' ||
                ![...Object.values(ChartType), ''].includes(
                  result.response.chartType,
                ) ||
                !result.response.chartSchema ||
                typeof result.response.chartSchema !== 'object' ||
                Array.isArray(result.response.chartSchema))
            )
              throw new NativeQueryRefusal(
                503,
                'QUERY_TERMINAL_EVIDENCE_REQUIRED',
              );

            // check if status change
            if (chartDetail.status === result.status) {
              // mark the job as finished
              logger.debug(
                `Job ${threadResponse.id} chart status not changed, finished`,
              );
              return;
            }

            // update database
            const updatedChartDetail = {
              ...chartDetail,
              queryId: chartDetail.queryId,
              status: result?.status,
              error: result?.error,
              description: result?.response?.reasoning,
              chartType: result?.response?.chartType?.toUpperCase() || null,
              chartSchema: result?.response?.chartSchema,
              ...(this.adjustment ? { adjustment: true } : {}),
            };
            logger.debug(
              `Job ${threadResponse.id} chart status changed, updating`,
            );
            const updated = bound
              ? await this.threadResponseRepository.claimNativeChart(
                  threadResponse,
                  updatedChartDetail,
                )
              : await this.threadResponseRepository.updateOne(
                  threadResponse.id,
                  {
                    chartDetail: updatedChartDetail,
                  },
                );
            if (!updated) {
              delete this.tasks[threadResponse.id];
              return;
            }
            this.tasks[threadResponse.id] = updated;

            // remove the task from tracker if it is finalized
            if (isFinalized(result.status)) {
              const eventProperties = {
                question: threadResponse.question,
                error: result.error,
              };
              if (result.status === ChartStatus.FINISHED) {
                this.telemetry.sendEvent(
                  this.adjustment
                    ? TelemetryEvent.HOME_ANSWER_ADJUST_CHART
                    : TelemetryEvent.HOME_ANSWER_CHART,
                  eventProperties,
                );
              } else {
                this.telemetry.sendEvent(
                  this.adjustment
                    ? TelemetryEvent.HOME_ANSWER_ADJUST_CHART
                    : TelemetryEvent.HOME_ANSWER_CHART,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }
              logger.debug(
                `Job ${threadResponse.id} chart is finalized, removing`,
              );
              delete this.tasks[threadResponse.id];
            }

            // mark the job as finished
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      // run the jobs
      await Promise.allSettled(jobs.map((job) => job())).then((results) => {
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

export class ChartAdjustmentBackgroundTracker extends ChartBackgroundTracker {
  protected override readonly adjustment = true;
}

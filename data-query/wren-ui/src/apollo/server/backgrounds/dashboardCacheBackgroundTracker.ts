import { getLogger } from '@server/utils';
import {
  IDashboardRepository,
  IDashboardItemRepository,
  IDashboardItemRefreshJobRepository,
  DashboardCacheRefreshStatus,
} from '@server/repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
} from '@server/services';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { NativeQueryRefusal } from '../services/nativeQueryAdmission';

const logger = getLogger('DashboardCacheBackgroundTracker');
logger.level = 'debug';

export class DashboardCacheBackgroundTracker {
  private intervalTime: number;
  private dashboardRepository: IDashboardRepository;
  private dashboardItemRepository: IDashboardItemRepository;
  private dashboardItemRefreshJobRepository: IDashboardItemRefreshJobRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private runningJobs = new Set<number>();

  constructor({
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    projectService,
    deployService,
    queryService,
  }: {
    dashboardRepository: IDashboardRepository;
    dashboardItemRepository: IDashboardItemRepository;
    dashboardItemRefreshJobRepository: IDashboardItemRefreshJobRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
  }) {
    this.dashboardRepository = dashboardRepository;
    this.dashboardItemRepository = dashboardItemRepository;
    this.dashboardItemRefreshJobRepository = dashboardItemRefreshJobRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.intervalTime = 60000; // 1 minute
    this.start();
  }

  private start(): void {
    // A binding's SERVICE credential is not SQL admission. Scheduled native
    // refresh has no HUMAN/AGENT Action; do not start its standalone timer in
    // a configured instance. Original schedules/data and HUMAN refresh remain.
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) return;
    logger.info('Dashboard cache background tracker started');
    setInterval(() => {
      this.checkAndRefreshCaches();
    }, this.intervalTime);
  }

  private async checkAndRefreshCaches(): Promise<void> {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) return;
    try {
      // Get all dashboards with cache enabled
      const dashboards = await this.dashboardRepository.findAllBy({
        cacheEnabled: true,
      });

      for (const dashboard of dashboards) {
        if (!dashboard.scheduleCron || !dashboard.nextScheduledAt) {
          continue;
        }

        const now = new Date();
        const nextScheduledAt = new Date(dashboard.nextScheduledAt);

        // Check if it's time to refresh
        if (now >= nextScheduledAt) {
          logger.info(`Start Refreshing cache for dashboard ${dashboard.id}`);
          if (await this.refreshDashboardCache(dashboard))
            logger.info(
              `Finished Refreshing cache for dashboard ${dashboard.id}`,
            );
        }
      }
    } catch (error) {
      logger.error(`Error checking dashboard caches: ${error.message}`);
    }
  }

  private async refreshDashboardCache(dashboard: any): Promise<boolean> {
    if (this.runningJobs.has(dashboard.id)) {
      logger.debug(`Dashboard ${dashboard.id} refresh already in progress`);
      return false;
    }

    this.runningJobs.add(dashboard.id);

    try {
      // Get all items for this dashboard
      const items = await this.dashboardItemRepository.findAllBy({
        dashboardId: dashboard.id,
      });

      // Get project and deployment info
      const project = await this.projectService.getCurrentProject();
      const deployment = await this.deployService.getLastDeployment(project.id);
      const mdl = deployment.manifest;
      const hash = uuidv4();

      // Refresh cache for each item
      await Promise.all(
        items.map(async (item) => {
          try {
            this.assertIndependentQuery();
            // Create a record for this refresh job
            const refreshJob =
              await this.dashboardItemRefreshJobRepository.createOne({
                hash,
                dashboardId: dashboard.id,
                dashboardItemId: item.id,
                startedAt: new Date(),
                finishedAt: null,
                status: DashboardCacheRefreshStatus.IN_PROGRESS,
                errorMessage: null,
              });

            try {
              // The native reads/job insert above await storage. A newly
              // delivered binding must stop this already-scheduled job before
              // its original QueryService can send an unadmitted SQL request.
              this.assertIndependentQuery();
              await this.queryService.preview(item.detail.sql, {
                project,
                manifest: mdl,
                cacheEnabled: true,
                refresh: true,
              });

              // Update the record with success
              await this.dashboardItemRefreshJobRepository.updateOne(
                refreshJob.id,
                {
                  finishedAt: new Date(),
                  status: DashboardCacheRefreshStatus.SUCCESS,
                },
              );
            } catch (error) {
              // Update the record with failure
              await this.dashboardItemRefreshJobRepository.updateOne(
                refreshJob.id,
                {
                  finishedAt: new Date(),
                  status: DashboardCacheRefreshStatus.FAILED,
                  errorMessage: error.message,
                },
              );
              logger.debug(
                `Error refreshing cache for item ${item.id}: ${error.message}`,
              );
            }
          } catch (error) {
            logger.debug(
              `Error creating refresh job record for item ${item.id}: ${error.message}`,
            );
          }
        }),
      );

      // Do not advance or report a completed standalone schedule after its
      // execution mode changed. Already-sent native reads are not cancelled.
      this.assertIndependentQuery();
      // Calculate next scheduled time
      const nextScheduledAt = this.calculateNextRunTime(dashboard.scheduleCron);

      // Update dashboard with new next scheduled time
      await this.dashboardRepository.updateOne(dashboard.id, {
        nextScheduledAt,
      });
      logger.info(
        `Next scheduled time for dashboard ${dashboard.id}: ${nextScheduledAt}`,
      );

      logger.info(`Successfully refreshed cache for dashboard ${dashboard.id}`);
      return true;
    } catch (error) {
      logger.error(
        `Error refreshing dashboard ${dashboard.id}: ${error.message}`,
      );
      return false;
    } finally {
      this.runningJobs.delete(dashboard.id);
    }
  }

  private assertIndependentQuery(): void {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }

  private calculateNextRunTime(cronExpression: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: new Date(),
      });
      return interval.next().toDate();
    } catch (error) {
      logger.error(`Failed to parse cron expression: ${error.message}`);
      return null;
    }
  }
}

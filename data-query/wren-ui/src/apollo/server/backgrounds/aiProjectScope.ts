import { getLogger } from '@server/utils';
import { IProjectRepository } from '../repositories/projectRepository';
import {
  DeployStatusEnum,
  IDeployLogRepository,
} from '../repositories/deployLogRepository';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import { WrenAIDeployStatusEnum } from '../models/adaptor';
import { isGovernedQueryMode } from '../services/nativeQueryMode';

// DD-169(7)②: deployments made before DD-169 were prepared in the AI Service
// without a `project_id`, so their documents are not retrieved by the
// project-scoped asks. Once after the upgrade, the last successful deployment
// of each data source is prepared again with its `project_id` — same manifest,
// same hash and execution id, no new deployment row and no model change. A
// project is marked only after the AI Service reports success; failures are
// retried on the next round. GOVERNED instances keep their captured native
// deployment evidence untouched and are skipped.

const logger = getLogger('AiProjectScope');
logger.level = 'info';

export class AiProjectScopeBackfill {
  private running = false;

  constructor(
    private readonly projectRepository: IProjectRepository,
    private readonly deployLogRepository: IDeployLogRepository,
    private readonly wrenAIAdaptor: IWrenAIAdaptor,
    private readonly retryMs = 60_000,
    private readonly maxRounds = 30,
  ) {}

  public start(delayMs = 15_000) {
    if (isGovernedQueryMode()) return;
    let rounds = 0;
    const tick = async () => {
      rounds += 1;
      const pending = await this.runOnce().catch((error) => {
        logger.error(`AI project scope backfill failed: ${error?.message}`);
        return 1;
      });
      if (pending > 0 && rounds < this.maxRounds)
        setTimeout(tick, this.retryMs).unref?.();
    };
    setTimeout(tick, delayMs).unref?.();
  }

  /** One round; returns the number of data sources still to prepare. */
  public async runOnce(): Promise<number> {
    if (this.running) return 1;
    this.running = true;
    let pending = 0;
    try {
      const projects = await this.projectRepository.findAllBy({
        kailoAiProjectScoped: false,
      } as any);
      for (const project of projects) {
        const deploy = await this.deployLogRepository.findLastProjectDeployLog(
          project.id,
        );
        if (!deploy || deploy.status !== DeployStatusEnum.SUCCESS) {
          // Nothing deployed yet: the next deployment carries project_id.
          await this.projectRepository.updateOne(project.id, {
            kailoAiProjectScoped: true,
          } as any);
          continue;
        }
        const result = await this.wrenAIAdaptor.deploy({
          manifest: deploy.manifest,
          hash: deploy.hash,
          executionId: String(deploy.id),
          projectId: project.id,
        });
        if (result.status === WrenAIDeployStatusEnum.SUCCESS) {
          await this.projectRepository.updateOne(project.id, {
            kailoAiProjectScoped: true,
          } as any);
          logger.info(`Data source ${project.id} prepared with project scope`);
        } else pending += 1;
      }
    } finally {
      this.running = false;
    }
    return pending;
  }
}

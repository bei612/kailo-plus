import type { Knex } from 'knex';
import { WrenAIDeployStatusEnum } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import {
  Deploy,
  DeployStatusEnum,
  IDeployLogRepository,
} from '../repositories/deployLogRepository';
import { Manifest } from '../mdl/type';
import { createHash } from 'node:crypto';
import { getLogger } from '@server/utils';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';

const logger = getLogger('DeployService');
logger.level = 'debug';

export interface DeployResponse {
  status: DeployStatusEnum;
  error?: string;
}

export interface MDLSyncResponse {
  isSyncronized: boolean;
}

export interface IDeployService {
  deploy(
    manifest: Manifest,
    projectId: number,
    force?: boolean,
  ): Promise<DeployResponse>;
  getLastDeployment(projectId: number): Promise<Deploy>;
  getInProgressDeployment(projectId: number): Promise<Deploy>;
  createMDLHash(manifest: Manifest, projectId: number): string;
  getMDLByHash(hash: string): Promise<string>;
  deleteAllByProjectId(projectId: number, tx?: Knex.Transaction): Promise<void>;
}

export class DeployService implements IDeployService {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployLogRepository: IDeployLogRepository;
  private telemetry: PostHogTelemetry;

  constructor({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    deployLogRepository: IDeployLogRepository;
    telemetry: PostHogTelemetry;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployLogRepository = deployLogRepository;
    this.telemetry = telemetry;
  }

  public async getLastDeployment(projectId) {
    const lastDeploy =
      await this.deployLogRepository.findLastProjectDeployLog(projectId);
    if (!lastDeploy) {
      return null;
    }
    return lastDeploy;
  }

  public async getInProgressDeployment(projectId) {
    const deploy =
      await this.deployLogRepository.findInProgressProjectDeployLog(projectId);
    if (!deploy) return null;
    const result = await this.observe(deploy);
    return result.status === DeployStatusEnum.IN_PROGRESS ? deploy : null;
  }

  public async deploy(manifest, projectId, force = false) {
    const eventName = TelemetryEvent.MODELING_DEPLOY_MDL;
    const hash = this.createMDLHash(manifest, projectId);
    const { deploy, created } = await this.deployLogRepository.beginDeployment(
      {
        manifest,
        hash,
        projectId,
        status: DeployStatusEnum.IN_PROGRESS,
      },
      force,
    );
    if (!created) {
      if (deploy.status === DeployStatusEnum.SUCCESS) {
        return { status: DeployStatusEnum.SUCCESS };
      }
      const result = await this.observe(deploy);
      // Observing another manifest is not deploying the requested one.
      return deploy.hash === hash
        ? result
        : { status: DeployStatusEnum.IN_PROGRESS };
    }
    try {
      logger.debug(`Deploying model, hash: ${hash}`);

      // deploy to AI-service
      const { status: aiStatus, error: aiError } =
        await this.wrenAIAdaptor.deploy({
          manifest,
          hash,
          executionId: String(deploy.id),
        });

      const status = this.nativeStatus(aiStatus);
      if (status === DeployStatusEnum.IN_PROGRESS) return { status };
      await this.deployLogRepository.updateOne(deploy.id, {
        status,
        error: aiError,
      });

      // telemetry
      if (status === DeployStatusEnum.SUCCESS) {
        this.telemetry.sendEvent(eventName);
      } else {
        this.telemetry.sendEvent(
          eventName,
          { mdl: manifest, error: aiError },
          WrenService.AI,
          false,
        );
      }
      return { status, error: aiError };
    } catch (err: any) {
      logger.error(`Error deploying model: ${err.message}`);
      // HTTP or persistence failure after the durable intent is not a terminal
      // deployment failure. Original modelSync polling observes this same log.
      return { status: DeployStatusEnum.IN_PROGRESS };
    }
  }

  private nativeStatus(status: WrenAIDeployStatusEnum): DeployStatusEnum {
    switch (status) {
      case WrenAIDeployStatusEnum.SUCCESS:
        return DeployStatusEnum.SUCCESS;
      case WrenAIDeployStatusEnum.FAILED:
        return DeployStatusEnum.FAILED;
      default:
        return DeployStatusEnum.IN_PROGRESS;
    }
  }

  private async observe(deploy: Deploy): Promise<DeployResponse> {
    try {
      const result = await this.wrenAIAdaptor.observeDeploy(
        deploy.hash,
        String(deploy.id),
      );
      const status = this.nativeStatus(result.status);
      if (status !== DeployStatusEnum.IN_PROGRESS) {
        await this.deployLogRepository.updateOne(deploy.id, {
          status,
          error: result.error,
        });
      }
      return { status, error: result.error };
    } catch {
      return { status: DeployStatusEnum.IN_PROGRESS };
    }
  }

  public createMDLHash(manifest: Manifest, projectId: number) {
    const manifestStr = JSON.stringify(manifest);
    const content = `${projectId} ${manifestStr}`;
    const hash = createHash('sha1').update(content).digest('hex');
    return hash;
  }

  public async getMDLByHash(hash: string) {
    const deploy = await this.deployLogRepository.findOneBy({ hash });
    if (!deploy) {
      return null;
    }
    // return base64 encoded manifest
    return Buffer.from(JSON.stringify(deploy.manifest)).toString('base64');
  }

  public async deleteAllByProjectId(
    projectId: number,
    tx?: Knex.Transaction,
  ): Promise<void> {
    // delete all deploy logs
    await this.deployLogRepository.deleteAllBy({ projectId }, { tx });
  }
}

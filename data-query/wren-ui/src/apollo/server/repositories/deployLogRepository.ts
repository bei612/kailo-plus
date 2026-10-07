import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';

export interface Deploy {
  id: number; // ID
  projectId: number; // Reference to project.id
  manifest: object; // Model manifest
  hash: string;
  status: string; // Deploy status
  error: string; // Error message
}

export enum DeployStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface IDeployLogRepository extends IBasicRepository<Deploy> {
  beginDeployment(
    data: Partial<Deploy>,
    force: boolean,
  ): Promise<{ deploy: Deploy; created: boolean }>;
  findLastProjectDeployLog(projectId: number): Promise<Deploy | null>;
  findInProgressProjectDeployLog(projectId: number): Promise<Deploy | null>;
}

export class DeployLogRepository
  extends BaseRepository<Deploy>
  implements IDeployLogRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'deploy_log' });
  }

  public async beginDeployment(data: Partial<Deploy>, force: boolean) {
    // Lock the existing project, not a process-local flag. Commit the original
    // deploy_log before HTTP; a concurrent/force request must observe its intent.
    // SQLite's write serialization rejects an overlapping snapshot upgrade.
    return this.knex.transaction(async (tx) => {
      const project = await tx('project')
        .where({ id: data.projectId })
        .first()
        .forUpdate();
      if (!project) throw new Error('Project not found');
      const pending = await tx(this.tableName)
        .where({
          project_id: data.projectId,
          status: DeployStatusEnum.IN_PROGRESS,
        })
        .orderBy('id', 'desc')
        .first();
      if (pending)
        return { deploy: this.transformFromDBData(pending), created: false };
      if (!force) {
        const last = await tx(this.tableName)
          .where({
            project_id: data.projectId,
            status: DeployStatusEnum.SUCCESS,
          })
          .orderBy('id', 'desc')
          .first();
        if (last?.hash === data.hash) {
          return { deploy: this.transformFromDBData(last), created: false };
        }
      }
      const deploy = await this.createOne(data, { tx });
      return { deploy, created: true };
    });
  }

  public async findLastProjectDeployLog(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(
        this.transformToDBData({ projectId, status: DeployStatusEnum.SUCCESS }),
      )
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }

  public async findInProgressProjectDeployLog(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(
        this.transformToDBData({
          projectId,
          status: DeployStatusEnum.IN_PROGRESS,
        }),
      )
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }

  public override transformFromDBData: (data: any) => Deploy = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['manifest'].includes(key)) {
        // sqlite return a string for json field, but postgres return an object
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return value;
    });
    return formattedData as Deploy;
  };
}

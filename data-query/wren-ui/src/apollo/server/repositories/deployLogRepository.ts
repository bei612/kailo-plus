import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { Manifest, ViewMDL } from '../mdl/type';

export type NativeDeploymentObject = {
  nativeType: 'model' | 'view';
  nativeId: number;
  nativeName: string;
};

// The original manifest preserves model names, not IDs. Only the builder's
// captured rows establish the historical native objects; same-name current
// models cannot supply missing deployment evidence.
export function deploymentObjects(
  manifest: Manifest,
  references: unknown,
): NativeDeploymentObject[] {
  if (!isPlainObject(manifest) || !Array.isArray(references))
    throw new Error('Native deployment object evidence unavailable');
  const objects: NativeDeploymentObject[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const ref of references) {
    if (
      !ref ||
      Object.keys(ref).sort().join(',') !== 'nativeId,nativeName,nativeType' ||
      !['model', 'view'].includes(ref.nativeType) ||
      !Number.isSafeInteger(ref.nativeId) ||
      ref.nativeId <= 0 ||
      typeof ref.nativeName !== 'string' ||
      !ref.nativeName ||
      names.has(`${ref.nativeType}:${ref.nativeName}`) ||
      ids.has(`${ref.nativeType}:${ref.nativeId}`)
    )
      throw new Error('Native deployment object evidence unavailable');
    names.add(`${ref.nativeType}:${ref.nativeName}`);
    ids.add(`${ref.nativeType}:${ref.nativeId}`);
    objects.push({ ...ref });
  }
  for (const [nativeType, rows] of [
    ['model', manifest.models ?? []],
    ['view', manifest.views ?? []],
  ] as const) {
    if (!Array.isArray(rows))
      throw new Error('Native deployment object evidence unavailable');
    const captured = objects.filter((ref) => ref.nativeType === nativeType);
    if (
      captured.length !== rows.length ||
      new Set(rows.map((row) => row.name)).size !== rows.length ||
      rows.some((row) => {
        const ref = captured.find((item) => item.nativeName === row.name);
        return (
          !ref ||
          (nativeType === 'view' &&
            (row as ViewMDL).properties?.viewId !== String(ref.nativeId))
        );
      })
    )
      throw new Error('Native deployment object evidence unavailable');
  }
  return objects;
}

export interface Deploy {
  id: number; // ID
  projectId: number; // Reference to project.id
  manifest: Manifest; // Model manifest
  hash: string;
  status: string; // Deploy status
  error: string; // Error message
  nativeObjectRefs: NativeDeploymentObject[] | null;
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
      if (['manifest', 'nativeObjectRefs'].includes(key)) {
        // sqlite return a string for json field, but postgres return an object
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return value;
    });
    return formattedData as Deploy;
  };

  protected override transformToDBData = (data: Partial<Deploy>) => {
    if (!isPlainObject(data)) throw new Error('Unexpected dbdata');
    return mapKeys(
      {
        ...data,
        ...(data.nativeObjectRefs === undefined
          ? {}
          : { nativeObjectRefs: JSON.stringify(data.nativeObjectRefs) }),
      },
      (_value, key) => snakeCase(key),
    );
  };
}

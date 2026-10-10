import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  isEqual,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { AskFeedbackResult, AskResult } from '../models/adaptor';

export interface NativeAskingScope {
  bindingId: string;
  identityScope: string;
  metadataReference: { hash: string; digest: string };
}

export type AskingTaskDetail = (
  | AskResult
  | (AskFeedbackResult & {
      adjustment?: boolean;
    })
) & { nativeScope?: NativeAskingScope; nativeQueries?: string[] };

export interface AskingTask {
  id: number;
  projectId: number;
  queryId: string;
  question?: string;
  detail?: AskingTaskDetail;
  threadId?: number;
  threadResponseId?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAskingTaskRepository extends IBasicRepository<AskingTask> {
  findUnsettled(projectId: number): Promise<AskingTask | null>;
  findByQueryId(queryId: string): Promise<AskingTask | null>;
  bindResponse(
    id: number,
    queryId: string,
    projectId: number,
    threadId: number,
    threadResponseId: number,
    tx?: Knex.Transaction,
  ): Promise<AskingTask | null>;
  updateQuery(
    id: number,
    queryId: string,
    projectId: number,
    data: Partial<AskingTask>,
    tx?: Knex.Transaction,
  ): Promise<AskingTask | null>;
  lockQuery(
    id: number,
    queryId: string,
    projectId: number,
    tx: Knex.Transaction,
  ): Promise<AskingTask | null>;
  registerNativeQuery(
    queryId: string,
    projectId: number,
    scope: NativeAskingScope,
    key: string,
  ): Promise<AskingTask | null>;
}

export class AskingTaskRepository
  extends BaseRepository<AskingTask>
  implements IAskingTaskRepository
{
  private readonly jsonbColumns = ['detail'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'asking_task' });
  }

  public async findByQueryId(queryId: string): Promise<AskingTask | null> {
    return this.findOneBy({ queryId });
  }

  public async findUnsettled(projectId: number): Promise<AskingTask | null> {
    const status =
      this.knex.client.config.client === 'pg'
        ? "COALESCE(detail->>'status', '')"
        : "COALESCE(CASE WHEN json_valid(detail) THEN json_extract(detail, '$.status') END, '')";
    const row = await this.knex(this.tableName)
      .where({ project_id: projectId })
      .whereRaw(`${status} NOT IN (?, ?, ?)`, ['FINISHED', 'FAILED', 'STOPPED'])
      .orderBy('id')
      .first();
    return row ? this.transformFromDBData(row) : null;
  }

  public async bindResponse(
    id: number,
    queryId: string,
    projectId: number,
    threadId: number,
    threadResponseId: number,
    tx?: Knex.Transaction,
  ) {
    const [row] = await (tx ?? this.knex)(this.tableName)
      .where({ id, query_id: queryId, project_id: projectId })
      .andWhere((builder) =>
        builder.where({ thread_id: null, thread_response_id: null }).orWhere({
          thread_id: threadId,
          thread_response_id: threadResponseId,
        }),
      )
      .update({ thread_id: threadId, thread_response_id: threadResponseId })
      .returning('*');
    return row ? this.transformFromDBData(row) : null;
  }

  public async updateQuery(
    id: number,
    queryId: string,
    projectId: number,
    data: Partial<AskingTask>,
    tx?: Knex.Transaction,
  ) {
    const update = async (transaction: Knex.Transaction) => {
      const current = await this.lockQuery(id, queryId, projectId, transaction);
      if (!current) return null;
      const next =
        data.detail && (!data.queryId || data.queryId === queryId)
          ? {
              ...data,
              detail: {
                ...data.detail,
                ...(current.detail?.nativeQueries
                  ? { nativeQueries: current.detail.nativeQueries }
                  : {}),
              },
            }
          : data;
      const [row] = await transaction(this.tableName)
        .where({ id, query_id: queryId, project_id: projectId })
        .update(this.transformToDBData(next))
        .returning('*');
      return row ? this.transformFromDBData(row) : null;
    };
    return tx ? update(tx) : this.knex.transaction(update);
  }

  // Serialize callback registration with the original task's cancel/rerun and
  // poll writers. An old AI job cannot add queries to a replacement task.
  public async registerNativeQuery(
    queryId: string,
    projectId: number,
    scope: NativeAskingScope,
    key: string,
  ) {
    return this.knex.transaction(async (tx) => {
      const row = await tx(this.tableName)
        .where({ query_id: queryId, project_id: projectId })
        .forUpdate()
        .first();
      if (!row) return null;
      const current = this.transformFromDBData(row) as AskingTask;
      if (!isEqual(current.detail?.nativeScope, scope)) return null;
      const keys = current.detail.nativeQueries ?? [];
      if (keys.includes(key)) return current;
      if (
        ![
          'UNDERSTANDING',
          'SEARCHING',
          'PLANNING',
          'GENERATING',
          'CORRECTING',
        ].includes(current.detail.status)
      )
        return null;
      const detail = { ...current.detail, nativeQueries: [...keys, key] };
      const [updated] = await tx(this.tableName)
        .where({ id: current.id, query_id: queryId, project_id: projectId })
        .update(this.transformToDBData({ detail }))
        .returning('*');
      return updated ? (this.transformFromDBData(updated) as AskingTask) : null;
    });
  }

  public async lockQuery(
    id: number,
    queryId: string,
    projectId: number,
    tx: Knex.Transaction,
  ) {
    const row = await tx(this.tableName)
      .where({ id, query_id: queryId, project_id: projectId })
      .forUpdate()
      .first();
    return row ? this.transformFromDBData(row) : null;
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        }
        return value;
      }
      return value;
    });
    return transformData as AskingTask;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}

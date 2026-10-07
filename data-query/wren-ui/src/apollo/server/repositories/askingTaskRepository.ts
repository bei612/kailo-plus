import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { AskFeedbackResult, AskResult } from '../models/adaptor';

export type AskingTaskDetail =
  | AskResult
  | (AskFeedbackResult & {
      adjustment?: boolean;
    });

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
        builder
          .where({ thread_id: null, thread_response_id: null })
          .orWhere({
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
    const [row] = await (tx ?? this.knex)(this.tableName)
      .where({ id, query_id: queryId, project_id: projectId })
      .update(this.transformToDBData(data))
      .returning('*');
    return row ? this.transformFromDBData(row) : null;
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

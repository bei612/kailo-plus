import {
  camelCase,
  isPlainObject,
  isEqual,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { Knex } from 'knex';
import type { NativeDeploymentObject } from './deployLogRepository';

// SS-WRN-IDENTITY: request credentials must never become API history.
// Keep protocol metadata only; a denylist would miss provider-specific keys.
const historyHeaders = (headers: unknown): Record<string, string> => {
  if (!isPlainObject(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        ['content-type', 'accept'].includes(name.toLowerCase()) &&
        typeof value === 'string',
    ),
  );
};

export enum ApiType {
  GENERATE_SQL = 'GENERATE_SQL',
  RUN_SQL = 'RUN_SQL',
  GENERATE_VEGA_CHART = 'GENERATE_VEGA_CHART',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  ASK = 'ASK',
  GET_INSTRUCTIONS = 'GET_INSTRUCTIONS',
  CREATE_INSTRUCTION = 'CREATE_INSTRUCTION',
  UPDATE_INSTRUCTION = 'UPDATE_INSTRUCTION',
  DELETE_INSTRUCTION = 'DELETE_INSTRUCTION',
  GET_SQL_PAIRS = 'GET_SQL_PAIRS',
  CREATE_SQL_PAIR = 'CREATE_SQL_PAIR',
  UPDATE_SQL_PAIR = 'UPDATE_SQL_PAIR',
  DELETE_SQL_PAIR = 'DELETE_SQL_PAIR',
  GET_MODELS = 'GET_MODELS',
  STREAM_ASK = 'STREAM_ASK',
  STREAM_GENERATE_SQL = 'STREAM_GENERATE_SQL',
}

export interface ApiHistory {
  id?: string;
  projectId: number;
  apiType: ApiType;
  threadId?: string;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
  statusCode?: number;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
  governanceBindingId?: string;
  governanceKey?: string;
  governanceActionExecutionId?: string;
  governanceOperationId?: string;
  governanceParameterHash?: string;
  governanceState?: 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';
  governanceDeploymentId?: number;
  governanceDeploymentHash?: string;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface IApiHistoryRepository extends IBasicRepository<ApiHistory> {
  count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number>;
  findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]>;
}

export class ApiHistoryRepository
  extends BaseRepository<ApiHistory>
  implements IApiHistoryRepository
{
  private readonly jsonbColumns = [
    'headers',
    'requestPayload',
    'responsePayload',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'api_history' });
  }

  // Commit the original query record before calling the native engine. A
  // duplicate key never starts another query, including after process death.
  public async reserveGovernedQuery(record: ApiHistory): Promise<boolean> {
    return this.knex.transaction(async (tx) => {
      const rows = await tx(this.tableName)
        .insert(this.transformToDBData(record))
        .onConflict(['governance_binding_id', 'governance_key'])
        .ignore()
        .returning('id');
      if (rows.length === 1) return true;
      const row = await tx(this.tableName)
        .where({
          id: record.id,
          governance_binding_id: record.governanceBindingId,
          governance_key: record.governanceKey,
        })
        .first()
        .forUpdate();
      if (!row) return false;
      const prepared = this.transformFromDBData(row);
      // The original SQL editor freezes this same native history row before
      // admission. Only the first authenticated dispatch may attach its AE;
      // it cannot replace the native SQL, deployment, sources or current user.
      if (
        prepared.governanceState != null ||
        prepared.governanceActionExecutionId != null ||
        prepared.governanceOperationId != null ||
        prepared.governanceParameterHash != null ||
        typeof prepared.requestPayload?.previewScope !== 'string' ||
        prepared.projectId !== record.projectId ||
        prepared.apiType !== record.apiType ||
        prepared.governanceDeploymentId !== record.governanceDeploymentId ||
        prepared.governanceDeploymentHash !== record.governanceDeploymentHash ||
        !isEqual(
          Object.fromEntries(
            Object.entries(prepared.requestPayload).filter(
              ([key]) => !['previewScope', 'nativeSources'].includes(key),
            ),
          ),
          record.requestPayload,
        )
      )
        return false;
      return (
        (await tx(this.tableName)
          .where({ id: record.id })
          .update(
            this.transformToDBData({
              governanceActionExecutionId: record.governanceActionExecutionId,
              governanceOperationId: record.governanceOperationId,
              governanceParameterHash: record.governanceParameterHash,
              governanceState: 'UNKNOWN',
              statusCode: 202,
              durationMs: 0,
            }),
          )) === 1
      );
    });
  }

  public async prepareNativeSql(
    record: ApiHistory,
  ): Promise<ApiHistory | null> {
    return this.knex.transaction(async (tx) => {
      await tx(this.tableName)
        .insert(this.transformToDBData(record))
        .onConflict(['governance_binding_id', 'governance_key'])
        .ignore();
      const row = await tx(this.tableName)
        .where({
          governance_binding_id: record.governanceBindingId,
          governance_key: record.governanceKey,
        })
        .first()
        .forUpdate();
      if (!row) return null;
      const current = this.transformFromDBData(row);
      return current.projectId === record.projectId &&
        current.apiType === record.apiType &&
        current.governanceDeploymentId === record.governanceDeploymentId &&
        current.governanceDeploymentHash === record.governanceDeploymentHash &&
        isEqual(current.requestPayload, record.requestPayload)
        ? current
        : null;
    });
  }

  // The original summary history is its native task owner. Persist before
  // POST, so an absent/lost AI acknowledgement cannot admit another task.
  public async prepareNativeSummary(
    record: ApiHistory,
  ): Promise<{ record: ApiHistory; created: boolean } | null> {
    return this.knex.transaction(async (tx) => {
      const inserted = await tx(this.tableName)
        .insert(this.transformToDBData(record))
        .onConflict('id')
        .ignore()
        .returning('id');
      const row = await tx(this.tableName)
        .where({ id: record.id })
        .first()
        .forUpdate();
      if (!row) return null;
      const current = this.transformFromDBData(row);
      return record.apiType === ApiType.GENERATE_SUMMARY &&
        current.apiType === ApiType.GENERATE_SUMMARY &&
        current.projectId === record.projectId &&
        current.governanceBindingId === record.governanceBindingId &&
        current.threadId === record.threadId &&
        isEqual(current.requestPayload, record.requestPayload)
        ? { record: current, created: inserted.length === 1 }
        : null;
    });
  }

  public async advanceNativeSummary(
    expected: ApiHistory,
    responsePayload: Record<string, unknown>,
    statusCode: number,
    durationMs: number,
  ): Promise<ApiHistory | null> {
    return this.knex.transaction(async (tx) => {
      const row = await tx(this.tableName)
        .where({ id: expected.id })
        .first()
        .forUpdate();
      if (!row) return null;
      const current = this.transformFromDBData(row);
      if (
        current.apiType !== ApiType.GENERATE_SUMMARY ||
        expected.apiType !== ApiType.GENERATE_SUMMARY ||
        current.projectId !== expected.projectId ||
        current.governanceBindingId !== expected.governanceBindingId ||
        current.threadId !== expected.threadId ||
        current.statusCode !== 202 ||
        expected.statusCode !== 202 ||
        !isEqual(current.requestPayload, expected.requestPayload) ||
        !isEqual(current.responsePayload, expected.responsePayload)
      )
        return null;
      const [changed] = await tx(this.tableName)
        .where({ id: expected.id })
        .update(
          this.transformToDBData({
            responsePayload,
            statusCode,
            durationMs,
            updatedAt: new Date().toISOString(),
          }),
        )
        .returning('*');
      return changed ? this.transformFromDBData(changed) : null;
    });
  }

  public async completeGovernedQuery(
    id: string,
    parameterHash: string,
    result: Record<string, unknown>,
    durationMs: number,
  ): Promise<boolean> {
    const changed = await this.knex(this.tableName)
      .where({
        id,
        governance_parameter_hash: parameterHash,
        governance_state: 'UNKNOWN',
      })
      .update(
        this.transformToDBData({
          governanceState: 'SUCCEEDED',
          responsePayload: result,
          statusCode: 200,
          durationMs,
          updatedAt: new Date().toISOString(),
        }),
      );
    return changed === 1;
  }

  public async freezeGovernedQuerySources(
    id: string,
    parameterHash: string,
    sources: NativeDeploymentObject[],
  ): Promise<boolean> {
    return this.knex.transaction(async (tx) => {
      const row = await tx(this.tableName)
        .where({
          id,
          governance_parameter_hash: parameterHash,
          governance_state: 'UNKNOWN',
        })
        .first()
        .forUpdate();
      if (!row) return false;
      const payload = this.transformFromDBData(row).requestPayload;
      if (!isPlainObject(payload)) return false;
      // Freeze original native IDs before SQL. Re-entry may compare this
      // evidence, never replace it with a newly selected set after execution.
      if (Object.hasOwn(payload, 'nativeSources'))
        return isEqual(payload.nativeSources, sources);
      const changed = await tx(this.tableName)
        .where({
          id,
          governance_parameter_hash: parameterHash,
          governance_state: 'UNKNOWN',
        })
        .update(
          this.transformToDBData({
            requestPayload: { ...payload, nativeSources: sources },
          }),
        );
      return changed === 1;
    });
  }

  public async rejectUnsentGovernedQuery(
    id: string,
    parameterHash: string,
  ): Promise<boolean> {
    const changed = await this.knex(this.tableName)
      .where({
        id,
        governance_parameter_hash: parameterHash,
        governance_state: 'UNKNOWN',
      })
      .update(
        this.transformToDBData({
          governanceState: 'FAILED',
          responsePayload: { error: 'NOT_DISPATCHED' },
          statusCode: 403,
          updatedAt: new Date().toISOString(),
        }),
      );
    return changed === 1;
  }

  /**
   * Count API history records with filtering
   */
  public async count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number> {
    let query = this.knex(this.tableName).count('id as count');

    if (filter) {
      query = query.where(this.transformToDBData(filter));
    }

    if (dateFilter) {
      if (dateFilter.startDate) {
        query = query.where('created_at', '>=', dateFilter.startDate);
      }

      if (dateFilter.endDate) {
        query = query.where('created_at', '<=', dateFilter.endDate);
      }
    }

    const result = await query;
    return parseInt(result[0].count as string, 10);
  }

  /**
   * Find API history records with pagination
   */
  public async findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]> {
    let query = this.knex(this.tableName).select('*');

    if (filter) {
      query = query.where(this.transformToDBData(filter));
    }

    if (dateFilter) {
      if (dateFilter.startDate) {
        query = query.where('created_at', '>=', dateFilter.startDate);
      }

      if (dateFilter.endDate) {
        query = query.where('created_at', '<=', dateFilter.endDate);
      }
    }

    if (pagination) {
      if (pagination.orderBy) {
        Object.entries(pagination.orderBy).forEach(([field, direction]) => {
          query = query.orderBy(this.camelToSnakeCase(field), direction);
        });
      } else {
        // Default sort by created_at desc
        query = query.orderBy('created_at', 'desc');
      }

      query = query.offset(pagination.offset).limit(pagination.limit);
    }

    const result = await query;
    return result.map(this.transformFromDBData);
  }

  protected override transformFromDBData = (data: any): ApiHistory => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (key === 'headers') {
        if (typeof value !== 'string') return historyHeaders(value);
        try {
          return historyHeaders(JSON.parse(value));
        } catch {
          return {};
        }
      }
      if (this.jsonbColumns.includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          if (!value) return value;
          try {
            return JSON.parse(value);
          } catch (error) {
            console.error(`Failed to parse JSON for ${key}:`, error);
            return value; // Return raw value if parsing fails
          }
        } else {
          return value;
        }
      }
      return value;
    }) as ApiHistory;
    return formattedData;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (key === 'headers') return JSON.stringify(historyHeaders(value));
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  /**
   * Convert camelCase to snake_case for DB column names
   */
  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}

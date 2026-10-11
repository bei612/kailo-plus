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
import { AskingTaskRepository } from './askingTaskRepository';
import { AskResultStatus } from '../models/adaptor';
import { lockNativeBinding } from './projectRepository';

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
  governanceGeneration?: number;
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

  public async reconcileNativeBinding(
    projectId: number,
    bindingId: string,
    generation: number,
    maximumBytes: number,
  ) {
    return this.knex.transaction(async (tx) => {
      await lockNativeBinding(tx, projectId, { bindingId, generation }, true);
      const observations: Record<string, unknown>[] = [];
      let complete = true;
      let size = 0;
      const observedAt = new Date().toISOString();
      const append = (observation: Record<string, unknown>) => {
        size += Buffer.byteLength(JSON.stringify(observation));
        if (size > maximumBytes)
          throw new Error('NATIVE_BINDING_RECONCILE_TOO_LARGE');
        observations.push(observation);
      };
      // Original records are consumed with keyset pagination, not a capped
      // first page presented as a complete task enumeration. New governed
      // writers cannot pass the project-row fence while this transaction runs.
      let historyId: string | undefined;
      for (;;) {
        const query = tx(this.tableName)
          .where({ project_id: projectId })
          .whereRaw('lower(??) = ?', [
            'governance_binding_id',
            bindingId.toLowerCase(),
          ])
          .orderBy('id')
          .first();
        if (historyId !== undefined) query.andWhere('id', '>', historyId);
        const row = await query;
        if (!row) break;
        const record = this.transformFromDBData(row);
        historyId = record.id;
        if (
          Number.isSafeInteger(record.governanceGeneration) &&
          record.governanceGeneration > generation
        )
          continue;
        const attributable =
          Number.isSafeInteger(record.governanceGeneration) &&
          record.governanceGeneration > 0 &&
          record.governanceGeneration <= generation;
        if (!attributable) complete = false;
        let status = 'UNKNOWN';
        let nativeStatus: string | undefined;
        if (attributable && record.governanceState === 'SUCCEEDED') {
          status = 'SUCCEEDED';
          nativeStatus = 'SUCCEEDED';
        } else if (attributable && record.governanceState === 'FAILED') {
          status = 'FAILED';
          nativeStatus = 'FAILED';
        } else if (attributable && record.statusCode === 200) {
          const proof = record.requestPayload?.nativeAsk
            ? 'nativeAsk'
            : record.requestPayload?.nativeSummary
              ? 'nativeSummary'
              : record.requestPayload?.nativeChart
                ? 'nativeChart'
                : undefined;
          if (
            proof &&
            record.responsePayload?.[proof]?.doneQueryId === record.id
          ) {
            status = 'SUCCEEDED';
            nativeStatus = 'FINISHED';
          }
        }
        const terminalAt = record.updatedAt && new Date(record.updatedAt);
        if (
          status !== 'UNKNOWN' &&
          (!terminalAt || !Number.isFinite(terminalAt.getTime()))
        ) {
          status = 'UNKNOWN';
          nativeStatus = undefined;
        }
        append({
          idempotencyKey: record.governanceKey ?? record.id,
          nativeType: 'wren.api_history',
          nativeId: record.id,
          platformStatus: status,
          cancelCapability: 'UNSUPPORTED',
          lastObservedAt: observedAt,
          ...(status === 'UNKNOWN'
            ? {}
            : { nativeStatus, terminalAt: terminalAt.toISOString() }),
        });
      }
      const tasks = new AskingTaskRepository(this.knex);
      let taskId: number | undefined;
      for (;;) {
        const query = tx('asking_task')
          .where({ project_id: projectId })
          .orderBy('id')
          .first();
        if (taskId !== undefined) query.andWhere('id', '>', taskId);
        const row = await query;
        if (!row) break;
        taskId = row.id;
        const task = await tasks.findOneBy({ id: taskId, projectId }, { tx });
        const scope = task.detail?.nativeScope;
        if (
          !scope ||
          typeof scope.bindingId !== 'string' ||
          scope.bindingId.toLowerCase() !== bindingId.toLowerCase()
        )
          continue;
        if (
          Number.isSafeInteger(scope.generation) &&
          scope.generation > generation
        )
          continue;
        const attributable =
          Number.isSafeInteger(scope.generation) &&
          scope.generation > 0 &&
          scope.generation <= generation;
        if (!attributable) complete = false;
        const terminalAt = task.updatedAt && new Date(task.updatedAt);
        const terminal =
          attributable &&
          task.detail.status === 'FINISHED' &&
          terminalAt &&
          Number.isFinite(terminalAt.getTime());
        append({
          idempotencyKey: task.queryId,
          nativeType: 'wren.asking_task',
          nativeId: String(task.id),
          platformStatus: terminal ? 'SUCCEEDED' : 'UNKNOWN',
          cancelCapability: 'UNSUPPORTED',
          lastObservedAt: observedAt,
          ...(terminal
            ? { nativeStatus: 'FINISHED', terminalAt: terminalAt.toISOString() }
            : {}),
        });
      }
      return { complete, observations };
    });
  }

  // Commit the original query record before calling the native engine. A
  // duplicate key never starts another query, including after process death.
  public async reserveGovernedQuery(record: ApiHistory): Promise<boolean> {
    return this.knex.transaction(async (tx) => {
      await lockNativeBinding(tx, record.projectId, {
        bindingId: record.governanceBindingId,
        generation: record.governanceGeneration,
      });
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
        prepared.governanceGeneration !== record.governanceGeneration ||
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
      await lockNativeBinding(tx, record.projectId, {
        bindingId: record.governanceBindingId,
        generation: record.governanceGeneration,
      });
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
        current.governanceGeneration === record.governanceGeneration &&
        current.apiType === record.apiType &&
        current.governanceDeploymentId === record.governanceDeploymentId &&
        current.governanceDeploymentHash === record.governanceDeploymentHash &&
        isEqual(current.requestPayload, record.requestPayload)
        ? current
        : null;
    });
  }

  // The original answer/chart history is its native task owner. Persist before
  // POST, so an absent/lost AI acknowledgement cannot admit another task.
  public async prepareNativeGeneration(
    record: ApiHistory,
  ): Promise<{ record: ApiHistory; created: boolean } | null> {
    return this.knex.transaction(async (tx) => {
      await lockNativeBinding(tx, record.projectId, {
        bindingId: record.governanceBindingId,
        generation: record.governanceGeneration,
      });
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
      const matches =
        [
          ApiType.GENERATE_SUMMARY,
          ApiType.GENERATE_VEGA_CHART,
          ApiType.ASK,
          ApiType.STREAM_ASK,
          ApiType.GENERATE_SQL,
          ApiType.STREAM_GENERATE_SQL,
        ].includes(record.apiType) &&
        current.apiType === record.apiType &&
        current.projectId === record.projectId &&
        current.governanceBindingId === record.governanceBindingId &&
        current.governanceGeneration === record.governanceGeneration &&
        current.threadId === record.threadId &&
        isEqual(current.requestPayload, record.requestPayload);
      if (!matches) return null;
      if (current.requestPayload?.nativeAsk) {
        const proof = current.requestPayload.nativeAsk;
        if (
          proof.taskId !== current.id ||
          typeof proof.identityScope !== 'string' ||
          !proof.identityScope ||
          typeof proof.metadataReference?.hash !== 'string' ||
          typeof proof.metadataReference.digest !== 'string'
        )
          throw new Error('QUERY_INTENT_CONFLICT');
        const nativeScope = {
          bindingId: current.governanceBindingId,
          generation: current.governanceGeneration,
          identityScope: proof.identityScope,
          metadataReference: {
            hash: proof.metadataReference.hash,
            digest: proof.metadataReference.digest,
          },
        };
        const tasks = new AskingTaskRepository(this.knex);
        // The original unique query_id and API id are committed together.
        // A task collision rolls back the history INSERT; a replay may never
        // adopt another task or repair missing provenance with a new identity.
        const task =
          inserted.length === 1
            ? await tasks.createOne(
                {
                  projectId: current.projectId,
                  queryId: current.id,
                  question: current.requestPayload.question,
                  detail: {
                    status: AskResultStatus.UNDERSTANDING,
                    type: null,
                    response: null,
                    error: null,
                    nativeScope,
                  },
                },
                { tx },
              )
            : await tasks.findOneBy({ queryId: current.id }, { tx });
        if (
          !task ||
          task.projectId !== current.projectId ||
          task.question !== current.requestPayload.question ||
          !isEqual(task.detail?.nativeScope, nativeScope)
        )
          throw new Error('QUERY_INTENT_CONFLICT');
      }
      return { record: current, created: inserted.length === 1 };
    });
  }

  public async advanceNativeGeneration(
    expected: ApiHistory,
    responsePayload: Record<string, unknown>,
    statusCode: number,
    durationMs: number,
    settledNativeQueries?: string[],
  ): Promise<ApiHistory | null> {
    return this.knex.transaction(async (tx) => {
      const row = await tx(this.tableName)
        .where({ id: expected.id })
        .first()
        .forUpdate();
      if (!row) return null;
      const current = this.transformFromDBData(row);
      if (
        ![
          ApiType.GENERATE_SUMMARY,
          ApiType.GENERATE_VEGA_CHART,
          ApiType.ASK,
          ApiType.STREAM_ASK,
          ApiType.GENERATE_SQL,
          ApiType.STREAM_GENERATE_SQL,
        ].includes(expected.apiType) ||
        current.apiType !== expected.apiType ||
        current.projectId !== expected.projectId ||
        current.governanceBindingId !== expected.governanceBindingId ||
        current.threadId !== expected.threadId ||
        current.statusCode !== 202 ||
        expected.statusCode !== 202 ||
        !isEqual(current.requestPayload, expected.requestPayload) ||
        !isEqual(current.responsePayload, expected.responsePayload)
      )
        return null;
      const nativeAsk = responsePayload.nativeAsk as
        | Record<string, any>
        | undefined;
      if (current.requestPayload?.nativeAsk && nativeAsk?.askResult) {
        const tasks = new AskingTaskRepository(this.knex);
        const found = await tasks.findOneBy({ queryId: current.id }, { tx });
        const task =
          found &&
          (await tasks.lockQuery(found.id, current.id, current.projectId, tx));
        const proof = current.requestPayload.nativeAsk;
        const scope = {
          bindingId: current.governanceBindingId,
          generation: current.governanceGeneration,
          identityScope: proof.identityScope,
          metadataReference: {
            hash: proof.metadataReference.hash,
            digest: proof.metadataReference.digest,
          },
        };
        if (
          !task ||
          task.projectId !== current.projectId ||
          task.question !== current.requestPayload.question ||
          !isEqual(task.detail?.nativeScope, scope)
        )
          throw new Error('QUERY_INTENT_CONFLICT');
        // Serialize final history publication and task closure with the
        // original callback registration lock. A fresh external receipt read
        // alone cannot prove that no child appeared during that await.
        if (
          statusCode !== 202 &&
          !isEqual(task.detail?.nativeQueries ?? [], settledNativeQueries)
        )
          return null;
        const updated = await tasks.updateQuery(
          task.id,
          task.queryId,
          task.projectId,
          {
            detail: {
              ...nativeAsk.askResult,
              ...(statusCode === 200 && nativeAsk.doneQueryId === current.id
                ? { status: AskResultStatus.FINISHED }
                : {}),
              nativeScope: scope,
            },
          },
          tx,
        );
        if (!updated) throw new Error('QUERY_INTENT_CONFLICT');
      }
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

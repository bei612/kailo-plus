import { SqlPair } from '@server/repositories';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import { ISqlPairRepository } from '@server/repositories/sqlPairRepository';
import { getLogger } from '@server/utils';
import { chunk } from 'lodash';
import * as Errors from '@server/utils/error';
import { Project } from '../repositories';
import { IIbisAdaptor } from '../adaptors/ibisAdaptor';
import {
  DialectSQL,
  WrenSQL,
  WrenAILanguage,
  SqlPairResult,
  SqlPairStatus,
  QuestionsResult,
  QuestionsStatus,
} from '../models/adaptor';
import { Manifest } from '@server/mdl/type';
import { DataSourceName } from '@server/types';
import {
  ApiHistory,
  ApiType,
  IApiHistoryRepository,
} from '../repositories/apiHistoryRepository';
import {
  digest,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';
import { authorizeNativeScope, nativePreviewScope } from './nativeHumanQuery';

export type NativeSqlPairContext = {
  config: NativeQueryDelivery;
  identityScope: string;
  token: string;
};

const logger = getLogger('SqlPairService');

export interface CreateSqlPair {
  sql: string;
  question: string;
}

export interface EditSqlPair {
  sql?: string;
  question?: string;
}

export interface ModelSubstituteOptions {
  project: Project;
  // if not given, will use the deployed manifest
  manifest: Manifest;
}

export interface ISqlPairService {
  readNativeWrite(
    record: ApiHistory,
    native: NativeSqlPairContext,
  ): Promise<{
    requestPayload: Record<string, unknown>;
    responsePayload: unknown;
  }>;
  getProjectSqlPairs(
    projectId: number,
    native?: NativeSqlPairContext,
  ): Promise<SqlPair[]>;
  createSqlPair(
    projectId: number,
    sqlPair: CreateSqlPair,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<SqlPair>;
  createSqlPairs(
    projectId: number,
    sqlPairs: CreateSqlPair[],
  ): Promise<SqlPair[]>;
  editSqlPair(
    projectId: number,
    sqlPairId: number,
    sqlPair: EditSqlPair,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<SqlPair>;
  deleteSqlPair(
    projectId: number,
    sqlPairId: number,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<boolean>;
  generateQuestions(project: Project, sqls: string[]): Promise<string[]>;
  modelSubstitute(
    sql: DialectSQL,
    options: ModelSubstituteOptions,
  ): Promise<WrenSQL>;
}

export class SqlPairService implements ISqlPairService {
  private sqlPairRepository: ISqlPairRepository;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private ibisAdaptor: IIbisAdaptor;
  private history?: IApiHistoryRepository;

  constructor({
    sqlPairRepository,
    wrenAIAdaptor,
    ibisAdaptor,
    apiHistoryRepository,
  }: {
    sqlPairRepository: ISqlPairRepository;
    wrenAIAdaptor: IWrenAIAdaptor;
    ibisAdaptor: IIbisAdaptor;
    apiHistoryRepository?: IApiHistoryRepository;
  }) {
    this.sqlPairRepository = sqlPairRepository;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.ibisAdaptor = ibisAdaptor;
    this.history = apiHistoryRepository;
  }

  private async nativeIdentity(
    native: NativeSqlPairContext,
    permission: string,
  ) {
    const { config, identityScope, token } = native;
    if (digest(await loadQueryDelivery()) !== digest(config))
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const scope = nativePreviewScope(config, identityScope);
    const permissionFact = await authorizeNativeScope(
      config,
      token,
      permission,
    );
    return { scope, generation: permissionFact.generation };
  }

  public async readNativeWrite(
    record: ApiHistory,
    native: NativeSqlPairContext,
  ) {
    const result = await this.observeNativeWrite(record, native);
    const proof = record.requestPayload.nativeSqlPair;
    const current = await this.history.findOneBy({
      id: record.id,
      projectId: native.config.projectId,
      governanceBindingId: native.config.bindingId,
    });
    if (
      !current ||
      digest(current.requestPayload) !== digest(record.requestPayload) ||
      current.statusCode !== 200 ||
      digest(current.responsePayload.result) !== digest(result)
    )
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const fresh = await this.nativeIdentity(native, 'manage');
    if (fresh.generation !== proof.generation)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    return {
      requestPayload: {
        ...proof.changes,
        ...(proof.nativeId === undefined ? {} : { id: proof.nativeId }),
      },
      responsePayload: result,
    };
  }

  private async observeNativeWrite(
    record: ApiHistory,
    native: NativeSqlPairContext,
  ) {
    const proof = record.requestPayload?.nativeSqlPair;
    const current = await this.nativeIdentity(native, 'manage');
    if (
      !this.history ||
      record.projectId !== native.config.projectId ||
      record.governanceBindingId !== native.config.bindingId ||
      proof?.identityScope !== native.identityScope ||
      proof?.scope !== current.scope ||
      proof?.generation !== current.generation ||
      proof?.configDigest !== digest(native.config) ||
      record.apiType !==
        {
          create: ApiType.CREATE_SQL_PAIR,
          update: ApiType.UPDATE_SQL_PAIR,
          delete: ApiType.DELETE_SQL_PAIR,
        }[proof?.operation] ||
      record.responsePayload?.eventId !== record.id ||
      record.responsePayload?.nativeId !== proof?.after?.id
    )
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    if (record.statusCode === 200) return record.responsePayload.result;
    const event = await this.wrenAIAdaptor.getSqlPairResult(record.id, {
      requestTimeoutMs: native.config.requestTimeoutMs,
      responseMaxBytes: native.config.responseMaxBytes,
      requestMaxBytes: native.config.requestMaxBytes,
    });
    const afterEvent = await this.nativeIdentity(native, 'manage');
    if (afterEvent.generation !== current.generation)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    // FAILED or a lost cache entry cannot prove absence of a partially applied
    // index write. Only the same original event's explicit finish commits the
    // local metadata; observation never starts a replacement native task.
    if (event.status !== SqlPairStatus.FINISHED || event.error)
      throw Errors.nativeWriteUnknown(
        undefined,
        current.scope,
        current.generation,
        {
          nativeType: 'sqlPair',
          nativeId: proof.after.id,
        },
      );
    const completed = await this.sqlPairRepository.completeNativeWrite(
      this.history,
      record,
    );
    if (completed?.statusCode !== 200)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const afterCommit = await this.nativeIdentity(native, 'manage');
    if (afterCommit.generation !== current.generation)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    return completed.responsePayload.result;
  }

  private async nativeWrite(
    projectId: number,
    operation: 'create' | 'update' | 'delete',
    changes: EditSqlPair,
    native: NativeSqlPairContext,
    key: string,
    nativeId?: number,
  ) {
    if (
      !this.history ||
      projectId !== native.config.projectId ||
      Buffer.byteLength(JSON.stringify(changes), 'utf8') >
        native.config.requestMaxBytes ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const identity = await this.nativeIdentity(native, 'manage');
    const apiType = {
      create: ApiType.CREATE_SQL_PAIR,
      update: ApiType.UPDATE_SQL_PAIR,
      delete: ApiType.DELETE_SQL_PAIR,
    }[operation];
    const prepared = await this.sqlPairRepository.prepareNativeWrite(
      this.history,
      {
        id: key,
        projectId,
        apiType,
        governanceBindingId: native.config.bindingId,
        statusCode: 202,
        durationMs: 0,
        requestPayload: {
          nativeSqlPair: {
            operation,
            changes: Object.fromEntries(
              Object.entries(changes).filter(
                ([, value]) => value !== undefined,
              ),
            ),
            ...(nativeId === undefined ? {} : { nativeId }),
            identityScope: native.identityScope,
            ...identity,
            configDigest: digest(native.config),
          },
        },
      },
    );
    if (!prepared) throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    const record = prepared.record;
    const pair = record.requestPayload.nativeSqlPair.after;
    try {
      if (prepared.created) {
        const beforeDispatch = await this.nativeIdentity(native, 'manage');
        if (beforeDispatch.generation !== identity.generation)
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        const transport = {
          taskId: record.id,
          requestTimeoutMs: native.config.requestTimeoutMs,
          responseMaxBytes: native.config.responseMaxBytes,
          requestMaxBytes: native.config.requestMaxBytes,
        };
        try {
          if (operation === 'delete')
            await this.wrenAIAdaptor.deleteSqlPairs(
              projectId,
              [pair.id],
              transport,
            );
          else {
            const event = await this.wrenAIAdaptor.deploySqlPair(
              projectId,
              pair,
              transport,
            );
            if (event.queryId !== record.id)
              throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
          }
        } catch {
          // The persisted event is the only possible observation target, also
          // when the create ACK was lost. Never resubmit this history row.
        }
      }
      return await this.observeNativeWrite(record, native);
    } catch (error) {
      throw Errors.nativeWriteUnknown(
        error,
        identity.scope,
        identity.generation,
        {
          nativeType: 'sqlPair',
          nativeId: pair.id,
        },
      );
    }
  }

  public async modelSubstitute(
    sql: DialectSQL,
    options: ModelSubstituteOptions,
  ): Promise<WrenSQL> {
    const { manifest: mdl, project } = options;
    const { type: dataSource, connectionInfo } = project;
    if (dataSource === DataSourceName.DUCKDB) {
      // engine does not implement model substitute.
      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage: 'DuckDB data source does not support model substitute.',
      });
    }
    // use the first model's table reference as default catalog and schema
    const firstModel = mdl.models?.[0];
    const catalog = firstModel?.tableReference?.catalog;
    const schema = firstModel?.tableReference?.schema;
    return await this.ibisAdaptor.modelSubstitute(sql, {
      dataSource,
      connectionInfo,
      mdl,
      catalog,
      schema,
    });
  }

  public async generateQuestions(
    project: Project,
    sqls: string[],
  ): Promise<string[]> {
    try {
      const configurations = {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      };

      const { queryId } = await this.wrenAIAdaptor.generateQuestions({
        projectId: project.id,
        configurations,
        sqls,
      });
      const result = await this.waitQuestionGenerateResult(queryId);
      if (result.error) {
        throw Errors.create(Errors.GeneralErrorCodes.GENERATE_QUESTIONS_ERROR, {
          customMessage: result.error.message,
        });
      }
      return result.questions;
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.GENERATE_QUESTIONS_ERROR, {
        customMessage: err.message,
      });
    }
  }

  public async getProjectSqlPairs(
    projectId: number,
    native?: NativeSqlPairContext,
  ): Promise<SqlPair[]> {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined && !native)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (!native) return this.sqlPairRepository.findAllBy({ projectId });
    if (!this.history || projectId !== native.config.projectId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    await this.nativeIdentity(native, 'discover');
    const pending = await this.history.findAllBy({
      projectId,
      governanceBindingId: native.config.bindingId,
      statusCode: 202,
    });
    for (const record of pending) {
      if (
        record.requestPayload?.nativeSqlPair?.identityScope !==
        native.identityScope
      )
        continue;
      try {
        await this.observeNativeWrite(record, native);
      } catch {
        // Keep the durable unresolved reference; a cache miss or loss of write
        // permission must not erase it or make its provisional CREATE visible.
      }
    }
    const unresolved = await this.history.findAllBy({
      projectId,
      governanceBindingId: native.config.bindingId,
      statusCode: 202,
    });
    const hidden = new Set(
      unresolved
        .filter(
          (record) =>
            record.requestPayload?.nativeSqlPair?.operation === 'create',
        )
        .map((record) => record.requestPayload.nativeSqlPair.after.id),
    );
    const pendingIds = new Set(
      unresolved
        .filter((record) => record.requestPayload?.nativeSqlPair)
        .map((record) => record.requestPayload.nativeSqlPair.after.id),
    );
    await this.nativeIdentity(native, 'discover');
    return (await this.sqlPairRepository.findAllBy({ projectId }))
      .filter((pair) => !hidden.has(pair.id))
      .map((pair) => ({
        ...pair,
        nativeWritePending: pendingIds.has(pair.id),
      }));
  }

  public async createSqlPair(
    projectId: number,
    sqlPair: CreateSqlPair,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<SqlPair> {
    if (native)
      return this.nativeWrite(projectId, 'create', sqlPair, native, key);
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const tx = await this.sqlPairRepository.transaction();
    try {
      const newPair = await this.sqlPairRepository.createOne(
        {
          ...sqlPair,
          projectId,
        },
        { tx },
      );
      const { queryId } = await this.wrenAIAdaptor.deploySqlPair(
        projectId,
        newPair,
      );
      const deployResult = await this.waitUntilSqlPairResult(queryId);
      if (deployResult.error) {
        throw Errors.create(deployResult.error.code, {
          customMessage: deployResult.error.message,
        });
      }
      await tx.commit();
      return newPair;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async createSqlPairs(
    projectId: number,
    sqlPairs: CreateSqlPair[],
  ): Promise<SqlPair[]> {
    const tx = await this.sqlPairRepository.transaction();
    const newPairs = await this.sqlPairRepository.createMany(
      sqlPairs.map((pair) => ({
        ...pair,
        projectId,
      })),
      { tx },
    );
    // batch parall process with size of 10
    const successPairs = [];
    const errorPairs = [];
    const chunks = chunk(newPairs, 10);
    for (const pairs of chunks) {
      await Promise.allSettled(
        pairs.map(async (pair) => {
          const { queryId } = await this.wrenAIAdaptor.deploySqlPair(
            projectId,
            pair,
          );
          const deployResult = await this.waitUntilSqlPairResult(queryId);
          if (deployResult.error) {
            errorPairs.push(deployResult.error);
          }
          successPairs.push(deployResult);
        }),
      ).then(async (_result) => {
        if (errorPairs.length > 0) {
          logger.debug(
            `deploy sql pair failed. ${errorPairs.map((pair) => pair.question).join(', ')}`,
          );
          await tx.rollback();
          await this.wrenAIAdaptor.deleteSqlPairs(
            projectId,
            successPairs.map((pair) => pair.id),
          );
          throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
            customMessage: errorPairs.map((pair) => pair.message).join(', '),
          });
        }
      });
    }
    await tx.commit();
    return newPairs;
  }

  async editSqlPair(
    projectId: number,
    sqlPairId: number,
    sqlPair: EditSqlPair,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<SqlPair> {
    if (native)
      return this.nativeWrite(
        projectId,
        'update',
        sqlPair,
        native,
        key,
        sqlPairId,
      );
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    // First verify the SQL pair exists and belongs to the project
    const existingPair = await this.sqlPairRepository.findOneBy({
      id: sqlPairId,
      projectId,
    });
    if (!existingPair) {
      throw new Error(
        `SQL pair with ID ${sqlPairId} not found in project ${projectId}`,
      );
    }

    // Update only the provided fields
    const updatedData: Partial<SqlPair> = {
      sql: existingPair.sql,
      question: existingPair.question,
      updatedAt: new Date().toISOString(),
    };

    if (sqlPair.sql !== undefined) {
      updatedData.sql = sqlPair.sql;
    }

    if (sqlPair.question !== undefined) {
      updatedData.question = sqlPair.question;
    }
    const tx = await this.sqlPairRepository.transaction();
    try {
      const updatedSqlPair = await this.sqlPairRepository.updateOne(
        sqlPairId,
        updatedData,
        { tx },
      );
      const { queryId } = await this.wrenAIAdaptor.deploySqlPair(
        projectId,
        updatedSqlPair,
      );
      const deployResult = await this.waitUntilSqlPairResult(queryId);
      if (deployResult.error) {
        throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
          customMessage: deployResult.error.message,
        });
      }
      await tx.commit();
      return updatedSqlPair;
    } catch (error) {
      logger.error(`edit sql pair failed. ${error}`);
      await tx.rollback();
      throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
        customMessage: error.message,
      });
    }
  }

  async deleteSqlPair(
    projectId: number,
    sqlPairId: number,
    native?: NativeSqlPairContext,
    key?: string,
  ): Promise<boolean> {
    if (native)
      return this.nativeWrite(projectId, 'delete', {}, native, key, sqlPairId);
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    // First verify the SQL pair exists and belongs to the project
    const existingPair = await this.sqlPairRepository.findOneBy({
      id: sqlPairId,
      projectId,
    });

    if (!existingPair) {
      throw new Error(
        `SQL pair with ID ${sqlPairId} not found in project ${projectId}`,
      );
    }
    const tx = await this.sqlPairRepository.transaction();
    try {
      await this.sqlPairRepository.deleteOne(sqlPairId, { tx });
      await this.wrenAIAdaptor.deleteSqlPairs(projectId, [sqlPairId]);
      await tx.commit();
      return true;
    } catch (error) {
      logger.error(`delete sql pair failed. ${error}`);
      await tx.rollback();
      throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
        customMessage: error.message,
      });
    }
  }

  private async waitUntilSqlPairResult(
    queryId: string,
  ): Promise<SqlPairResult> {
    let result = await this.wrenAIAdaptor.getSqlPairResult(queryId);
    while (!this.isFinishedState(result.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await this.wrenAIAdaptor.getSqlPairResult(queryId);
    }
    return result;
  }

  private async waitQuestionGenerateResult(
    queryId: string,
  ): Promise<Partial<QuestionsResult>> {
    let result = await this.wrenAIAdaptor.getQuestionsResult(queryId);
    while (
      ![QuestionsStatus.SUCCEEDED, QuestionsStatus.FAILED].includes(
        result.status,
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await this.wrenAIAdaptor.getQuestionsResult(queryId);
    }
    return result;
  }

  private isFinishedState(status: SqlPairStatus) {
    return [SqlPairStatus.FINISHED, SqlPairStatus.FAILED].includes(status);
  }
}

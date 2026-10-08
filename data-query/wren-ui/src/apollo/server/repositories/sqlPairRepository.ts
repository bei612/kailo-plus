import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { isEqual } from 'lodash';
import { ApiHistory, IApiHistoryRepository } from './apiHistoryRepository';

export interface SqlPair {
  id: number; // ID
  projectId: number; // Reference to project.id
  sql: string; // SQL query
  question: string; // Natural language question
  createdAt?: string; // Date and time when the SQL pair was created
  updatedAt?: string; // Date and time when the SQL pair was last updated
  nativeWritePending?: boolean;
}

export interface ISqlPairRepository extends IBasicRepository<SqlPair> {
  prepareNativeWrite(
    history: IApiHistoryRepository,
    record: ApiHistory,
  ): Promise<{ record: ApiHistory; created: boolean } | undefined>;
  completeNativeWrite(
    history: IApiHistoryRepository,
    expected: ApiHistory,
  ): Promise<ApiHistory | undefined>;
}

export class SqlPairRepository
  extends BaseRepository<SqlPair>
  implements ISqlPairRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'sql_pair' });
  }

  // The original row and API History share Wren's transaction. In particular,
  // the native ID is durable before indexing; a lost external ACK must not
  // rollback that ID and allow a different insert on retry.
  public async prepareNativeWrite(
    history: IApiHistoryRepository,
    record: ApiHistory,
  ) {
    return this.knex.transaction(async (tx) => {
      const project = await tx('project')
        .where({ id: record.projectId })
        .first()
        .forUpdate();
      if (!project) return undefined;
      const current = await history.findOneBy({ id: record.id }, { tx });
      if (current) {
        if (!current.requestPayload?.nativeSqlPair) return undefined;
        const {
          before: _before,
          after: _after,
          ...input
        } = current.requestPayload.nativeSqlPair;
        return current.projectId === record.projectId &&
          current.apiType === record.apiType &&
          current.governanceBindingId === record.governanceBindingId &&
          isEqual(input, record.requestPayload.nativeSqlPair)
          ? { record: current, created: false }
          : undefined;
      }
      const intent = record.requestPayload.nativeSqlPair;
      const pending = await history.findAllBy(
        {
          projectId: record.projectId,
          governanceBindingId: record.governanceBindingId,
          statusCode: 202,
        },
        { tx },
      );
      // A different key cannot supersede an unresolved original write, even
      // from another client. For CREATE there is not yet a caller-known ID.
      if (
        pending.some((item) => {
          const other = item.requestPayload?.nativeSqlPair;
          return (
            other &&
            (intent.nativeId
              ? other.after?.id === intent.nativeId
              : other.operation === 'create' &&
                isEqual(other.changes, intent.changes))
          );
        })
      )
        return undefined;
      const before = intent.nativeId
        ? await this.findOneBy(
            { id: intent.nativeId, projectId: record.projectId },
            { tx },
          )
        : undefined;
      if (intent.operation !== 'create' && !before) return undefined;
      const after = before
        ? { ...before, ...intent.changes }
        : await this.createOne(
            { ...intent.changes, projectId: record.projectId },
            { tx },
          );
      const saved = await history.createOne(
        {
          ...record,
          requestPayload: {
            nativeSqlPair: { ...intent, before, after },
          },
          responsePayload: { eventId: record.id, nativeId: after.id },
        },
        { tx },
      );
      return { record: saved, created: true };
    });
  }

  public async completeNativeWrite(
    history: IApiHistoryRepository,
    expected: ApiHistory,
  ) {
    return this.knex.transaction(async (tx) => {
      const project = await tx('project')
        .where({ id: expected.projectId })
        .first()
        .forUpdate();
      if (!project) return undefined;
      const current = await history.findOneBy({ id: expected.id }, { tx });
      if (
        !current ||
        current.projectId !== expected.projectId ||
        current.apiType !== expected.apiType ||
        current.governanceBindingId !== expected.governanceBindingId ||
        current.statusCode !== 202 ||
        !isEqual(current.requestPayload, expected.requestPayload) ||
        !isEqual(current.responsePayload, expected.responsePayload)
      )
        return current?.statusCode === 200 &&
          current.projectId === expected.projectId &&
          current.apiType === expected.apiType &&
          current.governanceBindingId === expected.governanceBindingId &&
          isEqual(current.requestPayload, expected.requestPayload)
          ? current
          : undefined;
      const { operation, before, after } = current.requestPayload.nativeSqlPair;
      const row = await this.findOneBy(
        { id: after.id, projectId: expected.projectId },
        { tx },
      );
      const snapshot = (value: SqlPair | null) =>
        value && {
          id: value.id,
          projectId: value.projectId,
          question: value.question,
          sql: value.sql,
          updatedAt: value.updatedAt && new Date(value.updatedAt).toISOString(),
        };
      if (!isEqual(snapshot(row), snapshot(before || after))) return undefined;
      const result =
        operation === 'delete'
          ? (await this.deleteOne(after.id, { tx })) === 1
          : operation === 'update'
            ? await this.updateOne(
                after.id,
                {
                  sql: after.sql,
                  question: after.question,
                  updatedAt: new Date().toISOString(),
                },
                { tx },
              )
            : row;
      return history.updateOne(
        current.id,
        {
          statusCode: 200,
          responsePayload: { ...current.responsePayload, result },
          updatedAt: new Date().toISOString(),
        },
        { tx },
      );
    });
  }
}

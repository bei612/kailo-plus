import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ThreadRecommendationQuestionResult {
  question: string;
  category: string;
  sql: string;
}

export interface Thread {
  id: number; // ID
  projectId: number; // Reference to project.id
  summary: string; // Thread summary
  ownerKey?: string | null; // DD-133 §3: creating Kailo user (issuer+subject digest)

  // recommend question
  queryId?: string; // Query ID
  questionsSourceResponseId?: number | null;
  questions?: ThreadRecommendationQuestionResult[]; // Recommended questions
  questionsStatus?: string; // Status of the recommended questions
  questionsError?: object; // Error of the recommended questions
}

export interface IThreadRepository extends IBasicRepository<Thread> {
  listAllTimeDescOrder(projectId: number): Promise<Thread[]>;
  // DD-167 (20 §15.3): threads are an unbounded list, paged on the server,
  // most recent activity first.
  listPageByRecentActivity(
    projectId: number,
    offset: number,
    limit: number,
  ): Promise<{ items: Thread[]; total: number }>;
  lockRecommendation(
    thread: Thread,
    tx: Knex.Transaction,
  ): Promise<Thread | null>;
  claimRecommendation(
    thread: Thread,
    sourceResponseId: number,
    queryId: string,
  ): Promise<Thread | null>;
  updateRecommendation(
    thread: Thread,
    data: Partial<Thread>,
  ): Promise<Thread | null>;
}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  private readonly jsonbColumns = ['questions', 'questionsError'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
  }

  public async listAllTimeDescOrder(projectId: number): Promise<Thread[]> {
    const threads = await this.knex(this.tableName)
      .where(this.transformToDBData({ projectId }))
      .orderBy('created_at', 'desc');
    return threads.map((thread) => this.transformFromDBData(thread));
  }

  public async listPageByRecentActivity(
    projectId: number,
    offset: number,
    limit: number,
  ): Promise<{ items: Thread[]; total: number }> {
    const where = this.transformToDBData({ projectId });
    const counted = await this.knex(this.tableName)
      .where(where)
      .count({ total: '*' })
      .first();
    const total = Number(counted?.total ?? 0);
    if (total === 0 || offset >= total) return { items: [], total };
    // Last activity: the newest answer in the thread, else its creation.
    const rows = await this.knex(this.tableName)
      .select(`${this.tableName}.*`)
      .where(where)
      .orderByRaw(
        `coalesce((select max(tr.created_at) from thread_response tr where tr.thread_id = ${this.tableName}.id), ${this.tableName}.created_at) desc, ${this.tableName}.id desc`,
      )
      .offset(offset)
      .limit(limit);
    return {
      items: rows.map((thread) => this.transformFromDBData(thread)),
      total,
    };
  }

  public async lockRecommendation(
    thread: Thread,
    tx: Knex.Transaction,
  ): Promise<Thread | null> {
    const row = await tx(this.tableName)
      .where({ id: thread.id, project_id: thread.projectId })
      .forUpdate()
      .first();
    return row ? this.transformFromDBData(row) : null;
  }

  public async claimRecommendation(
    thread: Thread,
    sourceResponseId: number,
    queryId: string,
  ): Promise<Thread | null> {
    // One atomic native-row claim, including NULLs; concurrent callers cannot
    // both enter AI creation from the same observed original thread.
    const rows = await this.knex(this.tableName)
      .where({
        id: thread.id,
        project_id: thread.projectId,
        query_id: thread.queryId ?? null,
        questions_source_response_id: thread.questionsSourceResponseId ?? null,
        questions_status: thread.questionsStatus ?? null,
      })
      .whereExists(
        this.knex('thread_response as source_response')
          .select(this.knex.raw('1'))
          .where('source_response.thread_id', thread.id)
          .where('source_response.id', sourceResponseId)
          .where(
            'source_response.id',
            this.knex('thread_response')
              .max('id')
              .where('thread_id', thread.id),
          ),
      )
      .update(
        this.transformToDBData({
          queryId,
          questionsSourceResponseId: sourceResponseId,
          questionsStatus: 'GENERATING',
          questions: [],
          questionsError: null,
        }),
      )
      .returning('*');
    return rows[0] ? this.transformFromDBData(rows[0]) : null;
  }

  public async updateRecommendation(
    thread: Thread,
    data: Partial<Thread>,
  ): Promise<Thread | null> {
    const rows = await this.knex(this.tableName)
      .where({
        id: thread.id,
        project_id: thread.projectId,
        query_id: thread.queryId ?? null,
        questions_source_response_id: thread.questionsSourceResponseId ?? null,
        questions_status: thread.questionsStatus ?? null,
      })
      .update(this.transformToDBData(data))
      .returning('*');
    return rows[0] ? this.transformFromDBData(rows[0]) : null;
  }

  protected override transformFromDBData = (data: any): Thread => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    });
    return transformData as Thread;
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

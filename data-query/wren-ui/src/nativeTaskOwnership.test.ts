import knex, { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { AskingService } from './apollo/server/services/askingService';
import { AskingTaskTracker } from './apollo/server/services/askingTaskTracker';
import { AskingTaskRepository } from './apollo/server/repositories/askingTaskRepository';
import { AskResultStatus } from './apollo/server/models/adaptor';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { AdjustmentBackgroundTaskTracker } from './apollo/server/backgrounds/adjustmentBackgroundTracker';

describe('native task ownership consumers', () => {
  const owned = { id: 1, projectId: 7, queryId: 'owned', detail: {} };
  const foreign = { id: 2, projectId: 8, queryId: 'foreign', detail: {} };
  const adjustment = {
    id: 3,
    projectId: 7,
    queryId: 'adjustment',
    detail: { adjustment: true },
  };
  let service: any;
  beforeEach(() => {
    const tasks = [owned, foreign, adjustment];
    service = Object.assign(Object.create(AskingService.prototype), {
      projectService: { getCurrentProject: jest.fn(async () => ({ id: 7 })) },
      askingTaskRepository: {
        findOneBy: jest.fn(
          async (where) =>
            tasks.find((task) =>
              Object.entries(where).every(
                ([key, value]) => task[key] === value,
              ),
            ) ?? null,
        ),
      },
      askingTaskTracker: {
        getAskingResult: jest.fn(async (id) => ({ queryId: id })),
        cancelAskingTask: jest.fn(),
        bindThreadResponse: jest.fn(),
      },
      adjustmentBackgroundTracker: {
        getAdjustmentResult: jest.fn(async (id) => ({ queryId: id })),
        cancelAdjustmentTask: jest.fn(),
      },
      threadRepository: {
        findOneBy: jest.fn(async () => ({ id: 11, projectId: 7 })),
        transaction: jest.fn(async () => ({})),
        createOne: jest.fn(async (data) => ({ id: 11, ...data })),
        commit: jest.fn(),
        rollback: jest.fn(),
      },
      threadResponseRepository: {
        createOne: jest.fn(async (data) => ({ id: 21, ...data })),
        findOneBy: jest.fn(),
      },
      telemetry: { sendEvent: jest.fn() },
    });
  });
  it.each(['getAskingTask', 'getAdjustmentTask'])(
    '%s denies foreign query IDs before consulting caches',
    async (method) => {
      expect(await service[method]('foreign')).toBeNull();
      expect(service.askingTaskTracker.getAskingResult).not.toHaveBeenCalled();
      expect(
        service.adjustmentBackgroundTracker.getAdjustmentResult,
      ).not.toHaveBeenCalled();
    },
  );
  it.each(['getAskingTaskById', 'getAdjustmentTaskById'])(
    '%s denies foreign native IDs',
    async (method) => {
      expect(await service[method](2)).toBeNull();
      expect(service.askingTaskTracker.getAskingResult).not.toHaveBeenCalled();
      expect(
        service.adjustmentBackgroundTracker.getAdjustmentResult,
      ).not.toHaveBeenCalled();
    },
  );
  it.each(['cancelAskingTask', 'cancelAdjustThreadResponseAnswer'])(
    '%s denies foreign cancellation before upstream effects',
    async (method) => {
      await expect(service[method]('foreign')).rejects.toThrow(
        'task not found',
      );
      expect(service.askingTaskTracker.cancelAskingTask).not.toHaveBeenCalled();
      expect(
        service.adjustmentBackgroundTracker.cancelAdjustmentTask,
      ).not.toHaveBeenCalled();
    },
  );
  it('keeps owned asking and adjustment APIs usable without confusing their native task type', async () => {
    expect(await service.getAskingTaskById(1)).toEqual({ queryId: 'owned' });
    expect(await service.getAdjustmentTaskById(3)).toEqual({
      queryId: 'adjustment',
    });
    expect(await service.getAskingTask('adjustment')).toBeNull();
    expect(await service.getAdjustmentTask('owned')).toBeNull();
    await service.cancelAskingTask('owned');
    await service.cancelAdjustThreadResponseAnswer('adjustment');
  });
  it('rejects forged tracked results before creating a thread or a follow-up', async () => {
    const input = {
      question: 'native',
      trackedAskingResult: { taskId: 2, queryId: 'foreign' },
    };
    await expect(service.createThread(input)).rejects.toThrow(
      'Asking task not found',
    );
    await expect(service.createThreadResponse(input, 11)).rejects.toThrow(
      'Asking task not found',
    );
    expect(service.threadRepository.transaction).not.toHaveBeenCalled();
    expect(service.threadResponseRepository.createOne).not.toHaveBeenCalled();
  });
  it('rolls back original thread/response creation when its task loses a concurrent binding', async () => {
    service.askingTaskTracker.bindThreadResponse.mockRejectedValue(
      new Error('already bound'),
    );
    await expect(
      service.createThread({
        question: 'native',
        trackedAskingResult: { taskId: 1, queryId: 'owned' },
      }),
    ).rejects.toThrow('already bound');
    expect(service.threadRepository.rollback).toHaveBeenCalledTimes(1);
    expect(service.threadRepository.commit).not.toHaveBeenCalled();
  });
  it('reuses an already bound response and rejects rebinding the same result to another thread', async () => {
    service.askingTaskRepository.findOneBy.mockResolvedValue({
      ...owned,
      threadId: 11,
      threadResponseId: 21,
    });
    service.threadResponseRepository.findOneBy.mockResolvedValue({
      id: 21,
      threadId: 11,
      askingTaskId: 1,
    });
    const input = {
      question: 'native',
      trackedAskingResult: { taskId: 1, queryId: 'owned' },
    };
    expect((await service.createThread(input)).id).toBe(11);
    expect((await service.createThreadResponse(input, 11)).id).toBe(21);
    service.threadRepository.findOneBy.mockImplementation(async (where) => ({
      id: where.id,
      projectId: 7,
    }));
    await expect(service.createThreadResponse(input, 12)).rejects.toThrow(
      'already bound',
    );
    expect(service.threadRepository.transaction).not.toHaveBeenCalled();
  });
  it('does not disclose a foreign view through an existing native response nested field', async () => {
    const view = new AskingResolver().getThreadResponseNestedResolver().view;
    const ctx: any = {
      projectService: service.projectService,
      askingService: {
        getResponse: jest.fn(async () => ({ id: 21, viewId: 88 })),
      },
      viewRepository: { findOneBy: jest.fn(async () => null) },
    };
    await expect(view({ id: 21, viewId: 88 } as any, {}, ctx)).rejects.toThrow(
      'View not found',
    );
    expect(ctx.viewRepository.findOneBy).toHaveBeenCalledWith({
      id: 88,
      projectId: 7,
    });
  });
});

describe('acknowledged native asking task persistence and observation', () => {
  let rows: any[],
    repository: any,
    adaptor: any,
    tracker: any,
    responses: any,
    views: any;
  beforeEach(() => {
    jest.useFakeTimers();
    rows = [];
    repository = {
      createOne: jest.fn(async (data) => {
        const row = { id: 1, ...data };
        rows.push(row);
        return row;
      }),
      findByQueryId: jest.fn(
        async (queryId) => rows.find((row) => row.queryId === queryId) ?? null,
      ),
      findOneBy: jest.fn(
        async (where) =>
          rows.find((row) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) ?? null,
      ),
      updateQuery: jest.fn(async (id, queryId, projectId, data) => {
        const row = rows.find(
          (row) =>
            row.id === id &&
            row.queryId === queryId &&
            row.projectId === projectId,
        );
        return row ? Object.assign(row, data) : null;
      }),
      bindResponse: jest.fn(),
      lockQuery: jest.fn(),
      transaction: jest.fn(async () => ({})),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    adaptor = {
      ask: jest.fn(async () => ({ queryId: 'acknowledged' })),
      getAskResult: jest.fn(async () => ({
        status: AskResultStatus.FINISHED,
        response: [{ sql: 'SELECT 1' }],
        error: null,
      })),
    };
    responses = { findOneBy: jest.fn(), updateOne: jest.fn() };
    views = { findOneBy: jest.fn() };
    tracker = new AskingTaskTracker({
      wrenAIAdaptor: adaptor,
      askingTaskRepository: repository,
      threadResponseRepository: responses,
      viewRepository: views,
    });
  });
  afterEach(() => {
    tracker.stopPolling();
    jest.useRealTimers();
  });
  it('persists project ownership at native ACK before the first poll', async () => {
    await tracker.createAskingTask({ query: 'native', projectId: 7 });
    expect(rows).toEqual([
      expect.objectContaining({
        projectId: 7,
        queryId: 'acknowledged',
        detail: { status: AskResultStatus.UNDERSTANDING },
      }),
    ]);
    expect((await tracker.getAskingResult('acknowledged')).taskId).toBe(1);
    expect(adaptor.getAskResult).not.toHaveBeenCalled();
  });
  it('reattaches the persisted native ID after restart and observes without asking again', async () => {
    rows.push({
      id: 9,
      projectId: 7,
      queryId: 'persisted',
      detail: { status: AskResultStatus.UNDERSTANDING },
    });
    repository.lockQuery.mockResolvedValue(rows[0]);
    await tracker.getAskingResult('persisted');
    await tracker.pollTasks();
    expect(adaptor.getAskResult).toHaveBeenCalledWith('persisted');
    expect(rows[0].detail.status).toBe(AskResultStatus.FINISHED);
    expect(adaptor.ask).not.toHaveBeenCalled();
  });
  it('does not resurrect a deleted or superseded task from an old in-flight result', async () => {
    await tracker.createAskingTask({ query: 'native', projectId: 7 });
    rows[0].queryId = 'newer';
    repository.lockQuery.mockResolvedValue(null);
    await tracker.pollTasks();
    expect(repository.updateQuery).not.toHaveBeenCalled();
    expect(repository.createOne).toHaveBeenCalledTimes(1);
    expect(rows[0].detail.status).toBe(AskResultStatus.UNDERSTANDING);
  });
  it('retries result persistence observation failure without redispatch', async () => {
    await tracker.createAskingTask({ query: 'native', projectId: 7 });
    repository.updateQuery.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    repository.lockQuery.mockResolvedValue(rows[0]);
    await tracker.pollTasks();
    await tracker.pollTasks();
    expect(repository.updateQuery).toHaveBeenCalledTimes(2);
    expect(adaptor.ask).toHaveBeenCalledTimes(1);
    expect(rows[0].detail.status).toBe(AskResultStatus.FINISHED);
  });
  it('binds persisted results after restart but refuses a foreign view before writing SQL', async () => {
    repository.bindResponse.mockResolvedValue({
      detail: {
        status: AskResultStatus.FINISHED,
        response: [{ viewId: 88, sql: 'foreign' }],
      },
    });
    responses.findOneBy.mockResolvedValue({
      id: 21,
      threadId: 11,
      askingTaskId: 9,
    });
    views.findOneBy.mockResolvedValue(null);
    await expect(
      tracker.bindThreadResponse(9, 'persisted', 11, 21, 7, {}),
    ).rejects.toThrow('View not found');
    expect(views.findOneBy).toHaveBeenCalledWith(
      { id: 88, projectId: 7 },
      { tx: {} },
    );
    expect(responses.updateOne).not.toHaveBeenCalled();
  });
  it('does not turn an unknown native result into success or failure', async () => {
    await tracker.createAskingTask({ query: 'native', projectId: 7 });
    adaptor.getAskResult.mockResolvedValue({
      status: 'FUTURE_NATIVE_STATUS',
      response: [],
    });
    await tracker.pollTasks();
    expect(rows[0].detail.status).toBe('FUTURE_NATIVE_STATUS');
    expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(false);
  });
  it('persists adjustment ownership and binds the original response atomically, keyed by task ID', async () => {
    tracker.stopPolling();
    adaptor.createAskFeedback = jest.fn(async () => ({ queryId: 'adjusted' }));
    responses.createOne = jest.fn(async (data) => ({ id: 21, ...data }));
    tracker = new AdjustmentBackgroundTaskTracker({
      wrenAIAdaptor: adaptor,
      askingTaskRepository: repository,
      threadResponseRepository: responses,
      telemetry: { sendEvent: jest.fn() } as any,
    });
    await tracker.createAdjustmentTask({
      projectId: 7,
      threadId: 11,
      originalThreadResponseId: 20,
      question: 'native',
      tables: [],
      configurations: { language: 'English' },
    });
    expect(rows[0]).toMatchObject({
      id: 1,
      projectId: 7,
      threadId: 11,
      threadResponseId: 21,
      queryId: 'adjusted',
    });
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(tracker.trackedTasksById.has(1)).toBe(true);
    expect(tracker.trackedTasksById.has(21)).toBe(false);
  });
  it('reattaches adjustment queries after restart and stores final SQL with its result in one transaction', async () => {
    tracker.stopPolling();
    rows.push({
      id: 9,
      projectId: 7,
      queryId: 'adjusted',
      threadId: 11,
      threadResponseId: 21,
      detail: { adjustment: true, status: 'UNDERSTANDING' },
    });
    adaptor.getAskFeedbackResult = jest.fn(async () => ({
      status: 'FINISHED',
      response: [{ sql: 'SELECT 2' }],
      error: null,
    }));
    adaptor.createAskFeedback = jest.fn();
    repository.lockQuery.mockResolvedValue(rows[0]);
    responses.findOneBy.mockResolvedValue({
      id: 21,
      threadId: 11,
      askingTaskId: 9,
    });
    tracker = new AdjustmentBackgroundTaskTracker({
      wrenAIAdaptor: adaptor,
      askingTaskRepository: repository,
      threadResponseRepository: responses,
      telemetry: { sendEvent: jest.fn() } as any,
    });
    await tracker.getAdjustmentResult('adjusted');
    await tracker.pollTasks();
    expect(adaptor.getAskFeedbackResult).toHaveBeenCalledWith('adjusted');
    expect(adaptor.createAskFeedback).not.toHaveBeenCalled();
    expect(repository.updateQuery).toHaveBeenCalledWith(
      9,
      'adjusted',
      7,
      expect.objectContaining({
        detail: expect.objectContaining({
          adjustment: true,
          status: 'FINISHED',
        }),
      }),
      expect.anything(),
    );
    expect(responses.updateOne).toHaveBeenCalledWith(
      21,
      { sql: 'SELECT 2' },
      { tx: expect.anything() },
    );
    expect(repository.commit).toHaveBeenCalledTimes(1);
  });
});

const databaseTests = process.env.WREN_QUERY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
databaseTests(
  'native task migration and conditional binding in PostgreSQL',
  () => {
    let database: Knex, repository: AskingTaskRepository;
    const schema = `task_evidence_${randomUUID().replaceAll('-', '')}`;
    const migration = require(
      join(process.cwd(), 'migrations/20261007000000_asking_task_project.js'),
    );
    beforeAll(async () => {
      database = knex({
        client: 'pg',
        connection: process.env.WREN_QUERY_TEST_DATABASE_URL,
        searchPath: [schema],
      });
      await database.schema.createSchema(schema);
      for (const name of [
        '20240125070643_create_project_table.js',
        '20240327030000_create_ask_table.js',
        '20250509000000_create_asking_task.js',
        '20250509000001_add_task_id_to_thread.js',
      ])
        await require(join(process.cwd(), 'migrations', name)).up(database);
      await database('project').insert([
        {
          id: 7,
          type: 'DUCKDB',
          display_name: 'owned',
          catalog: 'wren',
          schema: 'public',
        },
        {
          id: 8,
          type: 'DUCKDB',
          display_name: 'foreign',
          catalog: 'wren',
          schema: 'public',
        },
      ]);
      await database('thread').insert([
        { id: 11, project_id: 7 },
        { id: 12, project_id: 8 },
        { id: 14, project_id: 7 },
      ]);
      await database('thread_response').insert([
        { id: 21, thread_id: 11 },
        { id: 22, thread_id: 12 },
        { id: 24, thread_id: 14 },
      ]);
      repository = new AskingTaskRepository(database);
    });
    afterAll(async () => {
      await database.schema.dropSchemaIfExists(schema, true);
      await database.destroy();
    });
    it('refuses unprovable legacy rows without deleting them or inventing a project', async () => {
      await database('asking_task').insert({ id: 1, query_id: 'unbound' });
      await expect(
        database.transaction((tx) => migration.up(tx)),
      ).rejects.toThrow('ID: 1');
      expect(await database.schema.hasColumn('asking_task', 'project_id')).toBe(
        false,
      );
      expect((await database('asking_task')).length).toBe(1);
      await database('asking_task')
        .where({ id: 1 })
        .update({ thread_id: 11, thread_response_id: 22 });
      await expect(
        database.transaction((tx) => migration.up(tx)),
      ).rejects.toThrow('ID: 1');
      await database('asking_task')
        .where({ id: 1 })
        .update({ thread_response_id: 21 });
    });
    it('backfills only matching original thread evidence and requires ownership for new rows', async () => {
      await database.transaction((tx) => migration.up(tx));
      expect((await repository.findOneBy({ id: 1 })).projectId).toBe(7);
      await expect(
        database('asking_task').insert({ query_id: 'missing-owner' }),
      ).rejects.toThrow();
      await expect(
        database('asking_task').insert({
          project_id: 99,
          query_id: 'unknown-owner',
        }),
      ).rejects.toThrow();
      await expect(migration.down(database)).rejects.toThrow(
        'ownership evidence',
      );
    });
    it('serializes concurrent first bindings and rejects foreign project or stale query receipts', async () => {
      await repository.createOne({ id: 2, projectId: 7, queryId: 'new-query' });
      expect(
        await repository.bindResponse(2, 'new-query', 8, 12, 22),
      ).toBeNull();
      const results = await Promise.all([
        repository.bindResponse(2, 'new-query', 7, 11, 21),
        repository.bindResponse(2, 'new-query', 7, 14, 24),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const accepted = results.find(Boolean);
      expect(
        await repository.bindResponse(
          2,
          'new-query',
          7,
          accepted.threadId,
          accepted.threadResponseId,
        ),
      ).not.toBeNull();
      expect(
        await repository.updateQuery(2, 'stale-query', 7, {
          question: 'overwrite',
        }),
      ).toBeNull();
      expect(
        await repository.updateQuery(2, 'new-query', 8, {
          question: 'overwrite',
        }),
      ).toBeNull();
    });
    it('rolls back speculative native rows when a conditional binding fails', async () => {
      await expect(
        database.transaction(async (tx) => {
          await tx('thread').insert({ id: 13, project_id: 7 });
          await tx('thread_response').insert({ id: 23, thread_id: 13 });
          if (!(await repository.bindResponse(1, 'unbound', 7, 13, 23, tx)))
            throw new Error('already bound');
        }),
      ).rejects.toThrow('already bound');
      expect(await database('thread').where({ id: 13 })).toEqual([]);
      expect(await database('thread_response').where({ id: 23 })).toEqual([]);
    });
    it('permits empty rollback then forward migration only after evidence is absent', async () => {
      await database('asking_task').delete();
      await migration.down(database);
      expect(await database.schema.hasColumn('asking_task', 'project_id')).toBe(
        false,
      );
      await database.transaction((tx) => migration.up(tx));
      expect(await database.schema.hasColumn('asking_task', 'project_id')).toBe(
        true,
      );
    });
  },
);

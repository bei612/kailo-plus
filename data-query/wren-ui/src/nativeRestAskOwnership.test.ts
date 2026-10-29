import knex, { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { join } from 'path';
import {
  ApiHistoryRepository,
  ApiType,
} from './apollo/server/repositories/apiHistoryRepository';
import { AskingTaskRepository } from './apollo/server/repositories/askingTaskRepository';
import {
  AskCandidateType,
  AskFeedbackStatus,
  AskResult,
  AskResultStatus,
} from './apollo/server/models/adaptor';
import { AskingTaskTracker } from './apollo/server/services/askingTaskTracker';
import { AdjustmentBackgroundTaskTracker as AdjustmentTaskTracker } from './apollo/server/backgrounds/adjustmentBackgroundTracker';
import { ThreadResponseRepository } from './apollo/server/repositories/threadResponseRepository';
import { GeneralErrorCodes } from './apollo/server/utils/error';
import { lockNativeBinding } from './apollo/server/repositories/projectRepository';

describe('original REST history and callback task transaction', () => {
  let database: Knex, tx: Knex.Transaction;
  const postgres = process.env.WREN_TEST_POSTGRES_URL;
  const schema = `native_binding_${randomUUID().replace(/-/g, '')}`;
  let history: ApiHistoryRepository, tasks: AskingTaskRepository;
  const nativeScope = {
    bindingId: randomUUID(),
    generation: 1,
    identityScope: 'a'.repeat(64),
    metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
  };
  const input = (apiType = ApiType.ASK) => {
    const id = randomUUID();
    return {
      id,
      projectId: 7,
      apiType,
      threadId: id,
      governanceBindingId: nativeScope.bindingId,
      governanceGeneration: nativeScope.generation,
      statusCode: 202,
      durationMs: 0,
      requestPayload: {
        question: 'Original question',
        nativeAsk: {
          taskId: id,
          identityScope: nativeScope.identityScope,
          metadataReference: nativeScope.metadataReference,
          histories: [],
        },
      },
      responsePayload: { threadId: id, nativeAsk: {} },
    };
  };
  beforeAll(async () => {
    database = knex(
      postgres
        ? {
            client: 'pg',
            connection: postgres,
            searchPath: [schema],
          }
        : {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
          },
    );
    if (postgres) await database.schema.createSchema(schema);
    for (const name of [
      '20240125070643_create_project_table.js',
      '20240327030000_create_ask_table.js',
      '20241207000000_update_thread_response_for_answer.js',
      '20250509000000_create_asking_task.js',
      '20250509000001_add_task_id_to_thread.js',
      '20261007000000_asking_task_project.js',
      '20250511000000-create-api-history.js',
      '20261005000000_api_history_governed_query.js',
      '20261011000000_native_binding_fence.js',
    ])
      await jest
        .requireActual(join(process.cwd(), 'migrations', name))
        .up(database);
    await database('project').insert({
      id: 7,
      type: 'DUCKDB',
      display_name: 'owned',
      catalog: 'wren',
      schema: 'public',
    });
  });
  beforeEach(async () => {
    tx = await database.transaction();
    history = new ApiHistoryRepository(tx);
    tasks = new AskingTaskRepository(tx);
  });
  afterEach(async () => {
    await tx.rollback();
  });
  afterAll(async () => {
    if (postgres) await database.schema.dropSchema(schema, true);
    await database.destroy();
  });

  it.each([
    ApiType.ASK,
    ApiType.STREAM_ASK,
    ApiType.GENERATE_SQL,
    ApiType.STREAM_GENERATE_SQL,
  ])(
    '%s commits one original HUMAN callback owner with the fixed API key',
    async (type) => {
      const record = input(type);
      expect((await history.prepareNativeGeneration(record)).created).toBe(
        true,
      );
      expect((await history.prepareNativeGeneration(record)).created).toBe(
        false,
      );
      const task = await tasks.findByQueryId(record.id);
      expect(task).toMatchObject({
        queryId: record.id,
        projectId: 7,
        question: 'Original question',
        detail: {
          status: AskResultStatus.UNDERSTANDING,
          nativeScope,
        },
      });
      expect(
        Number((await tx('asking_task').count('* as count').first()).count),
      ).toBe(1);
      expect(
        Number((await tx('api_history').count('* as count').first()).count),
      ).toBe(1);
    },
  );
  it('fences the same original task writers without closing another binding or next generation', async () => {
    const record = input();
    await history.prepareNativeGeneration(record);
    const upperCaseRecord = {
      ...input(),
      governanceBindingId: nativeScope.bindingId.toUpperCase(),
    };
    await history.prepareNativeGeneration(upperCaseRecord);
    const observed = await history.reconcileNativeBinding(
      7,
      nativeScope.bindingId,
      1,
      65536,
    );
    expect(observed.complete).toBe(true);
    expect(observed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nativeType: 'wren.api_history',
          nativeId: upperCaseRecord.id,
        }),
        expect.objectContaining({
          nativeType: 'wren.asking_task',
          idempotencyKey: upperCaseRecord.id,
        }),
      ]),
    );
    expect(observed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nativeType: 'wren.api_history',
          nativeId: record.id,
          platformStatus: 'UNKNOWN',
        }),
        expect.objectContaining({
          nativeType: 'wren.asking_task',
          idempotencyKey: record.id,
          platformStatus: 'UNKNOWN',
        }),
      ]),
    );
    await expect(history.prepareNativeGeneration(input())).rejects.toThrow(
      'NATIVE_BINDING_CLOSED',
    );
    const sameBinding = {
      ...input(),
      governanceBindingId: nativeScope.bindingId.toUpperCase(),
    };
    await expect(history.prepareNativeGeneration(sameBinding)).rejects.toThrow(
      'NATIVE_BINDING_CLOSED',
    );
    await expect(
      tasks.registerNativeQuery(record.id, 7, nativeScope, randomUUID()),
    ).rejects.toThrow('NATIVE_BINDING_CLOSED');
    const next = input();
    next.governanceGeneration = 2;
    expect((await history.prepareNativeGeneration(next)).created).toBe(true);
    const other = input();
    other.governanceBindingId = randomUUID();
    expect((await history.prepareNativeGeneration(other)).created).toBe(true);
    const repeated = await history.reconcileNativeBinding(
      7,
      nativeScope.bindingId,
      1,
      65536,
    );
    expect(repeated.complete).toBe(true);
    expect(repeated.observations).toHaveLength(observed.observations.length);
    expect(repeated.observations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nativeId: next.id })]),
    );
    expect(repeated.observations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ idempotencyKey: next.id }),
      ]),
    );
    expect(
      await tasks.createOne({ projectId: 7, queryId: randomUUID() }),
    ).toBeDefined();
  });
  it('roundtrips an unused migration and refuses to erase native generation or fence evidence', async () => {
    const migration = jest.requireActual(
      join(
        process.cwd(),
        'migrations',
        '20261011000000_native_binding_fence.js',
      ),
    );
    await migration.down(tx);
    expect(await tx.schema.hasColumn('project', 'native_binding_fences')).toBe(
      false,
    );
    await migration.up(tx);
    expect(
      await tx.schema.hasColumn('api_history', 'governance_generation'),
    ).toBe(true);
    const record = input();
    await history.prepareNativeGeneration(record);
    await expect(migration.down(tx)).rejects.toThrow('must be retained');
    await tx('api_history')
      .where({ id: record.id })
      .update({ governance_generation: null });
    await lockNativeBinding(tx, 7, nativeScope, true);
    await expect(migration.down(tx)).rejects.toThrow('must be retained');
  });
  it('does not attribute historical generations or declare their enumeration proven', async () => {
    const record = input();
    await history.prepareNativeGeneration(record);
    await tx('api_history')
      .where({ id: record.id })
      .update({ governance_generation: null });
    const observed = await history.reconcileNativeBinding(
      7,
      nativeScope.bindingId,
      1,
      65536,
    );
    expect(observed.complete).toBe(false);
    expect(observed.observations).toContainEqual(
      expect.objectContaining({
        nativeId: record.id,
        platformStatus: 'UNKNOWN',
      }),
    );
    expect(
      (await history.findOneBy({ id: record.id })).governanceGeneration,
    ).toBeNull();
  });
  it('rejects partial enumeration rather than returning a capped empty observation', async () => {
    await history.prepareNativeGeneration(input());
    await expect(
      history.reconcileNativeBinding(7, nativeScope.bindingId, 1, 1),
    ).rejects.toThrow('NATIVE_BINDING_RECONCILE_TOO_LARGE');
  });
  (postgres ? it : it.skip)(
    'serializes a delayed task writer with the original PostgreSQL project fence',
    async () => {
      const record = input();
      record.governanceBindingId = randomUUID();
      const fence = await database.transaction();
      await lockNativeBinding(
        fence,
        7,
        {
          bindingId: record.governanceBindingId,
          generation: record.governanceGeneration,
        },
        true,
      );
      const writer = new ApiHistoryRepository(database).prepareNativeGeneration(
        record,
      );
      const refused = expect(writer).rejects.toThrow('NATIVE_BINDING_CLOSED');
      await fence.commit();
      await refused;
      expect(
        await database('api_history').where({ id: record.id }).first(),
      ).toBeUndefined();
    },
  );
  it('rolls back the history when the original query_id already belongs to another task', async () => {
    const record = input();
    await tasks.createOne({
      projectId: 7,
      queryId: record.id,
      question: 'Foreign',
      detail: {
        status: AskResultStatus.FINISHED,
        type: null,
        response: null,
        error: null,
      },
    });
    await expect(history.prepareNativeGeneration(record)).rejects.toMatchObject(
      {
        code: postgres ? '23505' : 'SQLITE_CONSTRAINT_UNIQUE',
      },
    );
    expect(await history.findOneBy({ id: record.id })).toBeNull();
    expect((await tasks.findByQueryId(record.id)).question).toBe('Foreign');
  });
  it('refuses to adopt a missing or changed HUMAN owner on history replay', async () => {
    const record = input();
    await history.prepareNativeGeneration(record);
    const task = await tasks.findByQueryId(record.id);
    await tasks.updateOne(task.id, {
      detail: {
        ...task.detail,
        nativeScope: { ...nativeScope, identityScope: 'd'.repeat(64) },
      },
    });
    await expect(history.prepareNativeGeneration(record)).rejects.toThrow(
      'QUERY_INTENT_CONFLICT',
    );
    await tasks.deleteOne(String(task.id));
    await expect(history.prepareNativeGeneration(record)).rejects.toThrow(
      'QUERY_INTENT_CONFLICT',
    );
  });
  it('persists AI STOPPED with its registered SQL keys, not SQL cancellation', async () => {
    const record = input();
    const owner = await history.prepareNativeGeneration(record);
    const child = randomUUID();
    await tasks.registerNativeQuery(record.id, 7, nativeScope, child);
    const result = {
      status: AskResultStatus.STOPPED,
      error: { code: 'OTHERS', message: 'NATIVE_EXECUTION_UNKNOWN' },
    };
    const changed = await history.advanceNativeGeneration(
      owner.record,
      {
        ...record.responsePayload,
        nativeAsk: { askResult: result },
      },
      202,
      1,
    );
    expect(changed.statusCode).toBe(202);
    expect((await tasks.findByQueryId(record.id)).detail).toEqual({
      ...result,
      nativeScope,
      nativeQueries: [child],
    });
    expect(
      await history.advanceNativeGeneration(
        owner.record,
        { nativeAsk: { askResult: { status: AskResultStatus.FINISHED } } },
        200,
        2,
      ),
    ).toBeNull();
    expect((await tasks.findByQueryId(record.id)).detail.status).toBe(
      AskResultStatus.STOPPED,
    );
  });
  it('rolls back a terminal history write when its task ownership changed', async () => {
    const record = input();
    const owner = await history.prepareNativeGeneration(record);
    const task = await tasks.findByQueryId(record.id);
    await tasks.updateOne(task.id, { question: 'Changed' });
    await expect(
      history.advanceNativeGeneration(
        owner.record,
        { nativeAsk: { askResult: { status: AskResultStatus.FINISHED } } },
        200,
        1,
      ),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect((await history.findOneBy({ id: record.id })).statusCode).toBe(202);
  });

  it('GENERAL native DONE closes registration with its exact settled child set in the same transaction', async () => {
    const record = input();
    const prepared = await history.prepareNativeGeneration(record);
    const payload = {
      threadId: record.id,
      type: 'NON_SQL_QUERY',
      explanation: 'Original answer',
      nativeAsk: {
        doneQueryId: record.id,
        askResult: {
          status: AskResultStatus.UNDERSTANDING,
          type: 'GENERAL',
          response: null,
          error: null,
        },
      },
    };
    // Persist the real stream's DONE before final publication; losing the
    // close race must not erase evidence or reopen a non-replayable stream.
    const done = await history.advanceNativeGeneration(
      prepared.record,
      payload,
      202,
      1,
    );
    const child = randomUUID();
    await tasks.registerNativeQuery(record.id, 7, nativeScope, child);
    expect(
      await history.advanceNativeGeneration(done, payload, 200, 2, []),
    ).toBeNull();
    expect(
      (await history.findOneBy({ id: record.id })).responsePayload.nativeAsk
        .doneQueryId,
    ).toBe(record.id);
    expect((await history.findOneBy({ id: record.id })).statusCode).toBe(202);
    expect((await tasks.findByQueryId(record.id)).detail.status).toBe(
      AskResultStatus.UNDERSTANDING,
    );
    expect(
      (await history.advanceNativeGeneration(done, payload, 200, 3, [child]))
        .statusCode,
    ).toBe(200);
    expect((await tasks.findByQueryId(record.id)).detail.status).toBe(
      AskResultStatus.FINISHED,
    );
    expect(
      await tasks.registerNativeQuery(record.id, 7, nativeScope, randomUUID()),
    ).toBeNull();
    expect(
      await tasks.registerNativeQuery(record.id, 7, nativeScope, child),
    ).not.toBeNull();
  });

  it.each([
    AskResultStatus.FINISHED,
    AskResultStatus.FAILED,
    AskResultStatus.STOPPED,
  ])(
    '%s is immutable for the same query, exact detail replays and explicit new-query reruns remain valid',
    async (status) => {
      const record = input();
      await history.prepareNativeGeneration(record);
      const task = await tasks.findByQueryId(record.id);
      const child = randomUUID();
      await tasks.registerNativeQuery(record.id, 7, nativeScope, child);
      const detail = { ...task.detail, type: null, error: null, status };
      const closed = await tasks.updateQuery(task.id, record.id, 7, { detail });
      expect(closed.detail.nativeQueries).toEqual([child]);
      expect(
        await tasks.updateQuery(task.id, record.id, 7, { detail }),
      ).toEqual(closed);
      for (const replacement of [
        { ...detail, status: AskResultStatus.GENERATING },
        {
          ...detail,
          status:
            status === AskResultStatus.FINISHED
              ? AskResultStatus.FAILED
              : AskResultStatus.FINISHED,
        },
        {
          ...detail,
          error: {
            code: GeneralErrorCodes.AI_SERVICE_UNDEFINED_ERROR,
            message: 'different terminal evidence',
          },
        },
      ])
        expect(
          await tasks.updateQuery(task.id, record.id, 7, {
            detail: replacement,
          }),
        ).toBeNull();
      expect((await tasks.findByQueryId(record.id)).detail).toEqual(
        closed.detail,
      );
      const next = randomUUID();
      expect(
        await tasks.updateQuery(task.id, record.id, 7, {
          queryId: next,
          detail: {
            ...task.detail,
            type: null,
            error: null,
            status: AskResultStatus.UNDERSTANDING,
          },
        }),
      ).toMatchObject({
        queryId: next,
        detail: { status: AskResultStatus.UNDERSTANDING },
      });
      expect(
        await tasks.updateQuery(task.id, record.id, 7, { detail }),
      ).toBeNull();
    },
  );

  it.each([AskResultStatus.FAILED, AskResultStatus.STOPPED])(
    'a concurrent %s task rejects REST FINISHED and rolls back its history publication',
    async (status) => {
      const record = input();
      const prepared = await history.prepareNativeGeneration(record);
      const task = await tasks.findByQueryId(record.id);
      await tasks.updateQuery(task.id, record.id, 7, {
        detail: { ...task.detail, type: null, error: null, status },
      });
      await expect(
        history.advanceNativeGeneration(
          prepared.record,
          {
            nativeAsk: { askResult: { status: AskResultStatus.FINISHED } },
          },
          200,
          1,
          [],
        ),
      ).rejects.toThrow('QUERY_INTENT_CONFLICT');
      expect((await history.findOneBy({ id: record.id })).statusCode).toBe(202);
      expect((await tasks.findByQueryId(record.id)).detail.status).toBe(status);
    },
  );

  const makeTracker = (adjustment: boolean, provider = jest.fn()) => {
    const dependencies = {
      askingTaskRepository: tasks,
      threadResponseRepository: new ThreadResponseRepository(tx),
      wrenAIAdaptor: { getAskResult: provider, getAskFeedbackResult: provider },
      viewRepository: {},
      telemetry: { sendEvent: jest.fn() },
    };
    const tracker = adjustment
      ? new AdjustmentTaskTracker(
          dependencies as unknown as ConstructorParameters<
            typeof AdjustmentTaskTracker
          >[0],
        )
      : new AskingTaskTracker(
          dependencies as unknown as ConstructorParameters<
            typeof AskingTaskTracker
          >[0],
        );
    tracker.stopPolling();
    return tracker;
  };
  const readTracker = (
    tracker: AskingTaskTracker | AdjustmentTaskTracker,
    queryId: string,
  ) =>
    tracker instanceof AskingTaskTracker
      ? tracker.getAskingResult(queryId)
      : tracker.getAdjustmentResult(queryId);

  it.each([false, true])(
    'original tracker (adjustment=%s) discards a late unchanged GENERATING observation after REST commits FINISHED',
    async (adjustment) => {
      const record = input();
      const prepared = await history.prepareNativeGeneration(record);
      const task = await tasks.findByQueryId(record.id);
      const generating = { ...task.detail, status: AskResultStatus.GENERATING };
      let release: () => void;
      let entered: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const provider = jest
        .fn()
        .mockResolvedValueOnce(generating)
        .mockImplementationOnce(async () => {
          entered();
          await pending;
          return generating;
        });
      const tracker = makeTracker(adjustment, provider);
      await readTracker(tracker, record.id);
      await tracker['pollTasks']();
      expect((await readTracker(tracker, record.id)).status).toBe(
        AskResultStatus.GENERATING,
      );
      const polling = tracker['pollTasks']();
      await started;
      await history.advanceNativeGeneration(
        prepared.record,
        {
          nativeAsk: {
            askResult: { ...generating, status: AskResultStatus.FINISHED },
          },
        },
        200,
        1,
        [],
      );
      release();
      await polling;
      expect((await tasks.findByQueryId(record.id)).detail.status).toBe(
        AskResultStatus.FINISHED,
      );
      expect(
        await tasks.registerNativeQuery(
          record.id,
          7,
          nativeScope,
          randomUUID(),
        ),
      ).toBeNull();
      expect((await readTracker(tracker, record.id)).status).toBe(
        AskResultStatus.FINISHED,
      );
      expect(tracker['trackedTasks'].has(record.id)).toBe(false);
      expect(tracker['trackedTasksById'].has(task.id)).toBe(false);
    },
  );

  it.each([false, true])(
    'original tracker (adjustment=%s) rolls back a response write when the same task already has different terminal evidence',
    async (adjustment) => {
      const record = input();
      await history.prepareNativeGeneration(record);
      const task = await tasks.findByQueryId(record.id);
      const [thread] = await tx('thread')
        .insert({ project_id: 7 })
        .returning('*');
      const responses = new ThreadResponseRepository(tx);
      const response = await responses.createOne({
        threadId: thread.id,
        askingTaskId: task.id,
        sql: 'SELECT original',
      });
      await tasks.bindResponse(task.id, record.id, 7, thread.id, response.id);
      await tasks.updateQuery(task.id, record.id, 7, {
        detail: {
          ...task.detail,
          type: null,
          error: null,
          status: AskResultStatus.STOPPED,
        },
      });
      const tracker = makeTracker(adjustment);
      const observed = {
        projectId: 7,
        taskId: task.id,
        queryId: record.id,
        threadResponseId: response.id,
        lastPolled: 0,
        isFinalized: false,
        question: task.question,
        originalThreadResponseId: response.id,
      };
      const result: AskResult = {
        status: AskResultStatus.FINISHED,
        response: [{ sql: 'SELECT late', type: AskCandidateType.LLM }],
        error: null,
        type: null,
      };
      const write =
        tracker instanceof AskingTaskTracker
          ? tracker['updateThreadResponseWhenTaskFinalized']({
              ...observed,
              result,
            })
          : tracker['updateThreadResponseWhenTaskFinalized'](observed, {
              ...result,
              status: AskFeedbackStatus.FINISHED,
              response: [{ sql: 'SELECT late', type: AskCandidateType.LLM }],
            });
      await expect(write).rejects.toThrow('changed during observation');
      expect((await responses.findOneBy({ id: response.id })).sql).toBe(
        'SELECT original',
      );
      expect((await tasks.findByQueryId(record.id)).detail.status).toBe(
        AskResultStatus.STOPPED,
      );
    },
  );

  it.each([false, true])(
    'tracker cleanup (adjustment=%s) retains UNKNOWN, changed scope and unreadable state',
    async (adjustment) => {
      const record = input();
      await history.prepareNativeGeneration(record);
      const observed = await tasks.findByQueryId(record.id);
      const tracker = makeTracker(adjustment);
      await readTracker(tracker, record.id);
      const tracked = tracker['trackedTasks'].get(record.id);
      const cleanup = () =>
        tracker instanceof AskingTaskTracker
          ? tracker['discardClosedObservation'](
              tracker['trackedTasks'].get(record.id),
              observed,
            )
          : tracker['discardClosedObservation'](
              tracker['trackedTasks'].get(record.id),
              observed,
            );
      expect(await cleanup()).toBe(false);
      expect(tracker['trackedTasks'].get(record.id)).toBe(tracked);
      await tasks.updateOne(observed.id, {
        detail: {
          ...observed.detail,
          type: null,
          error: null,
          status: AskResultStatus.FINISHED,
          nativeScope: { ...nativeScope, identityScope: 'e'.repeat(64) },
        },
      });
      expect(await cleanup()).toBe(false);
      expect(tracker['trackedTasks'].get(record.id)).toBe(tracked);
      const read = jest
        .spyOn(tasks, 'findOneBy')
        .mockRejectedValueOnce(new Error('storage unavailable'));
      await expect(cleanup()).rejects.toThrow('storage unavailable');
      read.mockRestore();
      expect(tracker['trackedTasks'].get(record.id)).toBe(tracked);
      expect(tracker['trackedTasksById'].get(observed.id)).toBe(tracked);
    },
  );
});

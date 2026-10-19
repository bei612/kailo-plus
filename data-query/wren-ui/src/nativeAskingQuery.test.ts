import knex, { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { AskingTaskRepository } from './apollo/server/repositories/askingTaskRepository';
import { AskResultStatus, AskResultType } from './apollo/server/models/adaptor';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { AskingService } from './apollo/server/services/askingService';
import { components } from './common';
import { ApiType } from './apollo/server/repositories/apiHistoryRepository';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from './apollo/server/services/nativeHumanQuery';
import {
  bindingServiceCall,
  loadQueryDelivery,
  digest,
} from './apollo/server/services/nativeQueryAdmission';

jest.mock('./common', () => ({
  components: { apiHistoryRepository: { findOneBy: jest.fn() } },
}));
jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));

describe('original Asking SQLite task and SQL receipt ownership', () => {
  let db: Knex;
  let repository: AskingTaskRepository;
  const scope = {
    bindingId: randomUUID(),
    generation: 1,
    identityScope: 'a'.repeat(64),
    metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
  };
  const queryId = randomUUID();
  const detail = { type: AskResultType.TEXT_TO_SQL, response: [], error: null };
  let id: number;
  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('asking_task', (table) => {
      table.increments('id');
      table.integer('project_id');
      table.string('query_id');
      table.text('detail');
      table.string('question');
    });
    await db.schema.createTable('project', (table) => {
      table.integer('id').primary();
      table.json('native_binding_fences');
    });
    await db('project').insert({ id: 7 });
    repository = new AskingTaskRepository(db);
    id = (
      await repository.createOne({
        projectId: 7,
        queryId,
        question: 'Original',
        detail: {
          ...detail,
          status: AskResultStatus.GENERATING,
          nativeScope: scope,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db?.destroy();
  });
  test('same original task registers once; old poll cannot lose an admitted query reference', async () => {
    const stale = await repository.findByQueryId(queryId);
    const key = randomUUID();
    await repository.registerNativeQuery(queryId, 7, scope, key);
    await repository.registerNativeQuery(queryId, 7, scope, key);
    await repository.updateQuery(id, queryId, 7, {
      detail: { ...stale.detail, ...detail, status: AskResultStatus.STOPPED },
    });
    expect(
      (await repository.findByQueryId(queryId)).detail.nativeQueries,
    ).toEqual([key]);
    expect((await repository.findByQueryId(queryId)).detail.status).toBe(
      AskResultStatus.STOPPED,
    );
  });
  test('a different HUMAN, project or changed query ID cannot register or overwrite the original task', async () => {
    const key = randomUUID();
    await db('project').insert({ id: 8 });
    expect(
      await repository.registerNativeQuery(queryId, 8, scope, key),
    ).toBeNull();
    await expect(
      repository.registerNativeQuery(queryId, 9, scope, key),
    ).rejects.toThrow('NATIVE_BINDING_PROVENANCE_UNAVAILABLE');
    expect(
      await repository.registerNativeQuery(
        queryId,
        7,
        { ...scope, identityScope: 'd'.repeat(64) },
        key,
      ),
    ).toBeNull();
    const nextId = randomUUID();
    await repository.updateQuery(id, queryId, 7, {
      queryId: nextId,
      detail: {
        ...detail,
        status: AskResultStatus.UNDERSTANDING,
        nativeScope: scope,
      },
    });
    expect(
      await repository.registerNativeQuery(queryId, 7, scope, key),
    ).toBeNull();
    expect(
      await repository.updateQuery(id, queryId, 7, {
        detail: { ...detail, status: AskResultStatus.FAILED },
      }),
    ).toBeNull();
    expect((await repository.findByQueryId(nextId)).detail.status).toBe(
      AskResultStatus.UNDERSTANDING,
    );
  });
  test('stopped original task permits old key observation but never another query registration', async () => {
    const key = randomUUID();
    await repository.registerNativeQuery(queryId, 7, scope, key);
    await repository.updateQuery(id, queryId, 7, {
      detail: {
        ...detail,
        status: AskResultStatus.STOPPED,
        nativeScope: scope,
      },
    });
    expect(
      await repository.registerNativeQuery(queryId, 7, scope, key),
    ).not.toBeNull();
    expect(
      await repository.registerNativeQuery(queryId, 7, scope, randomUUID()),
    ).toBeNull();
  });
});

describe('original model preview and Asking receipt consumers', () => {
  const config: any = {
    bindingId: randomUUID(),
    projectId: 7,
    nativeInstanceRef: 'fixture-instance',
    nativeScopeRef: '7',
  };
  const taskId = randomUUID();
  const key = randomUUID();
  let task: any;
  let ctx: any;
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
    task = {
      queryId: taskId,
      projectId: 7,
      detail: {
        status: AskResultStatus.GENERATING,
        nativeScope: {
          bindingId: config.bindingId,
          identityScope: 'a'.repeat(64),
          metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
        },
      },
    };
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'fixture-original-human',
      projectService: { getCurrentProject: jest.fn(async () => ({ id: 7 })) },
      askingTaskRepository: {
        findOneBy: jest.fn(async () => structuredClone(task)),
        registerNativeQuery: jest.fn(
          async (_task, _project, _scope, registered) => {
            task.detail.nativeQueries = [registered];
            return task;
          },
        ),
      },
    };
    (loadQueryDelivery as jest.Mock).mockResolvedValue(config);
    jest
      .spyOn(AskingResolver.prototype, 'authorizeNativeAskingTask')
      .mockImplementation(async () => structuredClone(task));
  });
  afterEach(() => {
    if (original === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  const args = () => ({
    data: {
      projectId: '7',
      nativeTaskId: taskId,
      sql: 'SELECT id FROM orders',
      limit: 1,
      dryRun: true,
      idempotencyKey: key,
      idempotencyScope: nativePreviewScope(config, 'a'.repeat(64)),
    },
  });
  test('original callback supplies task deployment and records child key only at native admission', async () => {
    const preview = jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...input) => {
        expect(input.slice(6, 10)).toEqual([
          taskId,
          task.detail.nativeScope.metadataReference.hash,
          undefined,
          false,
        ]);
        expect(
          ctx.askingTaskRepository.registerNativeQuery,
        ).not.toHaveBeenCalled();
        await input[10]();
        return {
          submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' },
        };
      });
    const result = await new ModelResolver().previewSql(null, args(), ctx);
    expect(preview.mock.calls[0][0]).toBe(ctx.nativeHumanToken);
    expect(ctx.askingTaskRepository.registerNativeQuery).toHaveBeenCalledWith(
      taskId,
      7,
      task.detail.nativeScope,
      key,
    );
    expect(result.submission.gateState).toBe('WAITING');
  });
  test('stopped original task is observation-only and a late new registration cannot dispatch', async () => {
    task.detail.status = AskResultStatus.STOPPED;
    task.detail.nativeQueries = [key];
    jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...input) => {
        expect(input[9]).toBe(true);
        await expect(input[10]()).rejects.toMatchObject({ status: 409 });
        return { submission: { dispatchState: 'UNKNOWN' } };
      });
    await new ModelResolver().previewSql(null, args(), ctx);
  });
  test('changed task scope after original query preparation refuses before child registration', async () => {
    jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...input) => {
        task.detail.nativeScope.identityScope = 'd'.repeat(64);
        await input[10]();
        throw new Error('unexpected dispatch');
      });
    await expect(
      new ModelResolver().previewSql(null, args(), ctx),
    ).rejects.toMatchObject({ status: 412 });
    expect(ctx.askingTaskRepository.registerNativeQuery).not.toHaveBeenCalled();
  });
  test.each([
    null,
    {
      submission: { gateState: 'ALLOWED', dispatchState: 'UNKNOWN' },
      terminalStatus: 'FAILED',
    },
    { submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' } },
  ])(
    'missing, unknown or approval-waiting original query never permits rerun (%j)',
    async (receipt) => {
      task.detail.nativeQueries = [key];
      (bindingServiceCall as jest.Mock).mockResolvedValue(receipt);
      await expect(
        new AskingResolver().settledNativeAskingQueries(taskId, ctx),
      ).rejects.toMatchObject({ status: 409 });
      expect(bindingServiceCall).toHaveBeenCalledWith(
        config,
        'human-action',
        { bindingId: config.bindingId, idempotencyKey: key },
        ctx.nativeHumanToken,
      );
    },
  );
  test('all original child receipts must be terminal with unchanged task reference set', async () => {
    task.detail.nativeQueries = [key];
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
      terminalStatus: 'COMPLETED',
    });
    expect(
      await new AskingResolver().settledNativeAskingQueries(taskId, ctx),
    ).toEqual([key]);
    (bindingServiceCall as jest.Mock).mockImplementation(async () => {
      task.detail.nativeQueries.push(randomUUID());
      return {
        submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
        terminalStatus: 'COMPLETED',
      };
    });
    await expect(
      new AskingResolver().settledNativeAskingQueries(taskId, ctx),
    ).rejects.toMatchObject({ status: 409 });
  });
  test('original GET returns stopped pending presentation without admitting a missing child AE', async () => {
    task.detail.status = AskResultStatus.STOPPED;
    task.detail.nativeQueries = [key];
    ctx.askingService = {
      getAskingTask: jest.fn(async () => ({
        status: AskResultStatus.STOPPED,
        type: 'TEXT_TO_SQL',
      })),
    };
    (bindingServiceCall as jest.Mock).mockResolvedValue(null);
    const preview = jest.spyOn(NativeHumanQuery.prototype, 'previewSql');
    const result = await new AskingResolver().getAskingTask(
      null,
      { taskId },
      ctx,
    );
    expect(result).toMatchObject({
      status: AskResultStatus.STOPPED,
      queryId: taskId,
      error: { message: 'NATIVE_EXECUTION_UNKNOWN' },
      candidates: [],
    });
    expect(preview).not.toHaveBeenCalled();
    expect(components.apiHistoryRepository.findOneBy).not.toHaveBeenCalled();
  });
  test('original empty thread and follow-up preserve stopped tasks so the existing recovery controls remain reachable', async () => {
    task.detail.status = AskResultStatus.STOPPED;
    task.detail.nativeQueries = [key];
    const tracked = {
      taskId: 1,
      queryId: taskId,
      question: 'Original',
      status: AskResultStatus.STOPPED,
    };
    ctx.askingService = {
      getAskingTask: jest.fn(async () => tracked),
      createThread: jest.fn(async () => ({ id: 11 })),
      createThreadResponse: jest.fn(async () => ({ id: 12 })),
    };
    ctx.telemetry = { sendEvent: jest.fn() };
    const resolver = new AskingResolver();
    expect(
      await resolver.createThread(null, { data: { taskId } }, ctx),
    ).toEqual({ id: 11 });
    expect(
      await resolver.createThreadResponse(
        null,
        { threadId: 11, data: { taskId } },
        ctx,
      ),
    ).toEqual({ id: 12 });
    expect(ctx.askingService.createThread).toHaveBeenCalledWith({
      question: 'Original',
      trackedAskingResult: tracked,
    });
    expect(ctx.askingService.createThreadResponse).toHaveBeenCalledWith(
      { question: 'Original', trackedAskingResult: tracked },
      11,
    );
    expect(bindingServiceCall).not.toHaveBeenCalled();
  });
  const prepareRerun = () => {
    task.detail.status = AskResultStatus.STOPPED;
    task.detail.nativeQueries = [key];
    ctx.askingService = {
      getResponse: jest.fn(async () => ({ askingTaskId: 1 })),
      rerunAskingTask: jest.fn(async () => ({ id: 'next-original-task' })),
    };
    ctx.askingTaskRepository.findOneBy = jest.fn(async () =>
      structuredClone(task),
    );
    ctx.telemetry = { sendEvent: jest.fn() };
    const resolver = new AskingResolver();
    jest
      .spyOn(resolver as any, 'nativeAskingScope')
      .mockResolvedValue(task.detail.nativeScope);
    return resolver;
  };
  test('original rerun observes pending same task, then allocates only after the original receipt really terminates', async () => {
    const resolver = prepareRerun();
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' },
    });
    expect(
      await resolver.rerunAskingTask(null, { responseId: 1 }, ctx),
    ).toEqual({ id: taskId });
    expect(ctx.askingService.rerunAskingTask).not.toHaveBeenCalled();
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
      terminalStatus: 'COMPLETED',
    });
    expect(
      await resolver.rerunAskingTask(null, { responseId: 1 }, ctx),
    ).toEqual({ id: 'next-original-task' });
    expect(ctx.askingService.rerunAskingTask).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        nativePreviousQueries: [key],
        nativeHumanToken: ctx.nativeHumanToken,
      }),
    );
  });
  const preparedHistory = () => ({
    projectId: 7,
    threadId: taskId,
    apiType: ApiType.RUN_SQL,
    governanceBindingId: config.bindingId,
    governanceKey: key,
    governanceDeploymentHash: 'b'.repeat(40),
    requestPayload: {
      sql: 'SELECT id FROM orders',
      limit: 1,
      action: 'data_query.query@v2',
      previewScope: nativePreviewScope(config, ctx.nativeIdentityScope),
    },
  });
  test('explicit rerun recovers pre-admission loss only from original frozen history and the SAME SQL key', async () => {
    const resolver = prepareRerun();
    (bindingServiceCall as jest.Mock).mockResolvedValue(null);
    (components.apiHistoryRepository.findOneBy as jest.Mock).mockResolvedValue(
      preparedHistory(),
    );
    const preview = jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...args) => {
        await args[10]();
        return {
          submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' },
        };
      });
    expect(
      await resolver.rerunAskingTask(null, { responseId: 1 }, ctx),
    ).toEqual({ id: taskId });
    expect(components.apiHistoryRepository.findOneBy).toHaveBeenCalledWith({
      governanceBindingId: config.bindingId,
      governanceKey: key,
      projectId: 7,
      threadId: taskId,
      apiType: ApiType.RUN_SQL,
    });
    expect(preview).toHaveBeenCalledWith(
      ctx.nativeHumanToken,
      key,
      'SELECT id FROM orders',
      1,
      nativePreviewScope(config, ctx.nativeIdentityScope),
      false,
      taskId,
      'b'.repeat(40),
      undefined,
      false,
      expect.any(Function),
    );
    expect(ctx.askingService.rerunAskingTask).not.toHaveBeenCalled();
  });
  test.each(['executed', 'changed-scope', 'changed-deployment', 'missing'])(
    'missing Core evidence never re-admits %s history',
    async (change) => {
      const resolver = prepareRerun();
      (bindingServiceCall as jest.Mock).mockResolvedValue(null);
      const history: any = preparedHistory();
      if (change === 'executed') history.governanceState = 'UNKNOWN';
      if (change === 'changed-scope')
        history.requestPayload.previewScope = 'f'.repeat(64);
      if (change === 'changed-deployment')
        history.governanceDeploymentHash = 'f'.repeat(40);
      (
        components.apiHistoryRepository.findOneBy as jest.Mock
      ).mockResolvedValue(change === 'missing' ? null : history);
      const preview = jest.spyOn(NativeHumanQuery.prototype, 'previewSql');
      expect(
        await resolver.rerunAskingTask(null, { responseId: 1 }, ctx),
      ).toEqual({ id: taskId });
      expect(preview).not.toHaveBeenCalled();
      expect(ctx.askingService.rerunAskingTask).not.toHaveBeenCalled();
    },
  );
  test('original pre-admission recovery rechecks task scope at its actual dispatch boundary', async () => {
    const resolver = prepareRerun();
    (bindingServiceCall as jest.Mock).mockResolvedValue(null);
    (components.apiHistoryRepository.findOneBy as jest.Mock).mockResolvedValue(
      preparedHistory(),
    );
    jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...args) => {
        task.detail.nativeScope.identityScope = 'f'.repeat(64);
        await args[10]();
        throw new Error('unauthorized dispatch');
      });
    expect(
      await resolver.rerunAskingTask(null, { responseId: 1 }, ctx),
    ).toEqual({ id: taskId });
    expect(ctx.askingService.rerunAskingTask).not.toHaveBeenCalled();
  });
  test('the original SQL callback derives adjustment ownership from the persisted task, not another client field', async () => {
    task.detail.adjustment = true;
    jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockImplementation(async (...input) => {
        await input[10]();
        return {
          submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' },
        };
      });
    await new ModelResolver().previewSql(null, args(), ctx);
    expect(
      AskingResolver.prototype.authorizeNativeAskingTask,
    ).toHaveBeenCalledWith(taskId, ctx, true);
    expect(ctx.askingTaskRepository.registerNativeQuery).toHaveBeenCalledWith(
      taskId,
      7,
      task.detail.nativeScope,
      key,
    );
  });
  test('adjustment GET only observes; existing rerun cannot replace a task with an unsettled child query', async () => {
    const resolver = prepareRerun();
    task.detail.adjustment = true;
    ctx.askingService.getAdjustmentTask = jest.fn(async () => ({
      queryId: taskId,
      status: 'STOPPED',
    }));
    ctx.askingService.rerunAdjustThreadResponseAnswer = jest.fn();
    jest
      .spyOn(resolver as any, 'authorizeNativeAdjustmentSource')
      .mockResolvedValue(undefined);
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      submission: { gateState: 'WAITING', dispatchState: 'NOT_DISPATCHED' },
    });
    expect(
      await resolver.getAdjustmentTask(null, { taskId }, ctx),
    ).toMatchObject({
      status: 'STOPPED',
      error: { message: 'NATIVE_EXECUTION_UNKNOWN' },
      sql: null,
    });
    expect(
      await resolver.rerunAdjustThreadResponseAnswer(
        null,
        { responseId: 1 },
        ctx,
      ),
    ).toBe(true);
    expect(
      ctx.askingService.rerunAdjustThreadResponseAnswer,
    ).not.toHaveBeenCalled();
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
      terminalStatus: 'COMPLETED',
    });
    await resolver.rerunAdjustThreadResponseAnswer(
      null,
      { responseId: 1 },
      ctx,
    );
    expect(
      ctx.askingService.rerunAdjustThreadResponseAnswer,
    ).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({
        nativeHumanToken: ctx.nativeHumanToken,
        nativePreviousQueries: [key],
      }),
    );
  });
});

describe('original recommended answer follow-up preserves native task ownership', () => {
  const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const config: any = {
    bindingId: randomUUID(),
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    projectId: 7,
    nativeInstanceRef: 'fixture-instance',
    nativeScopeRef: '7',
  };
  const mdl = { models: [] };
  const hash = 'b'.repeat(40);
  let responses: any[];
  let ctx: any;
  let service: any;
  beforeEach(async () => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
    responses = [];
    const projectService = {
      getCurrentProject: jest.fn(async () => ({ id: 7, language: 'EN' })),
    };
    service = Object.create(AskingService.prototype);
    Object.assign(service, {
      projectService,
      threadRepository: {
        transaction: jest.fn(async () => ({})),
        commit: jest.fn(),
        rollback: jest.fn(),
        createOne: jest.fn(async (row) => ({ ...row, id: 11 })),
        findOneBy: jest.fn(async ({ id, projectId }) =>
          id === 11 && projectId === 7 ? { id, projectId } : undefined,
        ),
      },
      threadResponseRepository: {
        createOne: jest.fn(async (row) => {
          const saved = { ...row, id: responses.length + 1 };
          responses.push(saved);
          return saved;
        }),
        getResponsesWithThread: jest.fn(async () => responses),
      },
      askingTaskTracker: {
        createAskingTask: jest.fn(async () => ({
          queryId: 'next-native-task',
        })),
      },
    });
    ctx = {
      projectService,
      askingService: service,
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'fixture-original-human',
      deployRepository: {
        findLastProjectDeployLog: jest.fn(async () => ({
          status: 'SUCCESS',
          hash,
        })),
      },
      askingTaskRepository: { findOneBy: jest.fn(async () => undefined) },
      telemetry: { sendEvent: jest.fn() },
    };
    (loadQueryDelivery as jest.Mock).mockResolvedValue(config);
    (bindingServiceCall as jest.Mock).mockResolvedValue({
      scope: {
        ...config,
        generation: 1,
        permission: 'discover',
        checkedRevision: 'fixture-revision',
      },
    });
    jest.spyOn(ModelResolver.prototype, 'getMDL').mockResolvedValue(mdl as any);
    // Consume the actual original recommendation/manual SQL save path, not a
    // prebuilt empty history. Native repositories are in-memory test doubles.
    await new AskingResolver().createThread(
      null,
      {
        data: {
          question: 'Original recommendation',
          sql: 'SELECT id FROM orders',
        },
      },
      ctx,
    );
  });
  afterEach(() => {
    if (original === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  const follow = () =>
    new AskingResolver().createAskingTask(
      null,
      { data: { question: 'Follow up', threadId: 11 } },
      ctx,
    );
  test.each([null, undefined])(
    'saved answer with %s native task keeps original SQL history',
    async (reference) => {
      expect(responses[0].askingTaskId).toBeUndefined();
      responses[0].askingTaskId = reference;
      await expect(follow()).resolves.toEqual({ id: 'next-native-task' });
      expect(ctx.askingTaskRepository.findOneBy).not.toHaveBeenCalled();
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 7,
          histories: [responses[0]],
          nativeScope: expect.objectContaining({
            bindingId: config.bindingId,
            identityScope: ctx.nativeIdentityScope,
          }),
          nativeHumanToken: ctx.nativeHumanToken,
          authorizeNative: expect.any(Function),
        }),
      );
      expect(bindingServiceCall).toHaveBeenCalledWith(
        config,
        'human-action',
        {
          bindingId: config.bindingId,
          authorizeScope: { permission: 'discover' },
        },
        ctx.nativeHumanToken,
      );
    },
  );
  test.each([0, -1, '1', 1.5, 9])(
    'invalid or missing referenced task %s never enters the original AI dispatch',
    async (reference) => {
      responses[0].askingTaskId = reference;
      await expect(follow()).rejects.toMatchObject({
        message: 'QUERY_EVIDENCE_UNAVAILABLE',
      });
      expect(service.askingTaskTracker.createAskingTask).not.toHaveBeenCalled();
    },
  );
  test.each(['a', 'd'])(
    'mixed recommendation and native task retains exact HUMAN %s ownership',
    async (identity) => {
      const task = {
        id: 21,
        queryId: randomUUID(),
        projectId: 7,
        question: 'Tracked',
        detail: {
          nativeScope: {
            bindingId: config.bindingId,
            generation: 1,
            identityScope: identity.repeat(64),
            metadataReference: { hash, digest: digest(mdl) },
          },
        },
      };
      responses.push({
        id: 2,
        threadId: 11,
        askingTaskId: task.id,
        question: task.question,
        sql: 'SELECT id FROM orders',
      });
      ctx.askingTaskRepository.findOneBy.mockResolvedValue(task);
      if (identity === 'a') {
        await expect(follow()).resolves.toEqual({ id: 'next-native-task' });
        expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
          expect.objectContaining({ histories: responses }),
        );
      } else {
        await expect(follow()).rejects.toMatchObject({ status: 403 });
        expect(
          service.askingTaskTracker.createAskingTask,
        ).not.toHaveBeenCalled();
      }
    },
  );
  test('changed current project cannot turn the original recommendation into foreign history', async () => {
    ctx.projectService.getCurrentProject.mockResolvedValue({
      id: 8,
      language: 'EN',
    });
    await expect(follow()).rejects.toMatchObject({ status: 403 });
    expect(service.askingTaskTracker.createAskingTask).not.toHaveBeenCalled();
  });
});

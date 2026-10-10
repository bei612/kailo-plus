import knex, { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { AskingTaskRepository } from './apollo/server/repositories/askingTaskRepository';
import { AskResultStatus, AskResultType } from './apollo/server/models/adaptor';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { components } from './common';
import { ApiType } from './apollo/server/repositories/apiHistoryRepository';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from './apollo/server/services/nativeHumanQuery';
import {
  bindingServiceCall,
  loadQueryDelivery,
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
    expect(
      await repository.registerNativeQuery(queryId, 8, scope, key),
    ).toBeNull();
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
      action: 'data_query.query@v1',
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
});

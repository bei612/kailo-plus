import { AdjustmentBackgroundTaskTracker } from './apollo/server/backgrounds/adjustmentBackgroundTracker';
import { AskFeedbackStatus } from './apollo/server/models/adaptor';
import { AskingService } from './apollo/server/services/askingService';
import { WrenAIAdaptor } from './apollo/server/adaptors/wrenAIAdaptor';
import axios from 'axios';

describe('original HUMAN adjustment provenance and dispatch', () => {
  let previous: string | undefined;
  let task: any;
  let response: any;
  let deps: any;
  let tracker: AdjustmentBackgroundTaskTracker;
  const scope = {
    bindingId: 'binding',
    identityScope: 'human',
    metadataReference: { hash: 'deploy', digest: 'mdl' },
  };
  const original = {
    id: 4,
    threadId: 6,
    question: 'question',
    sql: 'select value from model',
  };
  let input: any;

  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'delivered-query-config';
    jest.useFakeTimers();
    task = undefined;
    response = undefined;
    deps = {
      telemetry: { sendEvent: jest.fn() },
      wrenAIAdaptor: {
        createAskFeedback: jest.fn(async (data) => {
          expect(task.queryId).toBe(data.queryId);
          expect(task.detail.nativeScope).toEqual(scope);
          expect(response.askingTaskId).toBe(task.id);
          return { queryId: data.queryId };
        }),
        cancelAskFeedback: jest.fn(),
      },
      askingTaskRepository: {
        transaction: jest.fn(async () => ({})),
        commit: jest.fn(),
        rollback: jest.fn(),
        createOne: jest.fn(async (data) => (task = { ...data, id: 3 })),
        findOneBy: jest.fn(async () => task),
        findByQueryId: jest.fn(async (queryId) =>
          task?.queryId === queryId ? task : null,
        ),
        lockQuery: jest.fn(async (_id, queryId) =>
          task?.queryId === queryId ? task : null,
        ),
        updateQuery: jest.fn(async (_id, queryId, _project, data) => {
          if (task?.queryId !== queryId) return null;
          task = { ...task, ...data };
          return task;
        }),
      },
      threadResponseRepository: {
        createOne: jest.fn(async (data) => (response = { ...data, id: 5 })),
        findOneBy: jest.fn(async (where) =>
          where.id === original.id ? original : response,
        ),
        updateOne: jest.fn(
          async (_id, data) => (response = { ...response, ...data }),
        ),
      },
    };
    input = {
      ...original,
      originalThreadResponseId: original.id,
      projectId: 7,
      tables: ['model'],
      sqlGenerationReasoning: 'reason',
      configurations: { language: 'English' },
      nativeScope: scope,
      authorizeSource: jest.fn(async () => {}),
      authorizeNative: jest.fn(async (queryId) => {
        expect(task.queryId).toBe(queryId);
      }),
    };
    tracker = new AdjustmentBackgroundTaskTracker(deps);
  });
  afterEach(() => {
    tracker.stopPolling();
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });

  it('persists the original task and response before one fixed-ID AI create', async () => {
    const result = await tracker.createAdjustmentTask(input);
    expect(result.queryId).toBe(task.queryId);
    expect(input.authorizeNative).toHaveBeenCalledWith(result.queryId);
    expect(deps.askingTaskRepository.commit).toHaveBeenCalledTimes(1);
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
  });

  it('preserves the original independent adjustment without inventing HUMAN provenance', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete input.nativeScope;
    delete input.authorizeNative;
    delete input.authorizeSource;
    deps.wrenAIAdaptor.createAskFeedback.mockResolvedValue({
      queryId: 'native-original',
    });
    const result = await tracker.createAdjustmentTask(input);
    expect(result.queryId).toBe('native-original');
    expect(task.detail.nativeScope).toBeUndefined();
  });

  it.each(['nativeScope', 'authorizeNative', 'authorizeSource'])(
    'refuses bound create without %s before native dispatch',
    async (key) => {
      delete input[key];
      await expect(tracker.createAdjustmentTask(input)).rejects.toThrow();
      expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
      expect(deps.askingTaskRepository.createOne).not.toHaveBeenCalled();
    },
  );

  it('lost create acknowledgement retains the actual fixed task for observation', async () => {
    deps.wrenAIAdaptor.createAskFeedback.mockRejectedValue(
      new Error('connection closed'),
    );
    const result = await tracker.createAdjustmentTask(input);
    const observed = await tracker.getAdjustmentResult(result.queryId);
    expect(observed?.status).toBe(AskFeedbackStatus.UNDERSTANDING);
    expect(task.detail.nativeScope).toEqual(scope);
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
  });

  it('actual AI 404 observation leaves the persisted task unresolved and never repeats create', async () => {
    const result = await tracker.createAdjustmentTask(input);
    const adaptor = new WrenAIAdaptor({ wrenAIBaseEndpoint: 'native-fixture' });
    jest.spyOn(axios, 'get').mockRejectedValue({ response: { status: 404 } });
    deps.wrenAIAdaptor.getAskFeedbackResult =
      adaptor.getAskFeedbackResult.bind(adaptor);
    await (tracker as any).pollTasks();
    expect((await tracker.getAdjustmentResult(result.queryId))?.status).toBe(
      AskFeedbackStatus.UNDERSTANDING,
    );
    expect(task.detail.status).toBe(AskFeedbackStatus.UNDERSTANDING);
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
  });

  it('revoked source refuses before creating any native row', async () => {
    input.authorizeSource.mockRejectedValue(new Error('revoked'));
    await expect(tracker.createAdjustmentTask(input)).rejects.toThrow(
      'revoked',
    );
    expect(deps.askingTaskRepository.createOne).not.toHaveBeenCalled();
    expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
  });

  it('failed fresh task authorization after persistence never dispatches AI', async () => {
    input.authorizeNative.mockRejectedValue(new Error('revoked'));
    await expect(tracker.createAdjustmentTask(input)).rejects.toThrow(
      'revoked',
    );
    expect(task.queryId).toBeDefined();
    expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
    expect(task.detail.status).toBe(AskFeedbackStatus.FAILED);
    expect(task.detail.nativeScope).toEqual(scope);
    expect((await tracker.getAdjustmentResultById(task.id))?.status).toBe(
      AskFeedbackStatus.FAILED,
    );
    expect((tracker as any).trackedTasks.size).toBe(0);
  });

  it('source rejection after persistence records a known failure without a native POST', async () => {
    input.authorizeSource
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('revoked'));
    await expect(tracker.createAdjustmentTask(input)).rejects.toThrow(
      'revoked',
    );
    expect(task.detail.status).toBe(AskFeedbackStatus.FAILED);
    expect(task.detail.nativeScope).toEqual(scope);
    expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
  });

  it('failed admission cannot overwrite a concurrently replaced query ID', async () => {
    input.authorizeNative.mockImplementation(async () => {
      task = { ...task, queryId: 'newer-query' };
      throw new Error('revoked');
    });
    await expect(tracker.createAdjustmentTask(input)).rejects.toThrow(
      'Adjustment task changed during observation',
    );
    expect(task.queryId).toBe('newer-query');
    expect(task.detail.status).toBe(AskFeedbackStatus.UNDERSTANDING);
    expect(deps.askingTaskRepository.rollback).toHaveBeenCalled();
    expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
  });

  it('polling and actual terminal persistence retain the original HUMAN provenance', async () => {
    const result = await tracker.createAdjustmentTask(input);
    const tracked = {
      taskId: task.id,
      queryId: result.queryId,
      projectId: 7,
      threadResponseId: response.id,
    };
    await (tracker as any).updateTaskInDatabase(tracked, {
      status: AskFeedbackStatus.GENERATING,
    });
    expect(task.detail.nativeScope).toEqual(scope);
    await (tracker as any).updateThreadResponseWhenTaskFinalized(tracked, {
      status: AskFeedbackStatus.FINISHED,
      response: [{ sql: 'select completed from model' }],
    });
    expect(task.detail.nativeScope).toEqual(scope);
    expect(response.sql).toBe('select completed from model');
  });

  it('unknown or active create cannot be treated as a rerunnable failure', async () => {
    await tracker.createAdjustmentTask(input);
    await expect(
      tracker.rerunAdjustmentTask({ ...input, threadResponseId: response.id }),
    ).rejects.toThrow();
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
  });

  it('only the original HUMAN can rerun an actual stopped adjustment', async () => {
    await tracker.createAdjustmentTask(input);
    task.detail.status = AskFeedbackStatus.STOPPED;
    await expect(
      tracker.rerunAdjustmentTask({
        ...input,
        threadResponseId: response.id,
        nativeScope: { ...scope, identityScope: 'another-human' },
      }),
    ).rejects.toThrow();
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
    const prior = task.queryId;
    const result = await tracker.rerunAdjustmentTask({
      ...input,
      threadResponseId: response.id,
    });
    expect(result.queryId).not.toBe(prior);
    expect(task.detail.nativeScope).toEqual(scope);
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(2);
  });

  it('rerun refuses source SQL changed while the persisted replacement task is authorized', async () => {
    await tracker.createAdjustmentTask(input);
    task.detail.status = AskFeedbackStatus.STOPPED;
    input.authorizeNative.mockImplementation(async () => {
      deps.threadResponseRepository.findOneBy.mockImplementation(
        async (where) =>
          where.id === original.id
            ? { ...original, sql: 'select changed from model' }
            : response,
      );
    });
    await expect(
      tracker.rerunAdjustmentTask({ ...input, threadResponseId: response.id }),
    ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(deps.wrenAIAdaptor.createAskFeedback).toHaveBeenCalledTimes(1);
    expect(task.detail.status).toBe(AskFeedbackStatus.FAILED);
    expect(task.detail.error.message).toBe('QUERY_REFERENCE_CHANGED');
    expect(task.detail.nativeScope).toEqual(scope);
    expect((await tracker.getAdjustmentResultById(task.id))?.queryId).toBe(
      task.queryId,
    );
    expect((await tracker.getAdjustmentResultById(task.id))?.status).toBe(
      AskFeedbackStatus.FAILED,
    );
    expect((tracker as any).trackedTasks.size).toBe(0);
  });

  it('cancel rechecks authorization after resolving the actual project task', async () => {
    const service: any = Object.create(AskingService.prototype);
    service.currentTask = jest.fn(async () => task);
    service.adjustmentBackgroundTracker = tracker;
    task = { queryId: 'existing' };
    await expect(
      service.cancelAdjustThreadResponseAnswer('existing'),
    ).rejects.toThrow();
    await expect(
      service.cancelAdjustThreadResponseAnswer('existing', async () => {
        throw new Error('revoked');
      }),
    ).rejects.toThrow('revoked');
    expect(deps.wrenAIAdaptor.cancelAskFeedback).not.toHaveBeenCalled();
    await service.cancelAdjustThreadResponseAnswer('existing', async () => {});
    expect(deps.wrenAIAdaptor.cancelAskFeedback).toHaveBeenCalledWith(
      'existing',
    );
  });
  it('create refuses changed source SQL after source admission awaits', async () => {
    const service: any = Object.create(AskingService.prototype);
    const project = { id: 7 };
    service.projectService = { getCurrentProject: async () => project };
    let current = original;
    service.getResponse = jest.fn(async () => current);
    service.adjustmentBackgroundTracker = tracker;
    await expect(
      service.adjustThreadResponseAnswer(
        original.id,
        {
          projectId: project.id,
          tables: ['model'],
          sqlGenerationReasoning: 'reason',
        },
        {
          language: 'English',
          nativeScope: scope,
          authorizeNative: input.authorizeNative,
          authorizeSource: async () => {
            current = { ...original, sql: 'select changed from model' };
          },
        },
      ),
    ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(deps.wrenAIAdaptor.createAskFeedback).not.toHaveBeenCalled();
    expect(deps.askingTaskRepository.createOne).not.toHaveBeenCalled();
  });
});

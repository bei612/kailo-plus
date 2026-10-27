import knex, { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { AskingService } from './apollo/server/services/askingService';
import { AskingTaskTracker } from './apollo/server/services/askingTaskTracker';
import { AskingTaskRepository } from './apollo/server/repositories/askingTaskRepository';
import { lockNativeBinding } from './apollo/server/repositories/projectRepository';
import { AskResultStatus, AskResultType } from './apollo/server/models/adaptor';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { AdjustmentBackgroundTaskTracker } from './apollo/server/backgrounds/adjustmentBackgroundTracker';
import { ProjectResolver } from './apollo/server/resolvers/projectResolver';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import {
  bindingServiceCall,
  loadQueryDelivery,
  digest,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { components } from './common';
import planningStreamHandler from './pages/api/ask_task/streaming';
import explanationStreamHandler from './pages/api/v1/stream_explanation';
import {
  ApiHistoryRepository,
  ApiType,
} from './apollo/server/repositories/apiHistoryRepository';
import generateSqlHandler from './pages/api/v1/generate_sql';
import streamGenerateSqlHandler from './pages/api/v1/stream/generate_sql';
import {
  encodeKailoUser,
  KAILO_USER_HEADER,
  KAILO_SERVICE_HEADER,
} from './utils/kailoUser';
import { nativePreviewScope } from './apollo/server/services/nativeHumanQuery';
import { Readable } from 'stream';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';

jest.mock('./common', () => ({
  components: { apiHistoryRepository: { createOne: jest.fn() } },
}));

// apiUtils captures the original repository at module initialization. Forward
// its existing writer to the real test database without changing the product.
const originalHistoryWriter = components.apiHistoryRepository;

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));

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
  it('bound cancellation consumes fresh admission after reading the original task', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const authorizeNative = jest.fn(async () => {
      expect(service.askingTaskRepository.findOneBy).toHaveBeenCalled();
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    });
    try {
      await expect(service.cancelAskingTask('owned')).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        service.cancelAskingTask('owned', authorizeNative),
      ).rejects.toMatchObject({ status: 403 });
      expect(authorizeNative).toHaveBeenCalledTimes(1);
      expect(service.askingTaskTracker.cancelAskingTask).not.toHaveBeenCalled();
      await service.cancelAskingTask('owned', async () => undefined);
      expect(service.askingTaskTracker.cancelAskingTask).toHaveBeenCalledWith(
        'owned',
      );
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it('the original cancellation resolver supplies admission to the actual service consumer', async () => {
    const resolver: any = new AskingResolver();
    const authorize = jest
      .spyOn(resolver, 'authorizeNativeAskingTask')
      .mockResolvedValue(undefined);
    const ctx: any = { askingService: service };
    await expect(
      resolver.cancelAskingTask(null, { taskId: 'owned' }, ctx),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenLastCalledWith('owned', ctx);
    expect(service.askingTaskTracker.cancelAskingTask).toHaveBeenCalledWith(
      'owned',
    );
  });
  it.each([false, true])(
    'resumes original observation before refusing reset (adjustment=%s)',
    async (isAdjustment) => {
      service.askingTaskRepository.findUnsettled = jest.fn(async () => ({
        id: 9,
        projectId: 7,
        queryId: 'pending',
        detail: { adjustment: isAdjustment },
      }));
      await expect(service.assertProjectTasksSettled(7)).rejects.toThrow(
        'task 9',
      );
      expect(service.askingTaskRepository.findUnsettled).toHaveBeenCalledWith(
        7,
      );
      expect(
        isAdjustment
          ? service.adjustmentBackgroundTracker.getAdjustmentResult
          : service.askingTaskTracker.getAskingResult,
      ).toHaveBeenCalledWith('pending');
      expect(service.askingTaskTracker.cancelAskingTask).not.toHaveBeenCalled();
      expect(
        service.adjustmentBackgroundTracker.cancelAdjustmentTask,
      ).not.toHaveBeenCalled();
    },
  );
  it('allows reset only after native observation has settled', async () => {
    service.askingTaskRepository.findUnsettled = jest.fn(async () => null);
    await expect(service.assertProjectTasksSettled(7)).resolves.toBeUndefined();
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
    const config = {
      projectId: 7,
      bindingId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: 'owned-instance',
      nativeScopeRef: '7',
    };
    jest.mocked(loadQueryDelivery).mockResolvedValue(config as any);
    jest.mocked(bindingServiceCall).mockResolvedValue({
      resource: {
        resourceId: randomUUID(),
        resourceVersion: 1,
        nativeType: 'view',
        nativeRef: '88',
        nativeInstanceRef: config.nativeInstanceRef,
        nativeScopeRef: config.nativeScopeRef,
      },
    });
    const view = new AskingResolver().getThreadResponseNestedResolver().view;
    const ctx: any = {
      nativeHumanToken: 'verified-native-human',
      nativeIdentityScope: 'a'.repeat(64),
      projectService: service.projectService,
      askingService: {
        getResponse: jest.fn(async () => ({ id: 21, viewId: 88 })),
      },
      viewRepository: { findOneBy: jest.fn(async () => null) },
    };
    // GOVERNED deployment (DD-127(7)): the delivery, not the token, selects it.
    const deployed = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
    try {
      await expect(
        view({ id: 21, viewId: 88 } as any, {}, ctx),
      ).rejects.toThrow('View not found');
    } finally {
      if (deployed === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = deployed;
    }
    expect(ctx.viewRepository.findOneBy).toHaveBeenCalledWith({
      id: 88,
      projectId: 7,
    });
  });
});

describe('original native planning HTTP stream and HUMAN task owner', () => {
  let server: Server, endpoint: string, task: any, ctx: any, revoked: boolean;
  let history: any, generation: number;
  let nativeStream: jest.Mock;
  const queryId = randomUUID();
  const originalDelivery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const originalBinding = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  const originalComponents = { ...components };
  const project = { id: 7, language: 'EN' };
  const config = {
    projectId: 7,
    bindingId: randomUUID(),
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    nativeInstanceRef: 'original-fixture',
    nativeScopeRef: '7',
    responseMaxBytes: 4096,
  };
  const deployment = {
    id: 12,
    projectId: 7,
    hash: 'b'.repeat(40),
    status: 'SUCCESS',
    manifest: {
      catalog: 'wren',
      schema: 'public',
      models: [{ name: 'original_model', columns: [] }],
    },
    nativeObjectRefs: [
      { nativeType: 'model', nativeId: 8, nativeName: 'original_model' },
    ],
  };
  const proof = {
    bindingId: config.bindingId,
    identityScope: 'a'.repeat(64),
    metadataReference: {
      hash: deployment.hash,
      digest: digest({
        hash: deployment.hash,
        mdl: Buffer.from(JSON.stringify(deployment.manifest)).toString(
          'base64',
        ),
      }),
    },
  };
  const headers = {
    'x-kailo-native-human-token': 'verified-original-human',
    'x-kailo-native-identity-scope': proof.identityScope,
  };
  const send = (changes = {}, method = 'GET') =>
    fetch(endpoint, { method, headers: { ...headers, ...changes } });
  const explanation = (changes = {}, method = 'GET') =>
    fetch(
      endpoint.replace('/api/ask_task/streaming', '/api/v1/stream_explanation'),
      {
        method,
        headers: { ...headers, ...changes },
      },
    );
  beforeAll(async () => {
    server = createServer(
      (request, response) =>
        void apiResolver(
          request,
          response,
          {
            queryId: new URL(
              request.url,
              'http://fixture.invalid',
            ).searchParams.get('queryId'),
          },
          {
            default: request.url.startsWith('/api/v1/stream_explanation')
              ? explanationStreamHandler
              : planningStreamHandler,
          },
          {
            previewModeId: '',
            previewModeEncryptionKey: '',
            previewModeSigningKey: '',
          },
          false,
        ),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ask_task/streaming?queryId=${queryId}`;
  });
  beforeEach(() => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
    process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = '/fixture/binding.json';
    jest.mocked(loadQueryDelivery).mockResolvedValue(config as any);
    revoked = false;
    generation = 2;
    task = {
      id: 1,
      projectId: project.id,
      queryId,
      question: 'Original',
      detail: {
        status: AskResultStatus.PLANNING,
        nativeScope: structuredClone(proof),
      },
    };
    const projectService = { getCurrentProject: jest.fn(async () => project) };
    const repository = {
      findOneBy: jest.fn(async (where) =>
        Object.entries(where).every(([name, value]) => task[name] === value)
          ? structuredClone(task)
          : null,
      ),
    };
    const service = Object.assign(Object.create(AskingService.prototype), {
      projectService,
      askingTaskRepository: repository,
      askingTaskTracker: {
        getAskingResult: jest.fn(async () => ({
          queryId,
          projectId: project.id,
          status: AskResultStatus.PLANNING,
        })),
      },
    });
    nativeStream = jest.fn(async () =>
      Readable.from([
        'data: {"message":"原生思考"}\n\n',
        `data: ${JSON.stringify({ done: true, queryId })}\n\n`,
      ]),
    );
    history = {
      id: queryId,
      apiType: ApiType.GENERATE_SQL,
      projectId: project.id,
      governanceBindingId: config.bindingId,
      threadId: queryId,
      statusCode: 400,
      requestPayload: {
        question: 'Original non-SQL question',
        nativeAsk: {
          taskId: queryId,
          identityScope: proof.identityScope,
          histories: [],
          metadataReference: {
            ...proof.metadataReference,
            queryScope: nativePreviewScope(config as any, proof.identityScope),
            generation,
          },
        },
      },
      responsePayload: {
        threadId: queryId,
        code: 'NON_SQL_QUERY',
        error: 'Original non-SQL explanation',
        explanationQueryId: queryId,
        nativeAsk: {
          askResult: {
            status: AskResultStatus.FINISHED,
            type: AskResultType.GENERAL,
            intentReasoning: 'Original non-SQL explanation',
          },
        },
      },
    };
    Object.assign(components, {
      projectService,
      askingTaskRepository: repository,
      askingService: service,
      deployLogRepository: {
        findOneBy: jest.fn(async () => structuredClone(deployment)),
        findLastProjectDeployLog: jest.fn(async () =>
          structuredClone(deployment),
        ),
      },
      wrenAIAdaptor: { getAskStreamingResult: nativeStream },
      telemetry: { sendEvent: jest.fn() },
      apiHistoryRepository: {
        findOneBy: jest.fn(async (where) =>
          Object.entries(where).every(
            ([name, value]) => history?.[name] === value,
          )
            ? structuredClone(history)
            : null,
        ),
        createOne: jest.fn(),
        updateOne: jest.fn(),
      },
    });
    ctx = {
      ...components,
      deployRepository: components.deployLogRepository,
      nativeHumanToken: headers['x-kailo-native-human-token'],
      nativeIdentityScope: proof.identityScope,
    };
    // A Resource/version must remain the same across the original before/after
    // metadata checks, not be a new fixture identity on each read.
    const resourceId = randomUUID();
    jest
      .mocked(bindingServiceCall)
      .mockImplementation(async (_config, _operation, input) => {
        if (revoked) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        if (input.authorizeScope) {
          expect(input.authorizeScope).toEqual({ permission: 'discover' });
          return {
            scope: {
              bindingId: config.bindingId,
              tenantId: config.tenantId,
              workspaceId: config.workspaceId,
              nativeInstanceRef: config.nativeInstanceRef,
              nativeScopeRef: config.nativeScopeRef,
              generation,
              permission: 'discover',
              checkedRevision: 'original-fresh-revision',
            },
          };
        }
        const source = input.resolveResource as any;
        return {
          resource: {
            resourceId,
            resourceVersion: 1,
            nativeType: source.nativeType,
            nativeRef: source.nativeRef,
            nativeInstanceRef: config.nativeInstanceRef,
            nativeScopeRef: config.nativeScopeRef,
          },
        };
      });
  });
  afterAll(async () => {
    if (originalDelivery === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalDelivery;
    if (originalBinding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = originalBinding;
    Object.keys(components).forEach((key) => delete components[key]);
    Object.assign(components, originalComponents);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  });
  it('keeps the original message/done stream after real native task ownership and fresh captured MDL authorization', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      'data: {"message":"原生思考"}\n\ndata: {"done":true}\n\n',
    );
    expect(nativeStream).toHaveBeenCalledWith(queryId);
    expect(
      jest.mocked(bindingServiceCall).mock.calls.length,
    ).toBeGreaterThanOrEqual(6);
  });
  const standalone = () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    jest.mocked(loadQueryDelivery).mockClear();
    jest.mocked(bindingServiceCall).mockClear();
  };
  it('standalone Ask consumes the native query-bound completion in the original browser wire shape without loading platform delivery', async () => {
    standalone();
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      'data: {"message":"原生思考"}\n\ndata: {"done":true}\n\n',
    );
    expect(nativeStream).toHaveBeenCalledTimes(1);
    expect(nativeStream).toHaveBeenCalledWith(queryId);
    expect(loadQueryDelivery).not.toHaveBeenCalled();
    expect(bindingServiceCall).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    [],
    { done: true, queryId: 'foreign' },
    { done: true, queryId, message: 'not a completion' },
    { done: 'true', queryId },
    { done: true },
  ])(
    'standalone Ask keeps interrupted or invalid completion %j unresolved and never reopens the native task',
    async (completion) => {
      standalone();
      nativeStream.mockResolvedValue(
        Readable.from([
          'data: {"message":"partial"}\n\n',
          ...(completion === undefined
            ? []
            : [`data: ${JSON.stringify(completion)}\n\n`]),
        ]),
      );
      const response = await send();
      expect(await response.text()).toBe('data: {"message":"partial"}\n\n');
      expect(nativeStream).toHaveBeenCalledTimes(1);
      expect(loadQueryDelivery).not.toHaveBeenCalled();
    },
  );
  it('standalone Ask refuses another project task before consuming its native queue', async () => {
    standalone();
    task.projectId++;
    expect((await send()).status).toBe(404);
    expect(nativeStream).not.toHaveBeenCalled();
  });
  it('standalone mode is rechecked after the original task lookup before consuming its one-shot queue', async () => {
    standalone();
    const read = jest
      .spyOn(components.askingService, 'getAskingTask')
      .mockImplementation(async () => {
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = '/fixture/binding.json';
        return { queryId } as any;
      });
    try {
      expect((await send()).status).toBe(412);
      expect(nativeStream).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
  it('standalone observation stops if governed delivery appears while the native request is in flight', async () => {
    standalone();
    nativeStream.mockImplementation(async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
      return Readable.from([
        'data: {"message":"no longer independently authorized"}\n\n',
        `data: ${JSON.stringify({ done: true, queryId })}\n\n`,
      ]);
    });
    expect(await (await send()).text()).toBe('');
    expect(nativeStream).toHaveBeenCalledTimes(1);
    expect(loadQueryDelivery).not.toHaveBeenCalled();
  });
  it.each(['before-chunk', 'during-authorization'])(
    'governed stream refuses mode retirement %s instead of exposing its original task as standalone',
    async (when) => {
      if (when === 'before-chunk') {
        nativeStream.mockImplementation(async () => {
          standalone();
          return Readable.from([
            'data: {"message":"private governed reasoning"}\n\n',
            `data: ${JSON.stringify({ done: true, queryId })}\n\n`,
          ]);
        });
      } else {
        jest
          .mocked(components.askingTaskRepository.findOneBy)
          .mockImplementation(async (where) => {
            // The resolver's second original task read follows its actual
            // captured-MDL/source checks. Retire only after the native GET.
            if (nativeStream.mock.calls.length && 'id' in where) standalone();
            return structuredClone(task);
          });
      }
      expect(await (await send()).text()).toBe('');
      expect(nativeStream).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['POST', 'DELETE'])(
    'standalone stream rejects %s without a native read',
    async (method) => {
      standalone();
      expect((await send({}, method)).status).toBe(405);
      expect(nativeStream).not.toHaveBeenCalled();
    },
  );
  it.each([
    'foreign-user',
    'foreign-binding',
    'legacy-owner',
    'foreign-project',
  ])('rejects original %s before reading the native stream', async (mode) => {
    if (mode === 'foreign-user')
      task.detail.nativeScope.identityScope = 'b'.repeat(64);
    if (mode === 'foreign-binding')
      task.detail.nativeScope.bindingId = randomUUID();
    if (mode === 'legacy-owner') delete task.detail.nativeScope;
    if (mode === 'foreign-project') task.projectId++;
    expect((await send()).status).toBe(403);
    expect(nativeStream).not.toHaveBeenCalled();
  });
  it('current Resource revocation blocks the original planning stream before any native read', async () => {
    revoked = true;
    expect((await send()).status).toBe(403);
    expect(nativeStream).not.toHaveBeenCalled();
  });
  it('applies the original delivered response byte budget before exposing a planning chunk', async () => {
    nativeStream.mockResolvedValue(
      Readable.from([
        `data: ${JSON.stringify({ message: 'a'.repeat(config.responseMaxBytes) })}\n\n`,
      ]),
    );
    const response = await send();
    expect(await response.text()).toBe('');
  });
  it.each(['EOF', 'foreign-done'])(
    'original planning %s never manufactures done',
    async (mode) => {
      nativeStream.mockResolvedValue(
        Readable.from([
          'data: {"message":"partial"}\n\n',
          ...(mode === 'foreign-done'
            ? ['data: {"done":true,"queryId":"foreign"}\n\n']
            : []),
        ]),
      );
      const response = await send();
      expect(await response.text()).toBe('data: {"message":"partial"}\n\n');
    },
  );
  it('rechecks current HUMAN and Resource permission at each actual chunk, not just the initial token', async () => {
    nativeStream.mockResolvedValue(
      Readable.from(
        (async function* () {
          yield 'data: {"message":"visible"}\n\n';
          revoked = true;
          yield 'data: {"message":"private"}\n\n';
        })(),
      ),
    );
    const response = await send();
    expect(await response.text()).not.toContain('private');
  });
  it('the original GraphQL create consumer passes captured HUMAN/MDL proof and a real pre-POST reauthorization consumer', async () => {
    ctx.askingService = {
      createAskingTask: jest.fn(async () => ({ id: queryId })),
    };
    const result = await new AskingResolver().createAskingTask(
      null,
      { data: { question: 'Original' } },
      ctx,
    );
    expect(result.id).toBe(queryId);
    const payload = ctx.askingService.createAskingTask.mock.calls[0][1];
    expect(payload.nativeScope).toEqual({ ...proof, generation });
    await expect(payload.authorizeNative(queryId)).resolves.toMatchObject({
      queryId,
    });
    task.detail.nativeScope.identityScope = 'b'.repeat(64);
    await expect(payload.authorizeNative(queryId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('governed REST explanation cannot turn into an independent stream when its delivery retires', async () => {
    nativeStream.mockImplementation(async () => {
      standalone();
      return Readable.from([
        'data: {"message":"private governed explanation"}\n\n',
        `data: ${JSON.stringify({ done: true, queryId })}\n\n`,
      ]);
    });
    expect(await (await explanation()).text()).toBe('');
    expect(nativeStream).toHaveBeenCalledTimes(1);
  });
  it('governed REST explanation rechecks mode after its last real metadata authorization', async () => {
    const originalRead = ModelResolver.prototype.getMDL;
    let afterOpen = 0;
    const read = jest
      .spyOn(ModelResolver.prototype, 'getMDL')
      .mockImplementation(async function (...args) {
        const result = await originalRead.apply(this, args);
        // readNativeAskHistory performs two real metadata authorizations. This
        // retires the mode after its final reader, before the caller resumes.
        if (nativeStream.mock.calls.length && ++afterOpen === 2) standalone();
        return result;
      });
    try {
      expect(await (await explanation()).text()).toBe('');
      expect(afterOpen).toBe(2);
      expect(nativeStream).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  });
  it.each([ApiType.GENERATE_SQL, ApiType.STREAM_GENERATE_SQL])(
    'keeps the original %s explanationQueryId stream through its persisted GENERAL history, not a fabricated GraphQL task',
    async (apiType) => {
      history.apiType = apiType;
      task = { ...task, queryId: 'a different GraphQL asking task' };
      const response = await explanation();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        'data: {"message":"原生思考"}\n\ndata: {"done":true}\n\n',
      );
      expect(nativeStream).toHaveBeenCalledTimes(1);
      expect(nativeStream).toHaveBeenCalledWith(queryId);
      expect(components.apiHistoryRepository.findOneBy).toHaveBeenCalledWith({
        id: queryId,
        projectId: project.id,
        governanceBindingId: config.bindingId,
      });
      expect(components.apiHistoryRepository.createOne).not.toHaveBeenCalled();
      expect(components.apiHistoryRepository.updateOne).not.toHaveBeenCalled();
      expect(bindingServiceCall).toHaveBeenCalledWith(
        config,
        'human-action',
        {
          bindingId: config.bindingId,
          authorizeScope: { permission: 'discover' },
        },
        headers['x-kailo-native-human-token'],
      );
    },
  );
  it.each([
    'foreign-user',
    'foreign-binding',
    'foreign-project',
    'legacy-owner',
    'generation-changed',
    'resource-revoked',
    'unconfirmed-task',
    'foreign-task',
    'foreign-api-type',
    'unknown-status',
    'contradictory-error',
  ])(
    'does not disclose the original REST explanation with %s',
    async (mode) => {
      if (mode === 'foreign-user')
        history.requestPayload.nativeAsk.identityScope = 'b'.repeat(64);
      if (mode === 'foreign-binding')
        history.governanceBindingId = randomUUID();
      if (mode === 'foreign-project') history.projectId++;
      if (mode === 'legacy-owner') delete history.requestPayload.nativeAsk;
      if (mode === 'generation-changed') generation++;
      if (mode === 'resource-revoked') revoked = true;
      if (mode === 'unconfirmed-task') history.statusCode = 202;
      if (mode === 'foreign-task')
        history.requestPayload.nativeAsk.taskId = randomUUID();
      if (mode === 'foreign-api-type') history.apiType = ApiType.RUN_SQL;
      if (mode === 'unknown-status')
        history.responsePayload.nativeAsk.askResult.status = 'future';
      if (mode === 'contradictory-error')
        history.responsePayload.nativeAsk.askResult.error = {
          code: 'provider-error',
        };
      const before = structuredClone(history);
      expect((await explanation()).status).toBeGreaterThanOrEqual(400);
      expect(nativeStream).not.toHaveBeenCalled();
      expect(history).toEqual(before);
      expect(components.apiHistoryRepository.createOne).not.toHaveBeenCalled();
      expect(components.apiHistoryRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(['EOF', 'foreign-done', 'unknown-event'])(
    'original REST explanation %s remains incomplete without re-dispatch or a manufactured done',
    async (mode) => {
      nativeStream.mockResolvedValue(
        Readable.from([
          'data: {"message":"partial"}\n\n',
          ...(mode === 'foreign-done'
            ? ['data: {"done":true,"queryId":"foreign"}\n\n']
            : []),
          ...(mode === 'unknown-event'
            ? ['data: {"status":"future"}\n\n']
            : []),
        ]),
      );
      const response = await explanation();
      expect(await response.text()).toBe('data: {"message":"partial"}\n\n');
      expect(nativeStream).toHaveBeenCalledTimes(1);
      expect(components.apiHistoryRepository.createOne).not.toHaveBeenCalled();
    },
  );
  it.each(['resource', 'generation', 'history-row'])(
    'stops the original REST explanation when %s changes before its next actual frame',
    async (mode) => {
      nativeStream.mockResolvedValue(
        Readable.from(
          (async function* () {
            yield 'data: {"message":"visible"}\n\n';
            if (mode === 'resource') revoked = true;
            if (mode === 'generation') generation++;
            if (mode === 'history-row')
              history.requestPayload.nativeAsk.taskId = randomUUID();
            yield 'data: {"message":"private"}\n\n';
          })(),
        ),
      );
      const response = await explanation();
      const body = await response.text();
      expect(body).not.toContain('private');
      expect(body).not.toContain('"done":true');
      expect(nativeStream).toHaveBeenCalledTimes(1);
      expect(components.apiHistoryRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(['query-only', 'binding-only', 'empty-query', 'empty-binding'])(
    'both original planning routes refuse %s configuration before a native read',
    async (mode) => {
      if (mode === 'query-only')
        delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
      if (mode === 'binding-only')
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      if (mode === 'empty-query')
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
      if (mode === 'empty-binding')
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = '';
      expect((await send()).status).toBe(503);
      expect((await explanation()).status).toBe(503);
      expect(nativeStream).not.toHaveBeenCalled();
    },
  );
});

describe('original standalone REST explanation HTTP and history consumers', () => {
  let database: Knex, repository: ApiHistoryRepository, server: Server;
  let origin: string, queryId: string, projectId: number, member: boolean;
  let ask: jest.Mock, stream: jest.Mock;
  const postgres = process.env.WREN_TEST_POSTGRES_URL;
  const schema = `rest_explanation_${randomUUID().replace(/-/g, '')}`;
  const savedComponents = { ...components };
  const savedQuery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const savedBinding = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  const user = {
    key: 'a'.repeat(64),
    name: 'Original member',
    username: null,
    email: null,
    picture: null,
    locale: null,
    admin: false,
  };
  const userHeaders = { [KAILO_USER_HEADER]: encodeKailoUser(user) };
  const serviceHeaders = { [KAILO_SERVICE_HEADER]: '1' };
  const read = (
    headers: Record<string, string> = userHeaders,
    method = 'GET',
  ) =>
    fetch(`${origin}/api/v1/stream_explanation?queryId=${queryId}`, {
      method,
      headers,
    });
  const create = async (
    streaming = false,
    headers: Record<string, string> = userHeaders,
  ) => {
    const response = await fetch(
      `${origin}/api/v1/${streaming ? 'stream/' : ''}generate_sql`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          question: 'What can this original project answer?',
        }),
      },
    );
    expect(response.status).toBe(streaming ? 200 : 400);
    expect(await response.text()).toContain(queryId);
    const rows = await repository.findAllBy({ projectId: 7 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(queryId);
    expect(rows[0]).toMatchObject({
      apiType: streaming ? ApiType.STREAM_GENERATE_SQL : ApiType.GENERATE_SQL,
      statusCode: 400,
      responsePayload: { code: 'NON_SQL_QUERY', explanationQueryId: queryId },
    });
    return rows[0];
  };
  beforeAll(async () => {
    database = knex(
      postgres
        ? { client: 'pg', connection: postgres, searchPath: [schema] }
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
      '20250102074256_create_sql_pair_table.js',
      '20250311046282_create_instruction_table.js',
      '20250511000000-create-api-history.js',
      '20261005000000_api_history_governed_query.js',
      '20261021000000_kailo_user_ownership.js',
    ])
      await jest
        .requireActual(join(process.cwd(), 'migrations', name))
        .up(database);
    await database('project').insert(
      [7, 8].map((id) => ({
        id,
        type: 'DUCKDB',
        display_name: `project-${id}`,
        catalog: 'wren',
        schema: 'public',
      })),
    );
    repository = new ApiHistoryRepository(database);
    server = createServer((request, response) => {
      const url = new URL(request.url, 'http://fixture.invalid');
      const handler =
        url.pathname === '/api/v1/generate_sql'
          ? generateSqlHandler
          : url.pathname === '/api/v1/stream/generate_sql'
            ? streamGenerateSqlHandler
            : explanationStreamHandler;
      void apiResolver(
        request,
        response,
        { queryId: url.searchParams.get('queryId') },
        { default: handler },
        {
          previewModeId: '',
          previewModeEncryptionKey: '',
          previewModeSigningKey: '',
        },
        false,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    await database('api_history').del();
    queryId = randomUUID();
    projectId = 7;
    member = true;
    jest.mocked(loadQueryDelivery).mockClear();
    jest.mocked(bindingServiceCall).mockClear();
    ask = jest.fn(async () => ({ queryId }));
    stream = jest.fn(async () =>
      Readable.from([
        'data: {"message":"Original REST explanation"}\n\n',
        `data: ${JSON.stringify({ done: true, queryId })}\n\n`,
      ]),
    );
    jest
      .mocked(originalHistoryWriter.createOne)
      .mockImplementation((input) => repository.createOne(input));
    Object.assign(components, {
      apiHistoryRepository: repository,
      projectService: {
        getCurrentProject: jest.fn(async () => ({
          id: projectId,
          language: 'EN',
        })),
      },
      deployService: {
        getLastDeployment: jest.fn(async () => ({
          hash: 'b'.repeat(40),
          manifest: {},
        })),
      },
      wrenAIAdaptor: {
        ask,
        getAskResult: jest.fn(async () => ({
          status: AskResultStatus.FINISHED,
          type: AskResultType.GENERAL,
          intentReasoning: 'Original non-SQL explanation',
        })),
        getAskStreamingResult: stream,
      },
      askingTaskRepository: {
        findOneBy: jest.fn(() => {
          throw new Error('REST history is not an AskingTask');
        }),
      },
      kailoMemberDirectory: {
        access: jest.fn(async () => ({
          delivered: true,
          member,
          admin: false,
        })),
      },
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (savedQuery === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = savedQuery;
    if (savedBinding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = savedBinding;
    Object.keys(components).forEach((key) => delete components[key]);
    Object.assign(components, savedComponents);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    if (postgres) await database.schema.dropSchema(schema, true);
    await database.destroy();
  });
  it.each([false, true])(
    'follows original generate_sql streaming=%s through its real original history to the public explanation wire',
    async (streaming) => {
      const row = await create(streaming);
      expect(row.ownerKey).toBe(user.key);
      const response = await read();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        'data: {"message":"Original REST explanation"}\n\ndata: {"done":true}\n\n',
      );
      expect(ask).toHaveBeenCalledTimes(1);
      expect(stream).toHaveBeenCalledTimes(1);
      expect(loadQueryDelivery).not.toHaveBeenCalled();
      expect(bindingServiceCall).not.toHaveBeenCalled();
      expect(components.askingTaskRepository.findOneBy).not.toHaveBeenCalled();
    },
  );
  it('preserves native project shared reading without inventing a HUMAN owner for a verified service', async () => {
    const row = await create(true, serviceHeaders);
    expect(row.ownerKey).toBeNull();
    expect(await (await read(serviceHeaders)).text()).toContain('"done":true');
    expect(components.kailoMemberDirectory.access).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('keeps the original shared project ACL rather than turning the display owner into a new read ACL', async () => {
    await create();
    expect(
      await (
        await read({
          [KAILO_USER_HEADER]: encodeKailoUser({
            ...user,
            key: 'c'.repeat(64),
          }),
        })
      ).text(),
    ).toContain('"done":true');
  });
  it.each(['EOF', 'foreign-done'])(
    'leaves %s unresolved without another Ask or one-shot read',
    async (failure) => {
      await create();
      stream.mockResolvedValue(
        Readable.from([
          'data: {"message":"partial"}\n\n',
          ...(failure === 'EOF'
            ? []
            : ['data: {"done":true,"queryId":"foreign"}\n\n']),
        ]),
      );
      expect(await (await read()).text()).toBe(
        'data: {"message":"partial"}\n\n',
      );
      expect(stream).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'missing',
    'row-id',
    'other-project',
    'other-query',
    'governed',
    'not-general',
    'duplicate',
  ])(
    'refuses %s original history before consuming native output',
    async (mutation) => {
      const row = await create();
      if (mutation === 'row-id') queryId = row.id;
      if (mutation === 'missing')
        await database('api_history').where({ id: row.id }).del();
      if (mutation === 'other-project')
        await database('api_history')
          .where({ id: row.id })
          .update({ project_id: 8 });
      if (mutation === 'other-query')
        await repository.updateOne(row.id, {
          responsePayload: {
            ...row.responsePayload,
            explanationQueryId: 'another-task',
          },
        });
      if (mutation === 'governed')
        await database('api_history')
          .where({ id: row.id })
          .update({ governance_binding_id: randomUUID() });
      if (mutation === 'not-general')
        await repository.updateOne(row.id, {
          responsePayload: { error: 'Unknown', explanationQueryId: queryId },
        });
      if (mutation === 'duplicate')
        await repository.createOne({ ...row, id: randomUUID() });
      expect((await read()).status).toBe(403);
      expect(stream).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['anonymous', 'old-token', 'revoked-member'])(
    'requires original native admission for %s, not an ownerless row or query ID',
    async (identity) => {
      await create(true, serviceHeaders);
      if (identity === 'revoked-member') member = false;
      const headers: Record<string, string> =
        identity === 'anonymous'
          ? {}
          : identity === 'old-token'
            ? { authorization: 'Bearer unverified-old-token' }
            : userHeaders;
      expect((await read(headers)).status).toBe(
        identity === 'revoked-member' ? 403 : 401,
      );
      expect(stream).not.toHaveBeenCalled();
    },
  );
  it.each([
    'history-deleted',
    'query-changed',
    'project-changed',
    'request-changed',
    'governed-mode',
    'member-revoked',
  ])('rechecks %s before exposing later stream content', async (mutation) => {
    const row = await create();
    stream.mockResolvedValue(
      Readable.from(
        (async function* () {
          yield 'data: {"message":"earlier"}\n\n';
          if (mutation === 'history-deleted')
            await database('api_history').where({ id: row.id }).del();
          if (mutation === 'query-changed')
            await repository.updateOne(row.id, {
              responsePayload: {
                ...row.responsePayload,
                explanationQueryId: 'another-task',
              },
            });
          if (mutation === 'project-changed') projectId = 8;
          if (mutation === 'request-changed')
            await repository.updateOne(row.id, {
              requestPayload: { question: 'Different source context' },
            });
          if (mutation === 'governed-mode')
            process.env.WREN_PLATFORM_BINDING_CONFIG_FILE =
              '/fixture/binding.json';
          if (mutation === 'member-revoked') member = false;
          yield 'data: {"message":"must remain private"}\n\n';
          yield `data: ${JSON.stringify({ done: true, queryId })}\n\n`;
        })(),
      ),
    );
    const text = await (await read()).text();
    expect(text).not.toContain('must remain private');
    expect(text).not.toContain('"done"');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('rechecks mode after an asynchronous original history lookup before its native GET', async () => {
    await create();
    const original = repository.findStandaloneExplanation.bind(repository);
    jest
      .spyOn(repository, 'findStandaloneExplanation')
      .mockImplementation(async (...args) => {
        const row = await original(...args);
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
        return row;
      });
    expect((await read()).status).toBe(412);
    expect(stream).not.toHaveBeenCalled();
  });
  it.each(['POST', 'DELETE'])(
    'rejects %s before reading a native queue',
    async (method) => {
      expect((await read(userHeaders, method)).status).toBe(405);
      expect(stream).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
    },
  );
});

describe('native reset transaction consumer', () => {
  it.each([false, true])(
    'preserves original cleanup with one transaction, rollback=%s',
    async (refuseDelete) => {
      const tx = {};
      const ctx: any = {
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: 7, type: 'DUCKDB' })),
          deleteProject: jest.fn(async () => {
            if (refuseDelete) throw new Error('task unsettled');
          }),
        },
        projectRepository: {
          transaction: jest.fn(async () => tx),
          commit: jest.fn(),
          rollback: jest.fn(),
        },
        askingService: {
          assertProjectTasksSettled: jest.fn(),
          deleteAllByProjectId: jest.fn(),
        },
        schemaChangeRepository: { deleteAllBy: jest.fn() },
        deployService: { deleteAllByProjectId: jest.fn() },
        modelService: {
          deleteAllViewsByProjectId: jest.fn(),
          deleteAllModelsByProjectId: jest.fn(),
        },
        wrenAIAdaptor: { delete: jest.fn() },
        telemetry: { sendEvent: jest.fn() },
      };
      const resolver = Object.create(ProjectResolver.prototype);
      if (refuseDelete)
        await expect(
          resolver.resetCurrentProject(null, null, ctx),
        ).rejects.toThrow('task unsettled');
      else
        expect(await resolver.resetCurrentProject(null, null, ctx)).toBe(true);
      expect(ctx.schemaChangeRepository.deleteAllBy).toHaveBeenCalledWith(
        { projectId: 7 },
        { tx },
      );
      for (const action of [
        ctx.deployService.deleteAllByProjectId,
        ctx.askingService.deleteAllByProjectId,
        ctx.modelService.deleteAllViewsByProjectId,
        ctx.modelService.deleteAllModelsByProjectId,
        ctx.projectService.deleteProject,
      ])
        expect(action).toHaveBeenCalledWith(7, tx);
      expect(
        refuseDelete
          ? ctx.projectRepository.rollback
          : ctx.projectRepository.commit,
      ).toHaveBeenCalledWith(tx);
      expect(ctx.wrenAIAdaptor.delete).toHaveBeenCalledTimes(
        refuseDelete ? 0 : 1,
      );
      ctx.askingService.assertProjectTasksSettled.mockRejectedValue(
        new Error('task unsettled'),
      );
      ctx.projectRepository.transaction.mockClear();
      await expect(
        resolver.resetCurrentProject(null, null, ctx),
      ).rejects.toThrow('task unsettled');
      expect(ctx.projectRepository.transaction).not.toHaveBeenCalled();
    },
  );
});

describe('bound asking rerun with original repository transactions', () => {
  let database: Knex, repository: any, adaptor: any, tracker: any;
  let responses: any;
  const postgres = process.env.WREN_TEST_POSTGRES_URL;
  const schema = `asking_rerun_${randomUUID().replace(/-/g, '')}`;
  const stored = async () => (await repository.findAll())[0];
  beforeAll(async () => {
    database = knex(
      postgres
        ? { client: 'pg', connection: postgres, searchPath: [schema] }
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
      '20250509000000_create_asking_task.js',
      '20250509000001_add_task_id_to_thread.js',
      '20250511000000-create-api-history.js',
      '20261005000000_api_history_governed_query.js',
      '20261007000000_asking_task_project.js',
      '20261011000000_native_binding_fence.js',
    ])
      await jest
        .requireActual(join(process.cwd(), 'migrations', name))
        .up(database);
    await database('project').insert({
      id: 7,
      type: 'DUCKDB',
      display_name: 'original',
      catalog: 'wren',
      schema: 'public',
    });
    await database('thread').insert({ id: 11, project_id: 7 });
    await database('thread_response').insert({ id: 21, thread_id: 11 });
  });
  afterAll(async () => {
    if (postgres) await database.schema.dropSchemaIfExists(schema, true);
    await database.destroy();
  });
  beforeEach(async () => {
    await database('asking_task').delete();
    await database('project')
      .where({ id: 7 })
      .update({ native_binding_fences: null });
    repository = new AskingTaskRepository(database);
    // Observe the original methods without replacing locks, commits or writes.
    for (const method of ['commit', 'rollback', 'updateQuery'] as const)
      jest.spyOn(repository, method);
    adaptor = {
      ask: jest.fn(async ({ queryId }) => ({ queryId })),
      getAskResult: jest.fn(async () => ({
        status: AskResultStatus.FINISHED,
        response: [{ sql: 'SELECT 1' }],
        error: null,
      })),
    };
    responses = { findOneBy: jest.fn(), updateOne: jest.fn() };
    tracker = new AskingTaskTracker({
      wrenAIAdaptor: adaptor,
      askingTaskRepository: repository,
      threadResponseRepository: responses,
      viewRepository: { findOneBy: jest.fn() } as any,
    });
    // Poll explicitly; timers are unrelated to the row-lock/dispatch assertions.
    tracker.stopPolling();
  });
  afterEach(() => {
    tracker.stopPolling();
    jest.restoreAllMocks();
  });
  // Commit a competing writer after the initial snapshot, before the original
  // transaction opens. The production project/task row locks remain untouched.
  const replaceBeforeTransaction = (row: any) => {
    const begin = repository.transaction.bind(repository);
    jest.spyOn(repository, 'transaction').mockImplementationOnce(async () => {
      await database('asking_task')
        .where({ id: row.id })
        .update({ detail: JSON.stringify(row.detail) });
      return begin();
    });
  };
  it('bound original Asking commits the exact HUMAN owner before POST, freshly authorizes it and observes after lost ACK', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    const authorizeNative = jest.fn(async (queryId) => {
      expect(await repository.findAll()).toHaveLength(1);
      expect((await stored()).queryId).toBe(queryId);
      expect((await stored()).detail.nativeScope).toEqual(nativeScope);
    });
    let atPost: { input: any; transport: any; persisted: any[] };
    adaptor.ask.mockImplementation(async (input, transport) => {
      atPost = { input, transport, persisted: await repository.findAll() };
      throw new Error('lost create ACK');
    });
    try {
      const result = await tracker.createAskingTask({
        query: 'Original',
        projectId: 7,
        nativeScope,
        authorizeNative,
        nativeHumanToken: 'fixture-human-token',
      });
      // Assertions live outside the adapter: an assertion thrown inside POST
      // would be caught by the product's intentional UNKNOWN handling.
      expect(authorizeNative).toHaveBeenCalledWith(atPost.input.queryId);
      expect(atPost.persisted[0].queryId).toBe(atPost.input.queryId);
      expect(atPost.input.nativeHumanToken).toBeUndefined();
      expect(atPost.transport).toMatchObject({
        humanToken: 'fixture-human-token',
        projectId: 7,
      });
      expect(JSON.stringify(atPost.persisted)).not.toContain(
        'fixture-human-token',
      );
      expect(result.queryId).toBe((await stored()).queryId);
      expect(result.queryId).toMatch(/^[a-f0-9-]{36}$/);
      await tracker.pollTasks();
      expect((await stored()).detail.nativeScope).toEqual(nativeScope);
      expect((await stored()).detail.status).toBe(AskResultStatus.FINISHED);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });

  it('a changed bound owner before POST persists the known admission failure without dispatch', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    let finishObservation: (result: unknown) => void;
    let observationStarted: () => void;
    const started = new Promise<void>((resolve) => {
      observationStarted = resolve;
    });
    const observation = new Promise((resolve) => {
      finishObservation = resolve;
    });
    adaptor.getAskResult.mockImplementation(() => {
      observationStarted();
      return observation;
    });
    let polling: Promise<void>;
    try {
      await expect(
        tracker.createAskingTask({
          query: 'Original',
          projectId: 7,
          nativeScope: {
            bindingId: randomUUID(),
            generation: 1,
            identityScope: 'a'.repeat(64),
            metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
          },
          nativeHumanToken: 'fixture-human-token',
          authorizeNative: async (queryId) => {
            await tracker.getAskingResult(queryId);
            polling = tracker.pollTasks();
            await started;
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await repository.findAll()).toHaveLength(1);
      expect((await stored()).detail.status).toBe(AskResultStatus.FAILED);
      expect((await stored()).detail.error.message).toBe('QUERY_SCOPE_DENIED');
      expect(
        (await tracker.getAskingResultById((await stored()).id)).status,
      ).toBe(AskResultStatus.FAILED);
      expect(tracker.trackedTasks.size).toBe(0);
      expect(tracker.trackedTasksById.size).toBe(0);
      finishObservation({
        status: AskResultStatus.FINISHED,
        response: [],
        error: null,
      });
      await polling;
      expect((await stored()).detail.status).toBe(AskResultStatus.FAILED);
      expect(adaptor.ask).not.toHaveBeenCalled();
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it.each([
    AskResultStatus.UNDERSTANDING,
    AskResultStatus.SEARCHING,
    AskResultStatus.PLANNING,
    AskResultStatus.GENERATING,
    AskResultStatus.CORRECTING,
    AskResultStatus.FINISHED,
    'FUTURE_NATIVE_STATUS',
    undefined,
  ])('does not redispatch a bound %s task under rerun', async (status) => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    await repository.createOne({
      id: 9,
      projectId: 7,
      queryId: 'original',
      threadResponseId: 21,
      detail: { status, nativeScope },
    });
    try {
      await expect(
        tracker.createAskingTask({
          query: 'Original',
          projectId: 7,
          rerunFromCancelled: true,
          previousTaskId: 9,
          threadResponseId: 21,
          nativeScope,
          authorizeNative: jest.fn(),
          nativeHumanToken: 'fixture-human-token',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await stored()).queryId).toBe('original');
      expect(repository.updateQuery).not.toHaveBeenCalled();
      expect(repository.rollback).toHaveBeenCalledTimes(1);
      expect(adaptor.ask).not.toHaveBeenCalled();
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it.each([AskResultStatus.FAILED, AskResultStatus.STOPPED])(
    'reruns the original bound %s task once and retains unknown POST acknowledgement',
    async (status) => {
      const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
      const nativeScope = {
        bindingId: randomUUID(),
        generation: 1,
        identityScope: 'a'.repeat(64),
        metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
      };
      await repository.createOne({
        id: 9,
        projectId: 7,
        queryId: 'original',
        threadResponseId: 21,
        detail: { status, nativeScope },
      });
      const authorizeNative = jest.fn(async (queryId) => {
        expect(repository.commit).toHaveBeenCalledTimes(1);
        expect((await stored()).queryId).toBe(queryId);
      });
      adaptor.ask.mockRejectedValue(new Error('lost POST ACK'));
      try {
        const result = await tracker.createAskingTask({
          query: 'Original',
          projectId: 7,
          rerunFromCancelled: true,
          previousTaskId: 9,
          threadResponseId: 21,
          nativeScope,
          authorizeNative,
          nativeHumanToken: 'fixture-human-token',
        });
        expect(result.queryId).not.toBe('original');
        expect(await repository.findAll()).toHaveLength(1);
        expect((await stored()).detail).toEqual({
          status: AskResultStatus.UNDERSTANDING,
          nativeScope,
        });
        expect(adaptor.ask).toHaveBeenCalledTimes(1);
        expect(authorizeNative).toHaveBeenCalledWith(result.queryId);
        await expect(
          tracker.createAskingTask({
            query: 'Original',
            projectId: 7,
            rerunFromCancelled: true,
            previousTaskId: 9,
            threadResponseId: 21,
            nativeScope,
            authorizeNative,
            nativeHumanToken: 'fixture-human-token',
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(adaptor.ask).toHaveBeenCalledTimes(1);
      } finally {
        if (original === undefined)
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
      }
    },
  );
  it('checks the locked rerun owner and status instead of the earlier row snapshot', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    const row = {
      id: 9,
      projectId: 7,
      queryId: 'original',
      threadResponseId: 21,
      detail: { status: AskResultStatus.STOPPED, nativeScope },
    };
    await repository.createOne(row);
    const input = {
      query: 'Original',
      projectId: 7,
      rerunFromCancelled: true,
      previousTaskId: 9,
      threadResponseId: 21,
      nativeScope,
      authorizeNative: jest.fn(),
      nativeHumanToken: 'fixture-human-token',
    };
    try {
      replaceBeforeTransaction({
        ...row,
        detail: { status: AskResultStatus.UNDERSTANDING, nativeScope },
      });
      await expect(tracker.createAskingTask(input)).rejects.toMatchObject({
        status: 409,
      });
      replaceBeforeTransaction({
        ...row,
        detail: {
          ...row.detail,
          nativeScope: { ...nativeScope, identityScope: 'd'.repeat(64) },
        },
      });
      await expect(tracker.createAskingTask(input)).rejects.toMatchObject({
        status: 403,
      });
      expect(repository.updateQuery).not.toHaveBeenCalled();
      expect(adaptor.ask).not.toHaveBeenCalled();
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it('clears old query caches and persists a rerun admission refusal on the existing task', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    await repository.createOne({
      id: 9,
      projectId: 7,
      queryId: 'original',
      threadResponseId: 21,
      detail: { status: AskResultStatus.STOPPED, nativeScope },
    });
    const stale = {
      queryId: 'original',
      taskId: 9,
      projectId: 7,
      result: (await stored()).detail,
    };
    tracker.trackedTasks.set('original', stale);
    tracker.trackedTasksById.set(9, stale);
    try {
      await expect(
        tracker.createAskingTask({
          query: 'Original',
          projectId: 7,
          rerunFromCancelled: true,
          previousTaskId: 9,
          threadResponseId: 21,
          nativeScope,
          nativeHumanToken: 'fixture-human-token',
          authorizeNative: async () => {
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(tracker.trackedTasks.has('original')).toBe(false);
      expect(tracker.trackedTasksById.has(9)).toBe(false);
      expect(await tracker.getAskingResultById(9)).toMatchObject({
        status: AskResultStatus.FAILED,
        nativeScope,
        error: { message: 'QUERY_SCOPE_DENIED' },
      });
      expect(await repository.findAll()).toHaveLength(1);
      expect(adaptor.ask).not.toHaveBeenCalled();
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it('an old in-flight observation cannot overwrite the replacement query after a bound rerun', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    await repository.createOne({
      id: 9,
      projectId: 7,
      queryId: 'original',
      threadResponseId: 21,
      detail: { status: AskResultStatus.UNDERSTANDING, nativeScope },
    });
    let finishObservation: (result: unknown) => void;
    let observationStarted: () => void;
    const started = new Promise<void>((resolve) => {
      observationStarted = resolve;
    });
    adaptor.getAskResult.mockImplementation(() => {
      observationStarted();
      return new Promise((resolve) => {
        finishObservation = resolve;
      });
    });
    try {
      await tracker.getAskingResult('original');
      const polling = tracker.pollTasks();
      await started;
      await repository.updateQuery(9, 'original', 7, {
        detail: { status: AskResultStatus.STOPPED, nativeScope },
      });
      repository.updateQuery.mockClear();
      adaptor.ask.mockImplementation(async ({ queryId }) => ({ queryId }));
      const result = await tracker.createAskingTask({
        query: 'Original',
        projectId: 7,
        rerunFromCancelled: true,
        previousTaskId: 9,
        threadResponseId: 21,
        nativeScope,
        authorizeNative: jest.fn(),
        nativeHumanToken: 'fixture-human-token',
      });
      finishObservation({
        status: AskResultStatus.FINISHED,
        response: [{ sql: 'old result' }],
        error: null,
      });
      await polling;
      expect((await stored()).queryId).toBe(result.queryId);
      expect((await stored()).detail.status).toBe(
        AskResultStatus.UNDERSTANDING,
      );
      expect(repository.updateQuery).toHaveBeenCalledTimes(1);
      expect(responses.updateOne).not.toHaveBeenCalled();
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });

  it('refuses a retired binding generation using the original project-row fence', async () => {
    const saved = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    try {
      await repository.createOne({
        id: 9,
        projectId: 7,
        queryId: 'original',
        threadResponseId: 21,
        detail: { status: AskResultStatus.STOPPED, nativeScope },
      });
      await database.transaction((tx) =>
        lockNativeBinding(tx, 7, nativeScope, true),
      );
      await expect(
        tracker.createAskingTask({
          query: 'Original',
          projectId: 7,
          previousTaskId: 9,
          threadResponseId: 21,
          rerunFromCancelled: true,
          nativeScope,
          authorizeNative: jest.fn(),
          nativeHumanToken: 'fixture-human-token',
        }),
      ).rejects.toThrow('NATIVE_BINDING_CLOSED');
      expect((await stored()).queryId).toBe('original');
      expect(adaptor.ask).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = saved;
    }
  });

  it('keeps the original registered execution set until the rerun has its exact settled references', async () => {
    const saved = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    try {
      await repository.createOne({
        id: 9,
        projectId: 7,
        queryId: 'original',
        threadResponseId: 21,
        detail: { status: AskResultStatus.UNDERSTANDING, nativeScope },
      });
      expect(
        await repository.registerNativeQuery(
          'original',
          7,
          nativeScope,
          'original-execution',
        ),
      ).not.toBeNull();
      await repository.updateQuery(9, 'original', 7, {
        detail: { status: AskResultStatus.STOPPED, nativeScope },
      });
      const input = {
        query: 'Original',
        projectId: 7,
        previousTaskId: 9,
        threadResponseId: 21,
        rerunFromCancelled: true,
        nativeScope,
        authorizeNative: jest.fn(),
        nativeHumanToken: 'fixture-human-token',
      };
      await expect(tracker.createAskingTask(input)).rejects.toMatchObject({
        status: 409,
        code: 'NATIVE_EXECUTION_UNKNOWN',
      });
      expect((await stored()).detail.nativeQueries).toEqual([
        'original-execution',
      ]);
      expect(adaptor.ask).not.toHaveBeenCalled();
      const result = await tracker.createAskingTask({
        ...input,
        nativePreviousQueries: ['original-execution'],
      });
      expect((await stored()).queryId).toBe(result.queryId);
      expect((await stored()).detail.nativeScope).toEqual(nativeScope);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    } finally {
      if (saved === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = saved;
    }
  });

  it('serializes competing reruns of one persisted task without a replacement POST', async () => {
    const saved = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    const nativeScope = {
      bindingId: randomUUID(),
      generation: 1,
      identityScope: 'a'.repeat(64),
      metadataReference: { hash: 'b'.repeat(40), digest: 'c'.repeat(64) },
    };
    try {
      await repository.createOne({
        id: 9,
        projectId: 7,
        queryId: 'original',
        threadResponseId: 21,
        detail: { status: AskResultStatus.STOPPED, nativeScope },
      });
      const input = {
        query: 'Original',
        projectId: 7,
        previousTaskId: 9,
        threadResponseId: 21,
        rerunFromCancelled: true,
        nativeScope,
        authorizeNative: jest.fn(),
        nativeHumanToken: 'fixture-human-token',
      };
      adaptor.ask.mockRejectedValue(new Error('lost POST ACK'));
      const results = await Promise.allSettled([
        tracker.createAskingTask(input),
        tracker.createAskingTask(input),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 409 });
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
      expect(await repository.findAll()).toHaveLength(1);
      expect((await stored()).detail).toEqual({
        status: AskResultStatus.UNDERSTANDING,
        nativeScope,
      });
    } finally {
      if (saved === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = saved;
    }
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
      lockQuery: jest.fn(async (id, queryId, projectId) =>
        rows.find(
          (row) =>
            row.id === id &&
            row.queryId === queryId &&
            row.projectId === projectId,
        ),
      ),
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
  it.each([AskResultType.GENERAL, AskResultType.MISLEADING_QUERY])(
    'continues observing %s until the original native query actually finishes',
    async (type) => {
      await tracker.createAskingTask({ query: 'native', projectId: 7 });
      const generating = {
        type,
        status: AskResultStatus.GENERATING,
        response: [],
        error: null,
      };
      const finished = { ...generating, status: AskResultStatus.FINISHED };
      adaptor.getAskResult
        .mockResolvedValueOnce(generating)
        .mockResolvedValueOnce(finished);

      await tracker.pollTasks();
      expect(rows[0].detail).toEqual(generating);
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(false);
      expect(await tracker.getAskingResult('acknowledged')).toMatchObject({
        taskId: 1,
        queryId: 'acknowledged',
        status: AskResultStatus.GENERATING,
      });

      await tracker.pollTasks();
      expect(rows[0].detail).toEqual(finished);
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(true);
      expect(adaptor.getAskResult.mock.calls).toEqual([
        ['acknowledged'],
        ['acknowledged'],
      ]);
      await tracker.pollTasks();
      expect(adaptor.getAskResult).toHaveBeenCalledTimes(2);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    },
  );
  it.each([AskResultType.GENERAL, AskResultType.MISLEADING_QUERY])(
    'does not mark a %s SQL rerun as failed while the native task is still generating',
    async (type) => {
      rows.push({
        id: 9,
        projectId: 7,
        queryId: 'cancelled',
        threadResponseId: 21,
        detail: { status: AskResultStatus.STOPPED },
      });
      await tracker.createAskingTask({
        query: 'native',
        projectId: 7,
        rerunFromCancelled: true,
        previousTaskId: 9,
        threadResponseId: 21,
      });
      const generating = {
        type,
        status: AskResultStatus.GENERATING,
        response: [],
        error: null,
      };
      adaptor.getAskResult
        .mockResolvedValueOnce(generating)
        .mockResolvedValueOnce({
          ...generating,
          status: AskResultStatus.FINISHED,
        });

      await tracker.pollTasks();
      expect(rows[0].detail).toEqual(generating);
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(false);
      await tracker.pollTasks();
      expect(rows[0].detail).toMatchObject({
        type,
        status: AskResultStatus.FAILED,
        error: expect.objectContaining({ code: expect.any(String) }),
      });
      expect(await tracker.getAskingResultById(9)).toMatchObject({
        taskId: 9,
        queryId: 'acknowledged',
        status: AskResultStatus.FINISHED,
      });
      expect(rows).toHaveLength(1);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    },
  );
  it.each([AskResultStatus.FAILED, AskResultStatus.STOPPED])(
    'preserves native %s evidence on a classified SQL rerun',
    async (status) => {
      rows.push({
        id: 9,
        projectId: 7,
        queryId: 'cancelled',
        threadResponseId: 21,
        detail: { status: AskResultStatus.STOPPED },
      });
      await tracker.createAskingTask({
        query: 'native',
        projectId: 7,
        rerunFromCancelled: true,
        previousTaskId: 9,
        threadResponseId: 21,
      });
      const result = {
        type: AskResultType.GENERAL,
        status,
        response: [],
        error:
          status === AskResultStatus.FAILED
            ? { code: 'NATIVE_FAILURE', message: 'native failure' }
            : null,
      };
      adaptor.getAskResult.mockResolvedValue(result);

      await tracker.pollTasks();
      expect(rows[0].detail).toEqual(result);
      expect(await tracker.getAskingResultById(9)).toMatchObject(result);
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(true);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    },
  );
  it.each([AskResultType.GENERAL, AskResultType.MISLEADING_QUERY])(
    'does not treat %s classification as terminal evidence for an unknown native status',
    async (type) => {
      await tracker.createAskingTask({ query: 'native', projectId: 7 });
      adaptor.getAskResult.mockResolvedValue({
        type,
        status: 'FUTURE_NATIVE_STATUS',
        response: [],
      });
      await tracker.pollTasks();
      expect(rows[0].detail.status).toBe('FUTURE_NATIVE_STATUS');
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(false);
      adaptor.getAskResult.mockResolvedValue({
        type,
        status: AskResultStatus.STOPPED,
        response: [],
      });
      await tracker.pollTasks();
      expect(rows[0].detail.status).toBe(AskResultStatus.STOPPED);
      expect(tracker.trackedTasks.get('acknowledged').isFinalized).toBe(true);
      expect(adaptor.ask).toHaveBeenCalledTimes(1);
    },
  );
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
    const migration = jest.requireActual(
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
        await jest
          .requireActual(join(process.cwd(), 'migrations', name))
          .up(database);
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
    it('retains running/unknown task evidence across every native cascade and permits observed terminal cleanup', async () => {
      const guard = jest.requireActual(
        join(
          process.cwd(),
          'migrations/20261007010000_preserve_running_asking_tasks.js',
        ),
      );
      await database.transaction((tx) => guard.up(tx));
      await repository.createOne({
        id: 3,
        projectId: 7,
        queryId: 'running',
        threadId: 11,
        threadResponseId: 21,
        detail: {
          status: AskResultStatus.GENERATING,
          type: null,
          response: [],
          error: null,
        },
      });
      expect((await repository.findUnsettled(7)).id).toBe(3);
      expect(await repository.findUnsettled(8)).toBeNull();
      for (const [table, id] of [
        ['asking_task', 3],
        ['thread_response', 21],
        ['thread', 11],
        ['project', 7],
      ] as const) {
        await expect(database(table).where({ id }).delete()).rejects.toThrow(
          'no observed terminal result',
        );
        expect(await database(table).where({ id }).first()).toBeDefined();
        expect(await repository.findByQueryId('running')).not.toBeNull();
      }
      for (const detail of [null, {}, { status: 'UNRECOGNIZED' }]) {
        await database('asking_task')
          .where({ id: 3 })
          .update({ detail: JSON.stringify(detail) });
        expect((await repository.findUnsettled(7)).id).toBe(3);
        await expect(
          database('project').where({ id: 7 }).delete(),
        ).rejects.toThrow('no observed terminal result');
      }
      await expect(guard.down(database)).rejects.toThrow('Stop rollback');
      await database('asking_task')
        .where({ id: 3 })
        .update({ detail: JSON.stringify({ status: 'FINISHED' }) });
      expect(await repository.findUnsettled(7)).toBeNull();
      // The row becomes active again before a competing project deletion.
      const observation = await database.transaction();
      await observation('asking_task')
        .where({ id: 3 })
        .update({ detail: JSON.stringify({ status: 'GENERATING' }) });
      const removal = database('project').where({ id: 7 }).delete();
      const refused = expect(removal).rejects.toThrow(
        'no observed terminal result',
      );
      await observation.commit();
      await refused;
      expect(await database('project').where({ id: 7 }).first()).toBeDefined();
      // Terminal tasks in the same cascading statement must also survive failure.
      await repository.createOne({
        id: 4,
        projectId: 7,
        queryId: 'settled',
        detail: {
          status: AskResultStatus.FINISHED,
          type: null,
          response: [],
          error: null,
        },
      });
      await expect(
        database.transaction(async (tx) => {
          await tx('thread').where({ id: 14 }).delete();
          await tx('project').where({ id: 7 }).delete();
        }),
      ).rejects.toThrow('no observed terminal result');
      expect(await database('thread').where({ id: 14 }).first()).toBeDefined();
      expect(await repository.findByQueryId('settled')).not.toBeNull();
      for (const status of ['FINISHED', 'FAILED', 'STOPPED']) {
        await database('asking_task')
          .where({ id: 3 })
          .update({ detail: JSON.stringify({ status }) });
        expect(await repository.findUnsettled(7)).toBeNull();
      }
      await database('project').where({ id: 7 }).delete();
      expect(await repository.findByQueryId('running')).toBeNull();
      expect(await repository.findByQueryId('settled')).toBeNull();
      await guard.down(database);
      await database.transaction((tx) => guard.up(tx));
    });
  },
);

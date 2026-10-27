import { Readable, PassThrough } from 'stream';
import knex, { Knex } from 'knex';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import { AskingService } from './apollo/server/services/askingService';
import { ThreadRepository } from './apollo/server/repositories/threadRepository';
import { ThreadResponseRepository } from './apollo/server/repositories/threadResponseRepository';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import handler from './pages/api/ask_task/streaming_answer';
import { NativeHumanQuery } from './apollo/server/services/nativeHumanQuery';
import { NativeQueryDelivery } from './apollo/server/services/nativeQueryAdmission';
import { TextBasedAnswerBackgroundTracker } from './apollo/server/backgrounds/textBasedAnswerBackgroundTracker';
import { components } from './common';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import {
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
} from './apollo/server/backgrounds/chart';

jest.mock('./common', () => ({
  components: {
    askingService: {
      getResponse: jest.fn(),
      changeThreadResponseAnswerDetailStatus: jest.fn(async () => undefined),
    },
    wrenAIAdaptor: { streamTextBasedAnswer: jest.fn() },
    threadResponseRepository: { claimNativeAnswer: jest.fn() },
    apiHistoryRepository: { findOneBy: jest.fn() },
    projectService: { getCurrentProject: jest.fn() },
  },
}));
describe('original native text-answer result consumers', () => {
  const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const originalBinding = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  let server: Server;
  let directory: string;
  let config: NativeQueryDelivery;
  let scopeRequests: number;
  let revokeAt: number;
  let scopeChanges: Record<string, unknown>;
  let wireErrors: unknown[];
  const response: any = {
    id: 71,
    threadId: 81,
    question: 'original',
    sql: 'SELECT value FROM native_model',
    answerDetail: {
      queryId: 'native-ai-task',
      queryHistoryId: 'native-query-history',
      status: 'STREAMING',
    },
  };
  const native: any = components;
  const record: any = {
    id: 'native-query-history',
    requestPayload: { sql: response.sql },
    responsePayload: { columns: [], data: [] },
  };
  let authorize: jest.SpyInstance;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'native-text-answer-'));
    server = createServer((request, result) => {
      void (async () => {
        const body: Buffer[] = [];
        for await (const chunk of request) body.push(Buffer.from(chunk));
        const text = Buffer.concat(body).toString('utf8');
        result.setHeader('content-type', 'application/json');
        expect(request.method).toBe('POST');
        if (request.url === '/token') {
          expect(request.headers.authorization).toBe(
            `Basic ${Buffer.from('native-text:fixture-only').toString('base64')}`,
          );
          expect(text).toBe('grant_type=client_credentials');
          result.end(
            JSON.stringify({ access_token: 'service', token_type: 'Bearer' }),
          );
          return;
        }
        expect(request.url).toBe('/service/v1/adapter/human-action');
        expect(request.headers.authorization).toBe('Bearer service');
        expect(request.headers['x-kailo-native-human-token']).toBe(
          'verified-human',
        );
        expect(JSON.parse(text)).toEqual({
          bindingId: config.bindingId,
          authorizeScope: { permission: 'discover' },
        });
        scopeRequests++;
        if (revokeAt && scopeRequests >= revokeAt) {
          result.statusCode = 403;
          result.end(
            JSON.stringify({ class: 'DENIED', reason: 'PERMISSION_DENIED' }),
          );
          return;
        }
        result.end(
          JSON.stringify({
            scope: {
              bindingId: config.bindingId,
              tenantId: config.tenantId,
              workspaceId: config.workspaceId,
              nativeInstanceRef: config.nativeInstanceRef,
              nativeScopeRef: config.nativeScopeRef,
              generation: 2,
              permission: 'discover',
              checkedRevision: 'current-fixture-revision',
              ...scopeChanges,
            },
          }),
        );
      })().catch((error) => {
        wireErrors.push(error);
        result.statusCode = 500;
        result.end('{}');
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    config = {
      projectId: 3,
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: 'fixture-instance',
      nativeScopeRef: '3',
      projectConnectionDigest: 'b'.repeat(64),
      actionTokenIssuer: 'https://core.invalid',
      actionTokenAudience: 'native-text',
      actionTokenJwksFile: join(directory, 'action-jwks.json'),
      serviceTokenUrl: `${endpoint}/token`,
      serviceClientId: 'native-text',
      serviceClientSecretFile: join(directory, 'service-secret'),
      corePepUrl: `${endpoint}/service/v1/adapter/pep_check`,
      gatewayIssuer: 'urn:kailo:gateway:fixture',
      gatewayAudience: 'native-text',
      gatewayCallerId: 'fixture-gateway',
      gatewayJwksFile: join(directory, 'gateway-jwks.json'),
      gatewayMaxTokenSeconds: 60,
      mcpAuthority: 'native.invalid',
      requestTimeoutMs: 2000,
      responseMaxBytes: 4096,
      requestMaxBytes: 4096,
    };
    await writeFile(config.serviceClientSecretFile, 'fixture-only', {
      mode: 0o600,
    });
    await writeFile(join(directory, 'query.json'), JSON.stringify(config), {
      mode: 0o600,
    });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  beforeEach(() => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(directory, 'query.json');
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    scopeRequests = 0;
    revokeAt = 0;
    scopeChanges = {};
    wireErrors = [];
    jest.clearAllMocks();
    native.askingService.getResponse.mockResolvedValue(response);
    native.apiHistoryRepository.findOneBy.mockResolvedValue(record);
    native.projectService.getCurrentProject.mockResolvedValue({ id: 3 });
    native.threadResponseRepository.claimNativeAnswer.mockImplementation(
      async (expected, detail) => ({ ...expected, answerDetail: detail }),
    );
    // This suite isolates the original answer/chart consumers from the SQL
    // receipt reader. Discover authorization above uses the original delivery
    // loader, binding transport and scope validator, not an authority mock.
    authorize = jest
      .spyOn(NativeHumanQuery.prototype, 'readHistory')
      .mockResolvedValue(record);
  });
  afterEach(() => {
    authorize.mockRestore();
    if (original === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    if (originalBinding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = originalBinding;
    expect(wireErrors).toEqual([]);
  });
  const invoke = async (chunks: Iterable<Buffer>) => {
    native.wrenAIAdaptor.streamTextBasedAnswer.mockResolvedValue(
      Readable.from(chunks),
    );
    const request: any = Object.assign(new EventEmitter(), {
      method: 'GET',
      query: { responseId: '71' },
      headers: {
        'x-kailo-native-human-token': 'verified-human',
        'x-kailo-native-identity-scope': 'a'.repeat(64),
      },
    });
    const output: any = {
      setHeader: jest.fn(),
      status: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      headersSent: false,
      flushHeaders: jest.fn(() => {
        output.headersSent = true;
      }),
    };
    output.status.mockReturnValue(output);
    await handler(request, output);
    return output;
  };
  it('keeps original UTF-8 streaming and completes only on the exact native task receipt', async () => {
    const encoded = Buffer.from(
      'data: {"message":"中文原答案"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
    );
    const result = await invoke([
      encoded.subarray(0, 21),
      encoded.subarray(21, 25),
      encoded.subarray(25),
    ]);
    expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
      'data: {"message":"中文原答案"}\n\ndata: {"done":true}\n\n',
    );
    expect(
      native.threadResponseRepository.claimNativeAnswer,
    ).toHaveBeenCalledWith(response, {
      ...response.answerDetail,
      status: 'FINISHED',
      content: '中文原答案',
    });
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(scopeRequests).toBe(3);
    expect(authorize.mock.calls[0]).toEqual(['verified-human', record]);
  });
  it.each(['close', 'foreign-id', 'unknown-enum'])(
    'does not manufacture FINISHED from %s',
    async (mode) => {
      const suffix =
        mode === 'foreign-id'
          ? 'data: {"done":true,"queryId":"foreign-ai-task"}\n\n'
          : mode === 'unknown-enum'
            ? 'data: {"status":"FUTURE_SUCCESS"}\n\n'
            : '';
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke([
          Buffer.from('data: {"message":"partial"}\n\n' + suffix),
        ]);
        expect(native.wrenAIAdaptor.streamTextBasedAnswer).toHaveBeenCalledWith(
          'native-ai-task',
        );
        expect(result.flushHeaders).toHaveBeenCalledTimes(1);
        expect(authorize).toHaveBeenCalledTimes(mode === 'close' ? 2 : 3);
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(
          result.write.mock.calls.map(([value]) => value).join(''),
        ).not.toContain('"done":true');
      } finally {
        error.mockRestore();
      }
    },
  );
  it('keeps the original standalone answer stream and terminal persistence without a platform binding', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const result = await invoke([
      Buffer.from(
        'data: {"message":"original answer"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
      ),
    ]);
    expect(authorize).not.toHaveBeenCalled();
    expect(scopeRequests).toBe(0);
    expect(
      native.threadResponseRepository.claimNativeAnswer,
    ).toHaveBeenCalledWith(response, {
      ...response.answerDetail,
      status: 'FINISHED',
      content: 'original answer',
    });
    expect(
      native.askingService.changeThreadResponseAnswerDetailStatus,
    ).not.toHaveBeenCalled();
    expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
      'data: {"message":"original answer"}\n\ndata: {"done":true}\n\n',
    );
  });
  it.each<[string, unknown]>([
    ['bindingId', 'another-binding'],
    ['tenantId', 'another-tenant'],
    ['workspaceId', 'another-workspace'],
    ['nativeInstanceRef', 'another-instance'],
    ['nativeScopeRef', '4'],
    ['generation', undefined],
    ['permission', 'manage'],
    ['checkedRevision', undefined],
  ])(
    'rejects an incomplete or foreign discover scope: %s',
    async (field, value) => {
      scopeChanges = { [field]: value };
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke([
          Buffer.from('data: {"message":"private"}\n\n'),
        ]);
        expect(
          native.wrenAIAdaptor.streamTextBasedAnswer,
        ).not.toHaveBeenCalled();
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(result.status).toHaveBeenCalledWith(403);
        expect(result.flushHeaders).not.toHaveBeenCalled();
        expect(result.write).not.toHaveBeenCalled();
        expect(scopeRequests).toBe(1);
        expect(authorize).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    },
  );
  it.each([1, 3])(
    'honors real discover refusal at exposure %s without completing the native task',
    async (at) => {
      revokeAt = at;
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke([
          Buffer.from(
            'data: {"message":"allowed"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
          ),
        ]);
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
          at === 1 ? '' : 'data: {"message":"allowed"}\n\n',
        );
        expect(scopeRequests).toBe(at);
        expect(authorize).toHaveBeenCalledTimes(at - 1);
        expect(
          native.wrenAIAdaptor.streamTextBasedAnswer,
        ).toHaveBeenCalledTimes(at === 1 ? 0 : 1);
      } finally {
        error.mockRestore();
      }
    },
  );
  it.each([1, 3])(
    'rejects governed answer mode retirement during disclosure %s',
    async (at) => {
      let reads = 0;
      authorize.mockImplementation(async () => {
        if (++reads === at) {
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
          delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
        }
        return record;
      });
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke([
          Buffer.from(
            'data: {"message":"allowed"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
          ),
        ]);
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
          at === 1 ? '' : 'data: {"message":"allowed"}\n\n',
        );
        expect(
          native.wrenAIAdaptor.streamTextBasedAnswer,
        ).toHaveBeenCalledTimes(at === 1 ? 0 : 1);
        expect(scopeRequests).toBe(at);
        expect(authorize).toHaveBeenCalledTimes(at);
      } finally {
        error.mockRestore();
      }
    },
  );
  it.each([false, true])(
    'rejects answer mode changes before the next frame, originally governed=%s',
    async (governed) => {
      if (!governed) delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      function* frames() {
        if (governed) {
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
          delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
        } else {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(
            directory,
            'query.json',
          );
        }
        yield Buffer.from(
          'data: {"message":"private"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
        );
      }
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke(frames());
        expect(result.write).not.toHaveBeenCalled();
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(
          native.askingService.changeThreadResponseAnswerDetailStatus,
        ).not.toHaveBeenCalled();
        expect(
          native.wrenAIAdaptor.streamTextBasedAnswer,
        ).toHaveBeenCalledTimes(1);
        expect(scopeRequests).toBe(governed ? 1 : 0);
        expect(authorize).toHaveBeenCalledTimes(governed ? 1 : 0);
      } finally {
        error.mockRestore();
      }
    },
  );
  it('does not open the original AI stream when current HUMAN disclosure is rejected', async () => {
    authorize.mockRejectedValue(new Error('current Resource revoked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from('data: {"message":"private"}\n\n'),
      ]);
      expect(native.wrenAIAdaptor.streamTextBasedAnswer).not.toHaveBeenCalled();
      expect(result.flushHeaders).not.toHaveBeenCalled();
      expect(result.write).not.toHaveBeenCalled();
      expect(scopeRequests).toBe(1);
      expect(authorize).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
  it('rechecks current HUMAN/source authorization before each content exposure', async () => {
    authorize
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(record)
      .mockRejectedValue(new Error('current Resource revoked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from(
          'data: {"message":"allowed"}\n\ndata: {"message":"revoked"}\n\n',
        ),
      ]);
      expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
        'data: {"message":"allowed"}\n\n',
      );
      expect(
        native.threadResponseRepository.claimNativeAnswer,
      ).not.toHaveBeenCalled();
      expect(scopeRequests).toBe(3);
      expect(authorize).toHaveBeenCalledTimes(3);
    } finally {
      error.mockRestore();
    }
  });
  it('a concurrent original response change cannot be overwritten with a terminal result', async () => {
    native.threadResponseRepository.claimNativeAnswer.mockResolvedValue(null);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from('data: {"done":true,"queryId":"native-ai-task"}\n\n'),
      ]);
      expect(result.write).not.toHaveBeenCalled();
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(
        native.threadResponseRepository.claimNativeAnswer,
      ).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
  it.each(['allowed', 'revoked', 'changed', 'missing-history', 'empty'])(
    'the original chart body consumes current HUMAN history disclosure: %s',
    async (state) => {
      const parent: any = {
        ...response,
        chartDetail: {
          queryId: 'native-chart-task',
          queryHistoryId: record.id,
          status: 'FINISHED',
          chartSchema: { mark: 'bar' },
        },
      };
      native.askingService.getResponse.mockResolvedValue(parent);
      if (state === 'revoked')
        authorize.mockRejectedValue(new Error('current Resource revoked'));
      if (state === 'changed')
        native.askingService.getResponse.mockResolvedValue({
          ...parent,
          question: 'changed',
        });
      if (state === 'missing-history') delete parent.chartDetail.queryHistoryId;
      if (state === 'empty') parent.chartDetail = {};
      const read = new AskingResolver().getThreadResponseNestedResolver()
        .chartDetail;
      const ctx: any = {
        ...native,
        nativeHumanToken: 'verified-human',
        nativeIdentityScope: 'a'.repeat(64),
      };
      if (state === 'allowed') {
        expect(await read(parent, {}, ctx)).toEqual(parent.chartDetail);
        expect(authorize).toHaveBeenCalledWith('verified-human', record);
        expect(scopeRequests).toBe(1);
      } else if (state === 'empty') {
        expect(await read(parent, {}, ctx)).toBeNull();
        expect(authorize).not.toHaveBeenCalled();
      } else {
        await expect(read(parent, {}, ctx)).rejects.toThrow();
        expect(scopeRequests).toBe(state === 'missing-history' ? 0 : 1);
        expect(authorize).toHaveBeenCalledTimes(
          state === 'missing-history' ? 0 : 1,
        );
      }
    },
  );
  it.each([false, true])(
    'the original chart tracker retries UNKNOWN and CASes the exact known task, adjustment=%s',
    async (adjustment) => {
      let tick: () => Promise<void>;
      const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
        callback,
      ) => {
        tick = callback;
        return 1;
      }) as any);
      const pending: any = {
        ...response,
        chartDetail: {
          queryHistoryId: record.id,
          queryId: 'native-chart-task',
          status: 'GENERATING',
          ...(adjustment
            ? { adjustment: true, adjustmentOption: { chartType: 'LINE' } }
            : {}),
        },
      };
      const result = jest.fn(async () => ({ status: 'UNKNOWN' }) as any);
      const adaptor: any = {
        getChartResult: result,
        getChartAdjustmentResult: result,
        generateChart: jest.fn(),
        adjustChart: jest.fn(),
      };
      const repository: any = {
        updateOne: jest.fn(),
        claimNativeChart: jest.fn(async (snapshot, chartDetail) => ({
          ...snapshot,
          chartDetail,
        })),
      };
      const telemetry = { sendEvent: jest.fn() };
      const Constructor = adjustment
        ? ChartAdjustmentBackgroundTracker
        : ChartBackgroundTracker;
      const tracker = new Constructor({
        wrenAIAdaptor: adaptor,
        threadResponseRepository: repository,
        telemetry: telemetry as any,
      });
      interval.mockRestore();
      tracker.addTask(pending);
      await tick();
      expect(repository.claimNativeChart).not.toHaveBeenCalled();
      expect(tracker.getTasks()[pending.id]).toEqual(pending);
      result.mockResolvedValue({
        status: 'FINISHED',
        response: {
          reasoning: 'unrecognized chart type',
          chartType: 'FUTURE_CHART',
          chartSchema: {},
        },
      });
      await tick();
      expect(repository.claimNativeChart).not.toHaveBeenCalled();
      expect(tracker.getTasks()[pending.id]).toEqual(pending);
      result.mockResolvedValue({
        status: 'FINISHED',
        response: {
          reasoning: 'original',
          chartType: 'line',
          chartSchema: { mark: 'line' },
        },
      });
      await tick();
      expect(result.mock.calls).toEqual([
        ['native-chart-task'],
        ['native-chart-task'],
        ['native-chart-task'],
      ]);
      expect(repository.claimNativeChart).toHaveBeenCalledWith(
        pending,
        expect.objectContaining({
          ...pending.chartDetail,
          status: 'FINISHED',
          chartSchema: { mark: 'line' },
        }),
      );
      expect(repository.updateOne).not.toHaveBeenCalled();
      expect(adaptor.generateChart).not.toHaveBeenCalled();
      expect(adaptor.adjustChart).not.toHaveBeenCalled();
      expect(tracker.getTasks()[pending.id]).toBeUndefined();
    },
  );
  it('the original background tracker only polls an admitted AI task; UNKNOWN retries that id without SQL/create', async () => {
    let tick: () => Promise<void>;
    const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
      callback,
    ) => {
      tick = callback;
      return 1;
    }) as any);
    const pending = {
      ...response,
      answerDetail: { ...response.answerDetail, status: 'PREPROCESSING' },
    };
    const queryService: any = { preview: jest.fn() };
    const adaptor: any = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest.fn(async () => ({ status: 'UNKNOWN' })),
    };
    const repository: any = {
      claimNativeAnswer: jest.fn(async () => pending),
      updateOne: jest.fn(),
    };
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: adaptor,
      threadResponseRepository: repository,
      projectService: {} as any,
      deployService: {} as any,
      queryService,
    });
    interval.mockRestore();
    try {
      tracker.addTask(pending);
      await tick();
      await new Promise((resolve) => setImmediate(resolve));
      expect(repository.claimNativeAnswer).not.toHaveBeenCalled();
      adaptor.getTextBasedAnswerResult.mockResolvedValue({
        status: 'SUCCEEDED',
      });
      await tick();
      await new Promise((resolve) => setImmediate(resolve));
      expect(adaptor.getTextBasedAnswerResult.mock.calls).toEqual([
        ['native-ai-task'],
        ['native-ai-task'],
      ]);
      expect(repository.claimNativeAnswer).toHaveBeenCalledWith(
        pending,
        expect.objectContaining({
          queryHistoryId: 'native-query-history',
          queryId: 'native-ai-task',
          status: 'STREAMING',
        }),
      );
      expect(adaptor.createTextBasedAnswer).not.toHaveBeenCalled();
      expect(queryService.preview).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('original answer HTTP identity and conditional history writes', () => {
  const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const originalBinding = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  const native: any = components;
  const originalRepository = native.threadResponseRepository;
  const postgres = process.env.WREN_TEST_POSTGRES_URL;
  const schema = `answer_identity_${randomUUID().replace(/-/g, '')}`;
  let database: Knex, repository: ThreadResponseRepository, server: Server;
  let origin: string, projectId: number;
  let closed: Promise<void>, close: () => void;
  let reads: Promise<any>[], writes: Promise<any>[];
  let claim: jest.SpyInstance;
  const stored = () => repository.findOneBy({ id: 71 });
  const replace = async () => {
    await repository.updateOne(71, {
      answerDetail: { queryId: 'replacement', status: 'STREAMING' },
    });
  };
  const stream = (frames: string[]) => {
    native.wrenAIAdaptor.streamTextBasedAnswer.mockResolvedValue(
      Readable.from(frames.map((frame) => Buffer.from(frame))),
    );
  };
  const get = (queryId?: string) =>
    fetch(
      `${origin}/api/ask_task/streaming_answer?responseId=71${queryId === undefined ? '' : `&queryId=${encodeURIComponent(queryId)}`}`,
    );
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
      '20241207000000_update_thread_response_for_answer.js',
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
    await database('thread').insert({ id: 81, project_id: 7 });
    repository = new ThreadResponseRepository(database);
    const service = Object.assign(Object.create(AskingService.prototype), {
      threadResponseRepository: repository,
      threadRepository: new ThreadRepository(database),
      projectService: { getCurrentProject: async () => ({ id: projectId }) },
    });
    native.askingService.getResponse.mockImplementation((id) => {
      const read = service.getResponse(id);
      reads.push(read);
      return read;
    });
    native.threadResponseRepository = repository;
    server = createServer((request, response) => {
      response.once('close', () => {
        setImmediate(() => {
          void (async () => {
            await Promise.all(reads);
            await Promise.all(writes);
            close();
          })();
        });
      });
      const query = Object.fromEntries(
        new URL(request.url, 'http://native.invalid').searchParams,
      );
      void apiResolver(
        request,
        response,
        query,
        { default: handler },
        {} as any,
        false,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    native.threadResponseRepository = originalRepository;
    if (postgres) await database.schema.dropSchemaIfExists(schema, true);
    await database.destroy();
    if (original === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    if (originalBinding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = originalBinding;
  });
  beforeEach(async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    projectId = 7;
    reads = [];
    writes = [];
    closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    await database('thread_response').delete();
    await repository.createOne({
      id: 71,
      threadId: 81,
      question: 'original',
      sql: 'SELECT 1',
      answerDetail: { queryId: 'current', status: 'STREAMING' },
    });
    native.wrenAIAdaptor.streamTextBasedAnswer.mockReset();
    const update = repository.claimNativeAnswer.bind(repository);
    claim = jest
      .spyOn(repository, 'claimNativeAnswer')
      .mockImplementation((expected, detail) => {
        const write = update(expected, detail);
        writes.push(write);
        return write;
      });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it.each([undefined, 'current'])(
    'original HTTP completion keeps the frozen query and persists only that answer, correlation=%s',
    async (queryId) => {
      stream([
        'data: {"message":"original answer"}\n\n',
        'data: {"done":true,"queryId":"current"}\n\n',
      ]);
      const response = await get(queryId);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        'data: {"message":"original answer"}\n\ndata: {"done":true}\n\n',
      );
      await closed;
      expect((await stored()).answerDetail).toMatchObject({
        queryId: 'current',
        status: 'FINISHED',
        content: 'original answer',
      });
      expect(native.wrenAIAdaptor.streamTextBasedAnswer).toHaveBeenCalledTimes(
        1,
      );
    },
  );
  it('rejects a stale browser query before consuming the replacement queue', async () => {
    await replace();
    const response = await get('current');
    expect(response.status).toBe(409);
    await response.text();
    await closed;
    expect(native.wrenAIAdaptor.streamTextBasedAnswer).not.toHaveBeenCalled();
    expect((await stored()).answerDetail).toEqual({
      queryId: 'replacement',
      status: 'STREAMING',
    });
  });
  it.each(['query', 'project'])(
    'refuses the next frame after original %s scope changes without changing the new answer',
    async (change) => {
      native.wrenAIAdaptor.streamTextBasedAnswer.mockResolvedValue(
        Readable.from(
          (async function* () {
            if (change === 'query') await replace();
            else projectId = 8;
            yield Buffer.from(
              'data: {"message":"stale body"}\n\ndata: {"done":true,"queryId":"current"}\n\n',
            );
          })(),
        ),
      );
      const response = await get('current');
      expect(await response.text()).toBe('');
      await closed;
      expect((await stored()).answerDetail).toEqual({
        queryId: change === 'query' ? 'replacement' : 'current',
        status: 'STREAMING',
      });
      expect(claim).not.toHaveBeenCalled();
    },
  );
  it('original conditional writer rejects a replacement committed after the last read but before done', async () => {
    const update = repository.claimNativeAnswer.bind(repository);
    claim.mockRestore();
    claim = jest
      .spyOn(repository, 'claimNativeAnswer')
      .mockImplementationOnce(async (expected, detail) => {
        await replace();
        return update(expected, detail);
      });
    stream(['data: {"done":true,"queryId":"current"}\n\n']);
    const response = await get('current');
    expect(await response.text()).toBe('');
    await closed;
    expect((await stored()).answerDetail).toEqual({
      queryId: 'replacement',
      status: 'STREAMING',
    });
  });
  it.each([false, true])(
    'disconnect preserves only the same original partial answer, replacement=%s',
    async (replacement) => {
      const upstream = new PassThrough();
      native.wrenAIAdaptor.streamTextBasedAnswer.mockResolvedValue(upstream);
      const response = await get('current');
      upstream.write('data: {"message":"partial"}\n\n');
      const reader = response.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        'partial',
      );
      if (replacement) await replace();
      await reader.cancel();
      await closed;
      expect((await stored()).answerDetail).toEqual(
        replacement
          ? { queryId: 'replacement', status: 'STREAMING' }
          : { queryId: 'current', status: 'INTERRUPTED', content: 'partial' },
      );
      expect(upstream.destroyed).toBe(true);
    },
  );
});

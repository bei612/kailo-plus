import {
  NativeHumanQuery,
  nativePreviewScope,
  authorizeNativeScope,
} from './apollo/server/services/nativeHumanQuery';
import { NativeQueryService } from './apollo/server/services/nativeQueryService';
import {
  ApiHistoryRepository,
  ApiType,
} from './apollo/server/repositories/apiHistoryRepository';
import {
  bindingServiceCall,
  digest,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { SqlPairResolver } from './apollo/server/resolvers/sqlPairResolver';
import { DashboardResolver } from './apollo/server/resolvers/dashboardResolver';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { getQueryPreviewText } from './utils/language';
import referenceHandler from './pages/api/platform-query-reference';
import { ApiHistoryResolver } from './apollo/server/resolvers/apiHistoryResolver';
import originalResolvers from './apollo/server/resolvers';
import { ApolloServer } from 'apollo-server-micro';
import GraphQLJSON from 'graphql-type-json';
import { typeDefs } from './apollo/server/schema';
import { API_HISTORY } from './apollo/client/graphql/apiManagement';
import { components } from './common';
import {
  ChartType,
  ChartStatus,
  TextBasedAnswerStatus,
  AskResultStatus,
  AskResultType,
} from './apollo/server/models/adaptor';
import runSqlHandler from './pages/api/v1/run_sql';
import generateSummaryHandler from './pages/api/v1/generate_summary';
import generateChartHandler from './pages/api/v1/generate_vega_chart';
import askHandler from './pages/api/v1/ask';
import streamAskHandler from './pages/api/v1/stream/ask';
import generateSqlHandler from './pages/api/v1/generate_sql';
import streamGenerateSqlHandler from './pages/api/v1/stream/generate_sql';
import { enhanceVegaSpec } from './utils/vegaSpecUtils';
import { Readable } from 'node:stream';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import { defaultApolloErrorHandler } from './apollo/server/utils/error';
import configHandler from './pages/api/config';
import { SqlPairService } from './apollo/server/services/sqlPairService';
import { SqlPairStatus } from './apollo/server/models/adaptor';
import sqlPairsHandler from './pages/api/v1/knowledge/sql_pairs';
import sqlPairHandler from './pages/api/v1/knowledge/sql_pairs/[id]';
import modelsHandler from './pages/api/v1/models';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe('original SQL-pair durable native write consumer', () => {
  const key = 'eb9081b2-1e2b-44e9-85c5-15b09e43c4a1';
  const config = {
    bindingId: '8b066261-f827-462e-95c1-1d596fce1849',
    projectId: 3,
    tenantId: 'tenant-fixture',
    workspaceId: 'workspace-fixture',
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: '3',
    requestTimeoutMs: 2000,
    requestMaxBytes: 65536,
    responseMaxBytes: 65536,
  } as NativeQueryDelivery;
  const native = {
    config,
    identityScope: 'a'.repeat(64),
    token: 'verified-native-token',
  };
  const beforeConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  let record: any;
  let generation: number;
  let status: SqlPairStatus;
  let revoked: boolean;
  let repository: any;
  let history: any;
  let adaptor: any;
  const make = () =>
    new SqlPairService({
      sqlPairRepository: repository,
      apiHistoryRepository: history,
      wrenAIAdaptor: adaptor,
      ibisAdaptor: {} as any,
    });
  beforeEach(() => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    record = undefined;
    generation = 2;
    status = SqlPairStatus.INDEXING;
    revoked = false;
    jest.mocked(loadQueryDelivery).mockReset().mockResolvedValue(config);
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockImplementation(async (_config, _operation, args) => {
        if (revoked) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        return {
          scope: {
            ...config,
            generation,
            permission: (args.authorizeScope as { permission: string })
              .permission,
            checkedRevision: 'fresh-scope-fact',
          },
        };
      });
    history = {
      count: jest.fn(async (filter) =>
        record &&
        Object.entries(filter).every(([name, value]) => record[name] === value)
          ? 1
          : 0,
      ),
      findAllWithPagination: jest.fn(async (filter) =>
        record &&
        Object.entries(filter).every(([name, value]) => record[name] === value)
          ? [JSON.parse(JSON.stringify(record))]
          : [],
      ),
      findAllBy: jest.fn(async (filter) =>
        record && record.statusCode === filter.statusCode ? [record] : [],
      ),
      findOneBy: jest.fn(async () => record),
    };
    repository = {
      prepareNativeWrite: jest.fn(async (_history, input) => {
        if (record) return { record, created: false };
        record = JSON.parse(
          JSON.stringify({
            ...input,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            requestPayload: {
              nativeSqlPair: {
                ...input.requestPayload.nativeSqlPair,
                after: {
                  id: 42,
                  projectId: config.projectId,
                  sql: 'SELECT native_column FROM native_model',
                  question: 'Original question',
                },
              },
            },
            responsePayload: { nativeId: 42, eventId: input.id },
          }),
        );
        return { record, created: true };
      }),
      completeNativeWrite: jest.fn(async () => {
        record.statusCode = 200;
        record.responsePayload.result =
          record.requestPayload.nativeSqlPair.operation === 'delete'
            ? true
            : record.requestPayload.nativeSqlPair.after;
        return record;
      }),
      findAllBy: jest.fn(async () =>
        record?.requestPayload.nativeSqlPair.operation === 'delete' &&
        record.statusCode === 200
          ? []
          : record
            ? [record.requestPayload.nativeSqlPair.after]
            : [],
      ),
    };
    adaptor = {
      deploySqlPair: jest.fn(async () => {
        throw new Error('Lost create ACK');
      }),
      deleteSqlPairs: jest.fn(async () => {
        throw new Error('Lost delete ACK');
      }),
      getSqlPairResult: jest.fn(async () => ({ status })),
    };
  });
  afterAll(() => {
    if (beforeConfig === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = beforeConfig;
  });
  const pair = {
    sql: 'SELECT native_column FROM native_model',
    question: 'Original question',
  };
  const historyFence = (identityScope = native.identityScope) => ({
    queryScope: nativePreviewScope(config, identityScope),
    generation,
  });
  it.each(['create', 'update', 'delete'])(
    'persists the original %s task before dispatch and only observes it after ACK loss or process restart',
    async (operation) => {
      const run = (service: SqlPairService) =>
        operation === 'create'
          ? service.createSqlPair(config.projectId, pair, native, key)
          : operation === 'update'
            ? service.editSqlPair(config.projectId, 42, pair, native, key)
            : service.deleteSqlPair(config.projectId, 42, native, key);
      await expect(run(make())).rejects.toMatchObject({
        extensions: {
          other: {
            nativeWrite: {
              outcome: 'UNKNOWN',
              reference: { nativeType: 'sqlPair', nativeId: 42 },
            },
          },
        },
      });
      expect(record.statusCode).toBe(202);
      expect(
        repository.prepareNativeWrite.mock.invocationCallOrder[0],
      ).toBeLessThan(
        (operation === 'delete'
          ? adaptor.deleteSqlPairs
          : adaptor.deploySqlPair
        ).mock.invocationCallOrder[0],
      );
      expect(
        (operation === 'delete'
          ? adaptor.deleteSqlPairs
          : adaptor.deploySqlPair
        ).mock.calls[0].at(-1),
      ).toMatchObject({
        taskId: key,
        requestTimeoutMs: config.requestTimeoutMs,
      });
      status = SqlPairStatus.FINISHED;
      expect(await run(make())).toEqual(
        operation === 'delete'
          ? true
          : record.requestPayload.nativeSqlPair.after,
      );
      expect(record.statusCode).toBe(200);
      expect(repository.completeNativeWrite).toHaveBeenCalledTimes(1);
      expect(
        operation === 'delete' ? adaptor.deleteSqlPairs : adaptor.deploySqlPair,
      ).toHaveBeenCalledTimes(1);
      const gets = adaptor.getSqlPairResult.mock.calls.length;
      await run(make());
      expect(adaptor.getSqlPairResult).toHaveBeenCalledTimes(gets);
      expect(
        operation === 'delete' ? adaptor.deleteSqlPairs : adaptor.deploySqlPair,
      ).toHaveBeenCalledTimes(1);
    },
  );
  it("uses the original list consumer to reconcile the same user's persisted task from another client without issuing a write", async () => {
    await expect(
      make().createSqlPair(config.projectId, pair, native, key),
    ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    expect(await make().getProjectSqlPairs(config.projectId, native)).toEqual(
      [],
    );
    status = SqlPairStatus.FINISHED;
    expect(await make().getProjectSqlPairs(config.projectId, native)).toEqual([
      {
        ...record.requestPayload.nativeSqlPair.after,
        nativeWritePending: false,
      },
    ]);
    expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
    expect(adaptor.deleteSqlPairs).not.toHaveBeenCalled();
  });
  it.each([SqlPairStatus.UNKNOWN, SqlPairStatus.FAILED, 'UNRECOGNIZED'])(
    'keeps %s unresolved and never commits or creates a replacement task',
    async (event) => {
      status = event as SqlPairStatus;
      await expect(
        make().createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      await expect(
        make().createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      expect(record.statusCode).toBe(202);
      expect(repository.completeNativeWrite).not.toHaveBeenCalled();
      expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
    },
  );
  it('discloses original API History bodies only after the same persisted native event has finished and current permission still holds', async () => {
    const service = make();
    await expect(
      service.createSqlPair(config.projectId, pair, native, key),
    ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    await expect(service.readNativeWrite(record, native)).rejects.toThrow(
      'NATIVE_EXECUTION_UNKNOWN',
    );
    status = SqlPairStatus.FINISHED;
    await expect(service.readNativeWrite(record, native)).resolves.toEqual({
      requestPayload: pair,
      responsePayload: record.requestPayload.nativeSqlPair.after,
    });
    revoked = true;
    await expect(service.readNativeWrite(record, native)).rejects.toThrow(
      'QUERY_SCOPE_DENIED',
    );
    expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
  });
  it.each([
    SqlPairStatus.INDEXING,
    SqlPairStatus.FINISHED,
    SqlPairStatus.UNKNOWN,
    SqlPairStatus.FAILED,
  ])(
    'the original history detail observes exactly one persisted SQL-pair event (%s), while page listing never polls or exposes pending bodies',
    async (event) => {
      const service = make();
      await expect(
        service.createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      status = event;
      adaptor.getSqlPairResult.mockClear();
      const resolver = new ApiHistoryResolver();
      const graphql = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: { apiHistory: resolver.getApiHistory },
          ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
        },
        context: () => ({
          nativeHumanToken: native.token,
          nativeIdentityScope: native.identityScope,
          projectService: {
            getCurrentProject: async () => ({ id: config.projectId }),
          },
          apiHistoryRepository: history,
          sqlPairService: service,
        }),
      });
      try {
        await graphql.start();
        const list = await graphql.executeOperation({
          query: API_HISTORY,
          variables: {
            filter: historyFence(),
            pagination: { offset: 0, limit: 10 },
          },
        });
        expect(list.errors).toBeUndefined();
        expect(list.data.apiHistory.items[0]).toMatchObject({
          id: key,
          statusCode: 202,
          requestPayload: null,
          responsePayload: null,
        });
        expect(adaptor.getSqlPairResult).not.toHaveBeenCalled();
        const detail = await graphql.executeOperation({
          query: API_HISTORY,
          variables: {
            filter: { id: key, ...historyFence() },
            pagination: { offset: 0, limit: 1 },
          },
        });
        expect(detail.errors).toBeUndefined();
        expect(adaptor.getSqlPairResult).toHaveBeenCalledTimes(1);
        expect(adaptor.getSqlPairResult).toHaveBeenCalledWith(key, {
          requestTimeoutMs: config.requestTimeoutMs,
          responseMaxBytes: config.responseMaxBytes,
          requestMaxBytes: config.requestMaxBytes,
        });
        expect(history.count).toHaveBeenLastCalledWith(
          {
            id: key,
            projectId: config.projectId,
            governanceBindingId: config.bindingId,
          },
          {},
        );
        if (event === SqlPairStatus.FINISHED) {
          expect(detail.data.apiHistory.items[0]).toMatchObject({
            id: key,
            statusCode: 200,
            requestPayload: pair,
            responsePayload: record.requestPayload.nativeSqlPair.after,
          });
          const again = await graphql.executeOperation({
            query: API_HISTORY,
            variables: {
              filter: { id: key, ...historyFence() },
              pagination: { offset: 0, limit: 1 },
            },
          });
          expect(again.errors).toBeUndefined();
          expect(adaptor.getSqlPairResult).toHaveBeenCalledTimes(1);
          expect(repository.completeNativeWrite).toHaveBeenCalledTimes(1);
        } else {
          expect(detail.data.apiHistory.items[0]).toMatchObject({
            id: key,
            statusCode: 202,
            requestPayload: null,
            responsePayload: null,
          });
          expect(repository.completeNativeWrite).not.toHaveBeenCalled();
        }
        expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
        expect(adaptor.deleteSqlPairs).not.toHaveBeenCalled();
      } finally {
        await graphql.stop();
      }
    },
  );
  it('refuses history metadata and exact-event observation when current membership is revoked before the original page read', async () => {
    const service = make();
    await expect(
      service.createSqlPair(config.projectId, pair, native, key),
    ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    revoked = true;
    adaptor.getSqlPairResult.mockClear();
    const ctx = {
      nativeHumanToken: native.token,
      nativeIdentityScope: native.identityScope,
      projectService: {
        getCurrentProject: async () => ({ id: config.projectId }),
      },
      apiHistoryRepository: history,
      sqlPairService: service,
    };
    await expect(
      new ApiHistoryResolver().getApiHistory(
        null,
        {
          filter: { id: key, ...historyFence() },
          pagination: { offset: 0, limit: 1 },
        },
        ctx as any,
      ),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(history.count).not.toHaveBeenCalled();
    expect(history.findAllWithPagination).not.toHaveBeenCalled();
    expect(adaptor.getSqlPairResult).not.toHaveBeenCalled();
    expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
  });
  it.each([SqlPairStatus.INDEXING, SqlPairStatus.FINISHED])(
    "does not select another current actor's same-project/same-binding event (%s)",
    async (event) => {
      const service = make();
      await expect(
        service.createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      status = event;
      if (status === SqlPairStatus.FINISHED)
        await service.readNativeWrite(record, native);
      adaptor.getSqlPairResult.mockClear();
      const ctx = {
        nativeHumanToken: native.token,
        nativeIdentityScope: 'b'.repeat(64),
        projectService: {
          getCurrentProject: async () => ({ id: config.projectId }),
        },
        apiHistoryRepository: history,
        sqlPairService: service,
      };
      await expect(
        new ApiHistoryResolver().getApiHistory(
          null,
          {
            filter: { id: key, ...historyFence(ctx.nativeIdentityScope) },
            pagination: { offset: 0, limit: 1 },
          },
          ctx as any,
        ),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(adaptor.getSqlPairResult).not.toHaveBeenCalled();
      expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['revoked', 'generation'])(
    'refuses pending history observation if %s changes during the actual original native GET',
    async (change) => {
      const service = make();
      await expect(
        service.createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      adaptor.getSqlPairResult.mockImplementation(async () => {
        if (change === 'revoked') revoked = true;
        else generation += 1;
        return { status: SqlPairStatus.INDEXING };
      });
      adaptor.getSqlPairResult.mockClear();
      const ctx = {
        nativeHumanToken: native.token,
        nativeIdentityScope: native.identityScope,
        projectService: {
          getCurrentProject: async () => ({ id: config.projectId }),
        },
        apiHistoryRepository: history,
        sqlPairService: service,
      };
      await expect(
        new ApiHistoryResolver().getApiHistory(
          null,
          {
            filter: { id: key, ...historyFence() },
            pagination: { offset: 0, limit: 1 },
          },
          ctx as any,
        ),
      ).rejects.toThrow(
        change === 'revoked' ? 'QUERY_SCOPE_DENIED' : 'QUERY_REFERENCE_CHANGED',
      );
      expect(record.statusCode).toBe(202);
      expect(repository.completeNativeWrite).not.toHaveBeenCalled();
      expect(adaptor.getSqlPairResult).toHaveBeenCalledTimes(1);
      expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
    },
  );
  it.each(
    [
      'missing scope',
      'missing generation',
      'actor ABA',
      'generation ABA',
    ].flatMap((change) =>
      [false, true].map((selected) => ({ change, selected })),
    ),
  )(
    'the original API History request refuses $change (selected $selected) before count, page or selected-event reads',
    async ({ change, selected }) => {
      const service = make();
      await expect(
        service.createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      adaptor.getSqlPairResult.mockClear();
      const filter: any = { ...(selected && { id: key }), ...historyFence() };
      if (change === 'missing scope') delete filter.queryScope;
      if (change === 'missing generation') delete filter.generation;
      if (change === 'generation ABA') generation += 1;
      // The browser's before/after config can both be A; the actual GraphQL
      // request must still reject a B identity or generation at the server.
      const ctx = {
        nativeHumanToken: native.token,
        nativeIdentityScope:
          change === 'actor ABA' ? 'b'.repeat(64) : native.identityScope,
        projectService: {
          getCurrentProject: async () => ({ id: config.projectId }),
        },
        apiHistoryRepository: history,
        sqlPairService: service,
      };
      const resolver = new ApiHistoryResolver();
      const graphql = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: { apiHistory: resolver.getApiHistory },
          ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
        },
        context: () => ctx,
      });
      try {
        await graphql.start();
        const result = await graphql.executeOperation({
          query: API_HISTORY,
          variables: { filter, pagination: { offset: 0, limit: 1 } },
        });
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toBe('QUERY_REFERENCE_CHANGED');
        expect(result.data).toBeNull();
        expect(history.count).not.toHaveBeenCalled();
        expect(history.findAllWithPagination).not.toHaveBeenCalled();
        expect(history.findOneBy).not.toHaveBeenCalled();
        expect(adaptor.getSqlPairResult).not.toHaveBeenCalled();
        expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
      } finally {
        await graphql.stop();
      }
    },
  );
  it('keeps the original never-configured History read compatible without a fabricated request scope or generation', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const count = jest.fn(async () => 0);
    const rows = jest.fn();
    const resolver = new ApiHistoryResolver();
    try {
      await expect(
        resolver.getApiHistory(
          null,
          { filter: { id: key }, pagination: { offset: 0, limit: 1 } },
          {
            apiHistoryRepository: { count, findAllWithPagination: rows },
          } as any,
        ),
      ).resolves.toEqual({ items: [], total: 0, hasMore: false });
      expect(count).toHaveBeenCalledWith({ id: key }, {});
      expect(rows).not.toHaveBeenCalled();
      expect(bindingServiceCall).not.toHaveBeenCalled();
      expect(loadQueryDelivery).not.toHaveBeenCalled();
    } finally {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    }
  });
  it('uses the actual Ask candidate consumer to withhold a pending native SQL-pair and observes the original event before returning it', async () => {
    const service = make();
    await expect(
      service.createSqlPair(config.projectId, pair, native, key),
    ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    const ctx = {
      nativeHumanToken: native.token,
      nativeIdentityScope: native.identityScope,
      sqlPairService: service,
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: config.projectId })),
      },
      sqlPairRepository: { findOneBy: jest.fn() },
    };
    const task = {
      projectId: config.projectId,
      status: AskResultStatus.FINISHED,
      response: [{ sqlpairId: 42, sql: pair.sql }],
    };
    await expect(
      (new AskingResolver() as any).transformAskingTask(task, ctx),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    status = SqlPairStatus.FINISHED;
    expect(
      (await (new AskingResolver() as any).transformAskingTask(task, ctx))
        .candidates[0].sqlPair,
    ).toEqual({
      ...record.requestPayload.nativeSqlPair.after,
      nativeWritePending: false,
    });
    expect(ctx.sqlPairRepository.findOneBy).not.toHaveBeenCalled();
    expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
  });
  it.each(['create', 'update', 'delete'])(
    'keeps the original REST %s response and recovers lost ACK through the same persisted native event',
    async (operation) => {
      const previousComponents = { ...components };
      Object.assign(components, {
        apiHistoryRepository: history,
        sqlPairService: make(),
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: config.projectId })),
        },
        telemetry: { sendEvent: jest.fn() },
      });
      const preview = jest
        .spyOn(NativeHumanQuery.prototype, 'previewSql')
        .mockResolvedValue({
          submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
          terminalStatus: 'COMPLETED',
          data: { valid: true },
        } as any);
      const server = createServer((request, response) => {
        void apiResolver(
          request,
          response,
          operation === 'create' ? {} : { id: '42' },
          {
            default: operation === 'create' ? sqlPairsHandler : sqlPairHandler,
          },
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
      const send = () =>
        fetch(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/knowledge/sql_pairs${operation === 'create' ? '' : '/42'}`,
          {
            method:
              operation === 'create'
                ? 'POST'
                : operation === 'update'
                  ? 'PUT'
                  : 'DELETE',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': key,
              'x-kailo-native-human-token': native.token,
              'x-kailo-native-identity-scope': native.identityScope,
            },
            body: JSON.stringify(operation === 'delete' ? {} : pair),
          },
        );
      try {
        const first = await send();
        expect(first.status).toBe(202);
        expect(await first.json()).toMatchObject({
          error: 'NATIVE_EXECUTION_UNKNOWN',
          nativeWrite: { reference: { nativeType: 'sqlPair', nativeId: 42 } },
        });
        status = SqlPairStatus.FINISHED;
        const recovered = await send();
        expect(recovered.status).toBe(
          operation === 'create' ? 201 : operation === 'update' ? 200 : 204,
        );
        if (operation !== 'delete')
          expect(await recovered.json()).toEqual(
            record.requestPayload.nativeSqlPair.after,
          );
        expect(
          operation === 'delete'
            ? adaptor.deleteSqlPairs
            : adaptor.deploySqlPair,
        ).toHaveBeenCalledTimes(1);
        if (operation !== 'delete')
          expect(
            preview.mock.calls.every(
              (args) =>
                args[1] === key && args[2] === pair.sql && args[5] === true,
            ),
          ).toBe(true);
        revoked = true;
        expect((await send()).status).toBe(403);
        expect(
          operation === 'delete'
            ? adaptor.deleteSqlPairs
            : adaptor.deploySqlPair,
        ).toHaveBeenCalledTimes(1);
      } finally {
        preview.mockRestore();
        for (const field of Object.keys(components))
          if (!(field in previousComponents)) delete components[field];
        Object.assign(components, previousComponents);
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
  it.each(['revoked', 'generation', 'identity', 'delivery'])(
    'does not disclose or finalize an original write after %s changes',
    async (change) => {
      await expect(
        make().createSqlPair(config.projectId, pair, native, key),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      status = SqlPairStatus.FINISHED;
      if (change === 'revoked') revoked = true;
      if (change === 'generation') generation++;
      if (change === 'delivery')
        jest
          .mocked(loadQueryDelivery)
          .mockResolvedValue({ ...config, nativeInstanceRef: 'changed' });
      await expect(
        make().createSqlPair(
          config.projectId,
          pair,
          change === 'identity'
            ? { ...native, identityScope: 'b'.repeat(64) }
            : native,
          key,
        ),
      ).rejects.toThrow();
      expect(record.statusCode).toBe(202);
      expect(repository.completeNativeWrite).not.toHaveBeenCalled();
      expect(adaptor.deploySqlPair).toHaveBeenCalledTimes(1);
    },
  );
});

describe('native saved-view HUMAN query consumer', () => {
  const key = 'eb9081b2-1e2b-44e9-85c5-15b09e43c4a1';
  const binding = '8b066261-f827-462e-95c1-1d596fce1849';
  const resource = 'f0d7d739-666c-4cdb-927b-4bad718c94e2';
  const selection = {
    viewId: 7,
    deploymentId: 12,
    deploymentHash: 'b'.repeat(40),
    limit: 10,
  };
  const statement = 'SELECT customer FROM native_model';
  const nativeProject = {
    id: 3,
    type: 'DUCKDB',
    connectionInfo: {},
    catalog: 'wrenai',
    schema: 'public',
  };
  const connection = digest({
    type: nativeProject.type,
    connectionInfo: nativeProject.connectionInfo,
    catalog: nativeProject.catalog,
    schema: nativeProject.schema,
  });
  const capturedSources = [
    { nativeType: 'model' as const, nativeId: 8, nativeName: 'native_model' },
    { nativeType: 'view' as const, nativeId: 7, nativeName: 'native_view' },
  ];
  const reference = {
    resourceId: resource,
    nativeObjectRef: JSON.stringify(selection),
    nativeRevision: digest({
      bindingId: binding,
      projectId: 3,
      connection,
      selection,
      sql: statement,
    }),
    displayName: 'saved view',
    mediaType: 'application/json',
  };
  const submission = {
    actionExecutionId: '1c52c02c-0136-4652-a8d5-2af3921edbfc',
    operationId: '5f4ccbf4-a794-48f2-8bd1-39b453e623f7',
    actionKey: 'data_query.query@v1',
    gateState: 'ALLOWED',
    dispatchState: 'DISPATCHED',
  };
  const receipt = { submission, inputReference: reference };
  const config = {
    bindingId: binding,
    projectId: 3,
    projectConnectionDigest: connection,
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: '3',
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
    humanAction: {
      resultExposurePolicyId: 'f50e30ee-a9c6-4406-8620-7e45262f3145',
      resultExposurePolicyVersion: 1,
    },
  } as NativeQueryDelivery;
  const resolution = {
    resource: {
      resourceId: resource,
      resourceVersion: 4,
      nativeType: 'view',
      nativeRef: '7',
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
    },
  };
  const calls = jest.mocked(bindingServiceCall);
  const nativeRecord = (
    frozen = reference,
    sql = statement,
    columns: { name: string; type: string }[] = [],
    data: unknown[][] = [],
  ) => {
    const captured = JSON.parse(frozen.nativeObjectRef);
    return {
      projectId: config.projectId,
      governanceBindingId: binding,
      governanceState: 'SUCCEEDED' as const,
      apiType: ApiType.RUN_SQL,
      governanceKey: key,
      governanceParameterHash: digest({
        target: { resourceId: frozen.resourceId },
        input: frozen,
      }),
      governanceDeploymentId: captured.deploymentId,
      governanceDeploymentHash: captured.deploymentHash,
      requestPayload: {
        action: 'data_query.query@v1',
        sql,
        deploymentId: captured.deploymentId,
        deploymentHash: captured.deploymentHash,
        limit: captured.limit,
        nativeSources: capturedSources,
      },
      responsePayload: {
        columns,
        data,
        deploymentId: captured.deploymentId,
        deploymentHash: captured.deploymentHash,
      },
    };
  };
  let freeze: jest.Mock, history: jest.Mock, sources: jest.Mock;
  let service: NativeHumanQuery;
  beforeEach(() => {
    calls.mockReset();
    freeze = jest.fn().mockResolvedValue(reference);
    history = jest.fn();
    sources = jest.fn().mockResolvedValue(capturedSources);
    service = new NativeHumanQuery(
      config,
      {
        reference: freeze,
        modelReference: freeze,
        completedQuerySources: sources,
      } as unknown as NativeQueryService,
      { findOneBy: history } as unknown as ApiHistoryRepository,
    );
  });

  const originalHistory = (dryRun = false) => {
    const id = '60c94d6b-9dc1-4b7c-8b55-eb17c5b0de67';
    const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
    const record = {
      ...nativeRecord(),
      id,
      governanceActionExecutionId: submission.actionExecutionId,
      governanceOperationId: submission.operationId,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    };
    record.requestPayload.action = action;
    if (dryRun)
      record.responsePayload = {
        valid: true,
        deploymentId: selection.deploymentId,
        deploymentHash: selection.deploymentHash,
      } as any;
    const completed = {
      ...receipt,
      submission: { ...submission, actionKey: action },
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: id,
    };
    history.mockResolvedValue(record);
    calls.mockImplementation(async (_config, _operation, input) => {
      if (input.authorizeScope)
        return {
          scope: {
            ...config,
            generation: 2,
            permission: (input.authorizeScope as any).permission,
            checkedRevision: 'fresh-scope-fact',
          },
        };
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    return { record, completed };
  };

  it.each([false, true])(
    'reads the original API History query/dry-run body through the same AE and never admits a command (%s)',
    async (dryRun) => {
      const { record } = originalHistory(dryRun);
      expect(
        await service.readHistory('verified-native-token', record),
      ).toEqual({
        requestPayload: record.requestPayload,
        responsePayload: record.responsePayload,
      });
      expect(calls.mock.calls[0][2]).toEqual({
        bindingId: binding,
        idempotencyKey: key,
      });
      expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ]);
      expect(calls.mock.calls.every((call) => !('command' in call[2]))).toBe(
        true,
      );
      expect(freeze).not.toHaveBeenCalled();
      expect(sources).toHaveBeenCalledTimes(2);
      expect(history).toHaveBeenLastCalledWith({
        id: record.id,
        projectId: config.projectId,
        governanceBindingId: binding,
        governanceKey: key,
        governanceActionExecutionId: submission.actionExecutionId,
        governanceOperationId: submission.operationId,
        governanceParameterHash: record.governanceParameterHash,
        governanceState: 'SUCCEEDED',
      });
    },
  );

  it.each(['absent', 'another AE', 'another native row', 'UNKNOWN'])(
    'refuses %s history receipt without a new command or native query',
    async (changed) => {
      const { record, completed } = originalHistory();
      calls.mockResolvedValue(
        changed === 'absent'
          ? null
          : changed === 'another AE'
            ? {
                ...completed,
                submission: { ...submission, actionExecutionId: binding },
              }
            : changed === 'another native row'
              ? { ...completed, nativeId: binding }
              : { ...completed, terminalStatus: 'UNKNOWN' },
      );
      await expect(
        service.readHistory('verified-native-token', record),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      expect(sources).not.toHaveBeenCalled();
      expect(freeze).not.toHaveBeenCalled();
    },
  );

  it('refuses native history mutation after source authorization instead of returning an earlier unauthorized payload', async () => {
    const { record } = originalHistory();
    history.mockResolvedValueOnce(record).mockResolvedValueOnce({
      ...record,
      requestPayload: { ...record.requestPayload, sql: 'SELECT changed' },
    });
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    expect(calls.mock.calls.at(-1)[2].sourceResources).toHaveLength(2);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('refuses the original API History body when completed native reader privileges drift', async () => {
    const { record } = originalHistory();
    sources.mockRejectedValue(
      new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
    );
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('BINDING_SCOPE_DENIED');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('rechecks native reader privileges changed during final same-AE history authorization', async () => {
    const { record, completed } = originalHistory();
    const authorize = calls.getMockImplementation();
    calls.mockImplementation(async (...args) => {
      if (args[2].sourceResources) {
        sources.mockRejectedValue(
          new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
        );
        return completed;
      }
      return authorize(...args);
    });
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('BINDING_SCOPE_DENIED');
    expect(sources).toHaveBeenCalledTimes(2);
    expect(freeze).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'consumes the original API History GraphQL document and gates both SQL request and result fields (revoked %s)',
    async (revoked) => {
      const { record } = originalHistory();
      const oldConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      const sourceReader = jest
        .spyOn(NativeQueryService.prototype, 'completedQuerySources')
        .mockImplementation(sources);
      const nativeHistory =
        components.apiHistoryRepository as ApiHistoryRepository;
      const oldReader = nativeHistory.findOneBy;
      nativeHistory.findOneBy = history;
      const ctx = {
        nativeHumanToken: 'verified-native-token',
        nativeIdentityScope: 'c'.repeat(64),
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue(nativeProject),
        },
        apiHistoryRepository: {
          count: jest.fn().mockResolvedValue(1),
          findAllWithPagination: jest.fn().mockResolvedValue([record]),
        },
      };
      if (revoked)
        sources.mockRejectedValue(
          new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
        );
      const resolver = new ApiHistoryResolver();
      const server = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: { apiHistory: resolver.getApiHistory },
          ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
        },
        context: () => ctx,
      });
      try {
        await server.start();
        const result = await server.executeOperation({
          query: API_HISTORY,
          variables: {
            filter: {
              queryScope: nativePreviewScope(config, ctx.nativeIdentityScope),
              generation: 2,
            },
            pagination: { offset: 0, limit: 10 },
          },
        });
        expect(ctx.apiHistoryRepository.count).toHaveBeenCalledWith(
          { projectId: config.projectId, governanceBindingId: binding },
          {},
        );
        expect(result.data.apiHistory.total).toBe(1);
        const visible = result.data.apiHistory.items[0];
        if (revoked) {
          expect(visible.requestPayload).toBeNull();
          expect(visible.responsePayload).toBeNull();
          expect(result.errors).toHaveLength(2);
          expect(
            result.errors.every(
              (error) => error.message === 'BINDING_SCOPE_DENIED',
            ),
          ).toBe(true);
        } else {
          expect(result.errors).toBeUndefined();
          expect(visible.requestPayload).toEqual(record.requestPayload);
          expect(visible.responsePayload).toEqual(record.responsePayload);
        }
        expect(calls.mock.calls.every((call) => !('command' in call[2]))).toBe(
          true,
        );
        expect(freeze).not.toHaveBeenCalled();
      } finally {
        await server.stop();
        sourceReader.mockRestore();
        nativeHistory.findOneBy = oldReader;
        if (oldConfig === undefined)
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = oldConfig;
      }
    },
  );

  it('rejects a foreign API History project filter before original count or row reads', async () => {
    originalHistory();
    const oldConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx = {
      nativeHumanToken: 'verified-native-token',
      nativeIdentityScope: 'c'.repeat(64),
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue(nativeProject),
      },
      apiHistoryRepository: {
        count: jest.fn(),
        findAllWithPagination: jest.fn(),
      },
    };
    try {
      await expect(
        new ApiHistoryResolver().getApiHistory(
          null,
          {
            filter: {
              projectId: config.projectId + 1,
              queryScope: nativePreviewScope(config, ctx.nativeIdentityScope),
              generation: 2,
            },
            pagination: { offset: 0, limit: 10 },
          },
          ctx as any,
        ),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(ctx.apiHistoryRepository.count).not.toHaveBeenCalled();
      expect(
        ctx.apiHistoryRepository.findAllWithPagination,
      ).not.toHaveBeenCalled();
    } finally {
      if (oldConfig === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = oldConfig;
    }
  });
  describe('original models REST current MDL consumer', () => {
    const identityScope = 'a'.repeat(64);
    const delivery = { ...config, tenantId: 'native-tenant' };
    const manifest = {
      catalog: nativeProject.catalog,
      schema: nativeProject.schema,
      models: [
        { name: 'native_model', columns: [{ name: 'original_column' }] },
      ],
      views: [
        {
          name: 'native_view',
          statement,
          properties: { viewId: '7' },
        },
      ],
      relationships: [{ name: 'original_relation' }],
    };
    const result = {
      hash: selection.deploymentHash,
      models: manifest.models,
      relationships: manifest.relationships,
      views: manifest.views,
    };
    let originalComponents: typeof components;
    let originalHistory: Record<string, unknown>;
    let originalConfig: string | undefined;
    let rows: any[];
    let deployment: any;
    let generation: number;
    let revoked: boolean;
    let sourceDenied: boolean;
    let server: Server;
    let endpoint: string;
    beforeAll(async () => {
      server = createServer((request, response) => {
        void apiResolver(
          request,
          response,
          {},
          modelsHandler,
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
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    beforeEach(() => {
      originalComponents = { ...components };
      originalHistory = { ...components.apiHistoryRepository };
      originalConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(delivery);
      rows = [];
      generation = 2;
      revoked = false;
      sourceDenied = false;
      deployment = {
        id: selection.deploymentId,
        projectId: delivery.projectId,
        hash: selection.deploymentHash,
        manifest: structuredClone(manifest),
        nativeObjectRefs: structuredClone(capturedSources),
      };
      calls.mockImplementation(async (_config, _operation, input) => {
        if (
          (revoked && input.authorizeScope) ||
          (sourceDenied && input.resolveResource)
        )
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        if (input.authorizeScope)
          return {
            scope: {
              ...delivery,
              generation,
              permission: (input.authorizeScope as any).permission,
              checkedRevision: 'fresh-models-scope',
            },
          };
        const query = input.resolveResource as any;
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      });
      Object.assign(components, {
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: delivery.projectId })),
        },
        deployService: { getLastDeployment: jest.fn(async () => deployment) },
        deployLogRepository: {
          findOneBy: jest.fn(async (filter) =>
            Object.entries(filter).every(
              ([key, value]) => deployment[key] === value,
            )
              ? structuredClone(deployment)
              : null,
          ),
        },
        queryService: { preview: jest.fn() },
        apiHistoryRepository: Object.assign(components.apiHistoryRepository, {
          createOne: jest.fn(async (input) => {
            const row = {
              ...structuredClone(input),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            rows.push(row);
            return row;
          }),
          findOneBy: jest.fn(async (filter) =>
            rows.find((row) =>
              Object.entries(filter).every(
                ([key, value]) => row[key] === value,
              ),
            ),
          ),
          count: jest.fn(async () => rows.length),
          findAllWithPagination: jest.fn(async () => rows),
        }),
      });
    });
    afterEach(() => {
      for (const key of Object.keys(components.apiHistoryRepository))
        delete components.apiHistoryRepository[key];
      Object.assign(components.apiHistoryRepository, originalHistory);
      for (const key of Object.keys(components)) delete components[key];
      Object.assign(components, originalComponents);
      if (originalConfig === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalConfig;
    });
    const send = (headers: Record<string, string> = {}) =>
      fetch(endpoint, {
        headers: {
          'x-kailo-native-human-token': 'verified-native-token',
          'x-kailo-native-identity-scope': identityScope,
          ...headers,
        },
      });
    const historyContext = () => ({
      ...components,
      nativeHumanToken: 'verified-native-token',
      nativeIdentityScope: identityScope,
      deployRepository: components.deployLogRepository,
    });
    it('returns the exact original models/views/relationships through the real REST handler and original captured Resource reader, never SQL', async () => {
      const response = await send();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(
        calls.mock.calls.filter((call) => call[2].authorizeScope),
      ).toHaveLength(5);
      expect(
        calls.mock.calls
          .filter((call) => call[2].resolveResource)
          .map((call) => (call[2].resolveResource as any).nativeRef),
      ).toEqual(['8', '7', '8', '7', '8', '7', '8', '7']);
      expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
      expect(components.queryService.preview).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        apiType: ApiType.GET_MODELS,
        governanceBindingId: delivery.bindingId,
        requestPayload: { nativeModels: { identityScope, generation: 2 } },
        responsePayload: result,
      });
    });
    it.each(['token', 'identity'])(
      'refuses a missing private %s before project, deployment or metadata access',
      async (missing) => {
        const response = await send({
          [missing === 'token'
            ? 'x-kailo-native-human-token'
            : 'x-kailo-native-identity-scope']: '',
        });
        expect(response.status).toBe(401);
        expect(await response.json()).not.toHaveProperty('models');
        expect(
          components.projectService.getCurrentProject,
        ).not.toHaveBeenCalled();
        expect(calls).not.toHaveBeenCalled();
        expect(rows).toHaveLength(0);
      },
    );
    it.each([
      'scope',
      'source',
      'generation',
      'project',
      'deployment',
      'delivery',
    ])(
      'refuses changed %s at the original metadata read without returning or logging a successful manifest',
      async (change) => {
        const authority = calls.getMockImplementation();
        let sourceRead = false;
        calls.mockImplementation(async (...args) => {
          const value = await authority(...args);
          if (args[2].resolveResource && !sourceRead) {
            sourceRead = true;
            if (change === 'scope') revoked = true;
            if (change === 'source') sourceDenied = true;
            if (change === 'generation') generation += 1;
            if (change === 'project')
              jest
                .mocked(components.projectService.getCurrentProject)
                .mockResolvedValue({ id: delivery.projectId + 1 } as any);
            if (change === 'deployment')
              deployment.manifest.catalog = 'changed';
            if (change === 'delivery')
              jest
                .mocked(loadQueryDelivery)
                .mockResolvedValue({ ...delivery, bindingId: resource });
          }
          return value;
        });
        const response = await send();
        expect([403, 409, 412]).toContain(response.status);
        expect(await response.json()).not.toHaveProperty('models');
        expect(rows).toHaveLength(0);
        expect(components.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['empty', 'unavailable'])(
      'does not fall back to the original naked manifest for %s configured delivery',
      async (change) => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
          change === 'empty' ? '' : 'configured';
        jest
          .mocked(loadQueryDelivery)
          .mockRejectedValue(new Error('Invalid controlled delivery'));
        const response = await send();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: 'QUERY_EVIDENCE_UNAVAILABLE',
        });
        expect(rows).toHaveLength(0);
      },
    );
    it.each([
      'scope',
      'source',
      'generation',
      'project',
      'deployment',
      'delivery',
    ])(
      'refuses %s changed during the original history write before returning any metadata',
      async (change) => {
        const persist = jest
          .mocked(components.apiHistoryRepository.createOne)
          .getMockImplementation();
        jest
          .mocked(components.apiHistoryRepository.createOne)
          .mockImplementation(async (...args) => {
            const row = await persist(...args);
            if (change === 'scope') revoked = true;
            if (change === 'source') sourceDenied = true;
            if (change === 'generation') generation += 1;
            if (change === 'project')
              jest
                .mocked(components.projectService.getCurrentProject)
                .mockResolvedValue({ id: delivery.projectId + 1 } as any);
            if (change === 'deployment')
              deployment.manifest.catalog = 'changed';
            if (change === 'delivery')
              jest.mocked(loadQueryDelivery).mockResolvedValue({
                ...delivery,
                bindingId: resource,
              });
            return row;
          });
        const response = await send();
        expect([403, 409, 412, 503]).toContain(response.status);
        expect(await response.json()).not.toHaveProperty('models');
        expect(rows).toHaveLength(1);
        expect(components.queryService.preview).not.toHaveBeenCalled();
        expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
      },
    );
    it('retains the exact never-configured independent manifest response and original API History record', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      const response = await send();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(calls).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty('governanceBindingId');
    });
    it.each([false, true])(
      'the real original History GraphQL fields re-read the same captured models with current source rights (revoked %s)',
      async (deny) => {
        expect((await send()).status).toBe(200);
        revoked = deny;
        const resolver = new ApiHistoryResolver();
        const graphql = new ApolloServer({
          typeDefs,
          resolvers: {
            JSON: GraphQLJSON,
            Query: { apiHistory: resolver.getApiHistory },
            ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
          },
          context: historyContext,
        });
        try {
          await graphql.start();
          const response = await graphql.executeOperation({
            query: API_HISTORY,
            variables: {
              filter: {
                queryScope: nativePreviewScope(delivery, identityScope),
                generation: 2,
              },
              pagination: { offset: 0, limit: 10 },
            },
          });
          if (deny) {
            expect(response.errors).toHaveLength(1);
            expect(response.data).toBeNull();
          } else {
            expect(response.errors).toBeUndefined();
            expect(response.data.apiHistory.items[0]).toMatchObject({
              requestPayload: null,
              responsePayload: result,
            });
          }
          expect(rows).toHaveLength(1);
          expect(components.queryService.preview).not.toHaveBeenCalled();
          expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
        } finally {
          await graphql.stop();
        }
      },
    );
    it.each([
      'actor',
      'generation',
      'source',
      'missing provenance',
      'payload',
      'deployment',
    ])(
      'the actual original metadata History reader rejects changed %s without another query or record',
      async (change) => {
        expect((await send()).status).toBe(200);
        const selected = structuredClone(rows[0]);
        const ctx = historyContext();
        if (change === 'actor') ctx.nativeIdentityScope = 'b'.repeat(64);
        if (change === 'generation') generation += 1;
        if (change === 'source') sourceDenied = true;
        if (change === 'missing provenance') {
          selected.requestPayload = {};
          rows[0].requestPayload = {};
        }
        if (change === 'payload') {
          selected.responsePayload.models = [];
          rows[0].responsePayload.models = [];
        }
        if (change === 'deployment') deployment.manifest.catalog = 'changed';
        await expect(
          new ModelResolver().readModelsHistory(selected, ctx),
        ).rejects.toBeInstanceOf(NativeQueryRefusal);
        expect(rows).toHaveLength(1);
        expect(components.queryService.preview).not.toHaveBeenCalled();
        expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
      },
    );
  });
  it.each([false, true])(
    'submits the original SQL editor with its exact query/dry-run action and policy (%s)',
    async (dryRun) => {
      const scope = 'c'.repeat(64),
        historyId = '872bff6e-4a5b-4301-a3df-3fb92fd78321';
      const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
      const frozenSelection = {
        modelId: 8,
        deploymentId: selection.deploymentId,
        deploymentHash: selection.deploymentHash,
        limit: 10,
        historyId,
      };
      const frozen = {
        ...reference,
        resourceId: binding,
        nativeObjectRef: JSON.stringify(frozenSelection),
      };
      const output = {
        ...receipt,
        submission: { ...submission, actionKey: action },
        inputReference: frozen,
      };
      const draft = { objects: capturedSources };
      const native = {
        sqlSelection: jest.fn().mockResolvedValue(draft),
        sqlReference: jest.fn().mockResolvedValue(frozen),
        sqlIntent: jest.fn().mockResolvedValue(frozenSelection),
      };
      const dryRunAction = {
        resultExposurePolicyId: 'a4f32fcf-374c-4565-a8b8-14b0f0d21c0c',
        resultExposurePolicyVersion: 2,
      };
      const human = new NativeHumanQuery(
        { ...config, dryRunAction },
        native as any,
        { findOneBy: history } as any,
      );
      calls.mockImplementation(async (_config, _operation, request) => {
        const resolved = request.resolveResource as any;
        if (resolved)
          return {
            resource: {
              ...resolution.resource,
              resourceId: resolved.nativeType === 'model' ? binding : resource,
              nativeType: resolved.nativeType,
              nativeRef: resolved.nativeRef,
            },
          };
        if (request.command)
          return {
            ...output,
            inputReference: { ...frozen, resourceId: binding },
          };
        return null;
      });
      expect(
        await human.previewSql(
          'verified-native-token',
          key,
          statement,
          10,
          scope,
          dryRun,
        ),
      ).toMatchObject({ submission: { actionKey: action } });
      expect(native.sqlSelection).toHaveBeenCalledWith(
        key,
        statement,
        10,
        scope,
        action,
        undefined,
        undefined,
        undefined,
      );
      expect(native.sqlReference).toHaveBeenCalledWith(binding, draft);
      const command = calls.mock.calls.find((call) => call[2].command)?.[2]
        .command as any;
      expect(command.componentAction).toEqual({
        actionVersion: 1,
        inputReference: frozen,
        ...(dryRun ? dryRunAction : config.humanAction),
      });
      expect(JSON.stringify(command)).not.toContain(statement);
      expect(
        calls.mock.calls.filter((call) => call[2].resolveResource),
      ).toHaveLength(4);
      expect(history).not.toHaveBeenCalled();
    },
  );

  it('never freezes or submits SQL when any current source is denied', async () => {
    const native = {
      sqlSelection: jest.fn().mockResolvedValue({ objects: capturedSources }),
      sqlReference: jest.fn(),
    };
    const human = new NativeHumanQuery(
      config,
      native as any,
      { findOneBy: history } as any,
    );
    calls
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(native.sqlReference).not.toHaveBeenCalled();
    expect(calls.mock.calls.some((call) => call[2].command)).toBe(false);
  });

  it('does not use the query output policy for an unconfigured dry run', async () => {
    await expect(
      service.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        true,
      ),
    ).rejects.toThrow('NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    expect(calls).not.toHaveBeenCalled();
  });

  it('observes the original SQL-editor UNKNOWN without another selection or command', async () => {
    const frozenSelection = { ...selection, historyId: key };
    const output = {
      ...receipt,
      inputReference: {
        ...reference,
        nativeObjectRef: JSON.stringify(frozenSelection),
      },
    };
    const native = {
      sqlSelection: jest.fn(),
      sqlReference: jest.fn(),
      sqlIntent: jest.fn().mockResolvedValue(frozenSelection),
    };
    const human = new NativeHumanQuery(
      config,
      native as any,
      { findOneBy: history } as any,
    );
    calls.mockResolvedValue(output);
    expect(
      await human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        false,
      ),
    ).toEqual(output);
    expect(native.sqlSelection).not.toHaveBeenCalled();
    expect(native.sqlReference).not.toHaveBeenCalled();
    expect(native.sqlIntent).toHaveBeenCalledWith(
      output.inputReference,
      key,
      statement,
      10,
      'c'.repeat(64),
      'data_query.query@v1',
      undefined,
      undefined,
      undefined,
    );
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('requires the original dry-run AE when native SQL-pair validation only observes', async () => {
    const native = {
      sqlSelection: jest.fn().mockResolvedValue({ objects: capturedSources }),
      sqlReference: jest.fn().mockResolvedValue(reference),
      sqlIntent: jest.fn(),
    };
    const human = new NativeHumanQuery(
      { ...config, dryRunAction: config.humanAction },
      native as any,
      { findOneBy: history } as any,
    );
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      return query
        ? {
            resource: {
              ...resolution.resource,
              nativeType: query.nativeType,
              nativeRef: query.nativeRef,
            },
          }
        : null;
    });
    await expect(
      human.previewSql(
        'verified-native-token',
        key,
        statement,
        1,
        'c'.repeat(64),
        true,
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][2]).toEqual({
      bindingId: binding,
      idempotencyKey: key,
    });
    expect(native.sqlSelection).not.toHaveBeenCalled();
    expect(native.sqlReference).not.toHaveBeenCalled();
    expect(native.sqlIntent).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  describe('original SQL-pair dry-run consumers', () => {
    let original: string | undefined;
    let ctx: any;
    let scope: string;
    let delegated: jest.SpyInstance;
    const pair = {
      id: 19,
      projectId: 3,
      sql: statement,
      question: 'Original question',
    };
    beforeEach(() => {
      original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      scope = nativePreviewScope(config, 'a'.repeat(64));
      delegated = jest
        .spyOn(NativeHumanQuery.prototype, 'previewSql')
        .mockResolvedValue({
          submission: { ...submission, actionKey: 'data_query.dry_run@v1' },
          terminalStatus: 'COMPLETED',
          data: { valid: true },
        });
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      ctx = {
        telemetry: { sendEvent: jest.fn() },
        nativeIdentityScope: 'a'.repeat(64),
        nativeHumanToken: 'verified-native-token',
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
        },
        deployService: {
          getLastDeployment: jest
            .fn()
            .mockResolvedValue({ manifest: 'original-manifest' }),
        },
        queryService: { preview: jest.fn().mockResolvedValue({}) },
        sqlPairService: {
          createSqlPair: jest.fn().mockResolvedValue(pair),
          editSqlPair: jest.fn().mockResolvedValue(pair),
        },
      };
    });
    afterEach(() => {
      delegated.mockRestore();
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    });
    const write = (
      operation: 'create' | 'update',
      changes: Record<string, any> = {},
    ) => {
      const resolver = new SqlPairResolver();
      const input = {
        data: {
          sql: statement,
          question: pair.question,
          idempotencyKey: key,
          idempotencyScope: scope,
          ...changes,
        },
        where: { id: pair.id },
      };
      return operation === 'create'
        ? resolver.createSqlPair(null, input, ctx)
        : resolver.updateSqlPair(null, input, ctx);
    };
    it.each(['create', 'update'] as const)(
      'observes the same HUMAN dry-run before original %s and never repeats bare SQL',
      async (operation) => {
        await expect(write(operation)).resolves.toEqual(pair);
        expect(delegated).toHaveBeenCalledWith(
          ctx.nativeHumanToken,
          key,
          statement,
          1,
          scope,
          true,
          undefined,
          undefined,
          undefined,
          true,
        );
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        expect(ctx.deployService.getLastDeployment).not.toHaveBeenCalled();
        const persist =
          operation === 'create'
            ? ctx.sqlPairService.createSqlPair.mock.calls[0][1]
            : ctx.sqlPairService.editSqlPair.mock.calls[0][2];
        expect(persist).toEqual({ sql: statement, question: pair.question });
        expect(JSON.stringify(persist)).not.toContain(key);
      },
    );
    it.each(['create', 'update'] as const)(
      'refuses changed identity/project before original %s',
      async (operation) => {
        await expect(
          write(operation, { idempotencyScope: 'b'.repeat(64) }),
        ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
        ctx.projectService.getCurrentProject.mockResolvedValue({ id: 99 });
        await expect(write(operation)).rejects.toThrow(
          'QUERY_IDENTITY_CHANGED',
        );
        expect(delegated).not.toHaveBeenCalled();
        expect(ctx.sqlPairService.createSqlPair).not.toHaveBeenCalled();
        expect(ctx.sqlPairService.editSqlPair).not.toHaveBeenCalled();
      },
    );
    it.each([
      { terminalStatus: 'RUNNING' },
      { terminalStatus: 'NEW_STATUS' },
      { terminalStatus: 'COMPLETED', data: { valid: false } },
      { terminalStatus: 'COMPLETED' },
    ])(
      'does not write metadata from incomplete dry-run evidence %j',
      async (changes) => {
        delegated.mockResolvedValue({
          submission: { ...submission, actionKey: 'data_query.dry_run@v1' },
          ...changes,
        });
        await expect(write('create')).rejects.toThrow(
          'QUERY_EVIDENCE_UNAVAILABLE',
        );
        await expect(write('update')).rejects.toThrow(
          'QUERY_EVIDENCE_UNAVAILABLE',
        );
        expect(ctx.sqlPairService.createSqlPair).not.toHaveBeenCalled();
        expect(ctx.sqlPairService.editSqlPair).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('propagates original same-key input/source authorization refusal without writing metadata', async () => {
      delegated.mockRejectedValue(
        new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT'),
      );
      await expect(
        write('create', { sql: 'different native SQL' }),
      ).rejects.toThrow('QUERY_INTENT_CONFLICT');
      expect(delegated.mock.calls[0][2]).toBe('different native SQL');
      expect(delegated.mock.calls[0][1]).toBe(key);
      delegated.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
      );
      await expect(write('update')).rejects.toMatchObject({ status: 403 });
      expect(ctx.sqlPairService.createSqlPair).not.toHaveBeenCalled();
      expect(ctx.sqlPairService.editSqlPair).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('retains the original no-binding dry run and permits question-only editing without SQL execution', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      await expect(
        write('create', {
          idempotencyKey: undefined,
          idempotencyScope: undefined,
        }),
      ).resolves.toEqual(pair);
      expect(ctx.queryService.preview).toHaveBeenCalledWith(statement, {
        project: { id: 3 },
        manifest: 'original-manifest',
        dryRun: true,
      });
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      ctx.queryService.preview.mockClear();
      await expect(write('update', { sql: undefined })).resolves.toEqual(pair);
      expect(delegated).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(ctx.sqlPairService.editSqlPair).toHaveBeenCalledWith(
        3,
        pair.id,
        {
          sql: undefined,
          question: pair.question,
        },
        {
          config,
          identityScope: ctx.nativeIdentityScope,
          token: ctx.nativeHumanToken,
        },
        key,
      );
    });
    it('does not fall back to standalone for present but empty or invalid delivery', async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
      jest
        .mocked(loadQueryDelivery)
        .mockRejectedValue(
          new NativeQueryRefusal(503, 'QUERY_DELIVERY_UNAVAILABLE'),
        );
      await expect(write('create')).rejects.toThrow(
        'QUERY_DELIVERY_UNAVAILABLE',
      );
      expect(delegated).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(ctx.sqlPairService.createSqlPair).not.toHaveBeenCalled();
    });
  });

  it('routes the actual SQL resolver through current HUMAN scope and never direct QueryService.preview', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    const scope = nativePreviewScope(config, 'a'.repeat(64));
    const delegated = jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockResolvedValue(receipt);
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-native-token',
      projectService: {
        getCurrentProject: jest
          .fn()
          .mockResolvedValue({ id: config.projectId }),
      },
      queryService: { preview: jest.fn() },
    };
    try {
      expect(
        await new ModelResolver().previewSql(
          null,
          {
            data: {
              sql: statement,
              limit: 10,
              dryRun: true,
              idempotencyKey: key,
              idempotencyScope: scope,
            },
          },
          ctx,
        ),
      ).toEqual({ ...receipt, previewScope: scope });
      expect(delegated).toHaveBeenCalledWith(
        'verified-native-token',
        key,
        statement,
        10,
        scope,
        true,
      );
      await expect(
        new ModelResolver().previewSql(
          null,
          {
            data: {
              sql: statement,
              limit: 10,
              idempotencyKey: key,
              idempotencyScope: 'b'.repeat(64),
            },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    } finally {
      delegated.mockRestore();
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });

  describe('original dashboard HUMAN query consumers', () => {
    let previous: string | undefined;
    let delegated: jest.SpyInstance;
    let ctx: any;
    const item = {
      id: 21,
      dashboardId: 4,
      detail: { sql: statement, chartSchema: { mark: 'bar' } },
    };
    const scope = nativePreviewScope(config, 'a'.repeat(64));
    const cache = { cacheEnabled: true, refresh: true };
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      data: {
        columns: [{ name: 'customer', type: 'VARCHAR' }],
        data: [['permitted']],
        cacheHit: true,
        cacheCreatedAt: 'original-created',
        cacheOverrodeAt: 'original-refresh',
        override: true,
      },
    };
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      delegated = jest
        .spyOn(NativeHumanQuery.prototype, 'previewSql')
        .mockResolvedValue(completed);
      ctx = {
        nativeIdentityScope: 'a'.repeat(64),
        nativeHumanToken: 'verified-native-token',
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
        },
        dashboardService: {
          getCurrentDashboard: jest
            .fn()
            .mockResolvedValue({ id: 4, projectId: 3, cacheEnabled: true }),
          getDashboardItem: jest.fn().mockResolvedValue(item),
          createDashboardItem: jest.fn().mockResolvedValue(item),
        },
        askingService: {
          getResponse: jest.fn().mockResolvedValue({
            id: 31,
            sql: statement,
            chartDetail: { chartSchema: item.detail.chartSchema },
          }),
        },
        queryService: { preview: jest.fn() },
        deployService: { getLastDeployment: jest.fn() },
      };
    });
    afterEach(() => {
      delegated.mockRestore();
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });
    const args = () => ({
      data: {
        itemId: item.id,
        refresh: true,
        limit: 10,
        idempotencyKey: key,
        idempotencyScope: scope,
      },
    });
    it('preserves original chart rows/cache metadata only after the current HUMAN query and no direct SQL', async () => {
      const result = await new DashboardResolver().previewItemSQL(
        null,
        args(),
        ctx,
      );
      expect(result).toMatchObject({
        data: [{ customer: 'permitted' }],
        cacheHit: true,
        cacheCreatedAt: 'original-created',
        cacheOverrodeAt: 'original-refresh',
        override: true,
        queryReceipt: {
          previewScope: scope,
          itemId: item.id,
          terminalStatus: 'COMPLETED',
        },
      });
      expect(result.queryReceipt.data).toBeUndefined();
      expect(delegated).toHaveBeenCalledWith(
        'verified-native-token',
        key,
        statement,
        10,
        scope,
        false,
        undefined,
        undefined,
        cache,
      );
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(ctx.dashboardService.getDashboardItem).toHaveBeenCalledTimes(2);
    });
    it.each(['RUNNING', undefined, 'NEW_STATUS'])(
      'does not expose rows or old cache times for %s evidence',
      async (terminalStatus) => {
        delegated.mockResolvedValue({ ...completed, terminalStatus });
        const result = await new DashboardResolver().previewItemSQL(
          null,
          args(),
          ctx,
        );
        expect(result).toMatchObject({
          data: [],
          cacheHit: false,
          cacheCreatedAt: null,
          cacheOverrodeAt: null,
          override: false,
        });
        expect(result.queryReceipt.data).toBeUndefined();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['', 'configured-but-unreadable'])(
      'never falls back to original SQL for an invalid configured delivery %j',
      async (configured) => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = configured;
        jest
          .mocked(loadQueryDelivery)
          .mockRejectedValue(
            new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
          );
        await expect(
          new DashboardResolver().previewItemSQL(null, args(), ctx),
        ).rejects.toThrow('QUERY_ADMISSION_UNAVAILABLE');
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        expect(delegated).not.toHaveBeenCalled();
      },
    );
    it.each(['identity', 'project'])(
      'denies a changed current %s before admission or SQL',
      async (changed) => {
        if (changed === 'identity') ctx.nativeIdentityScope = 'b'.repeat(64);
        else ctx.projectService.getCurrentProject.mockResolvedValue({ id: 99 });
        await expect(
          new DashboardResolver().previewItemSQL(null, args(), ctx),
        ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
        expect(delegated).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('refuses a native dashboard item changed while its query was observed', async () => {
      ctx.dashboardService.getDashboardItem
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce({ ...item, detail: { sql: 'changed' } });
      await expect(
        new DashboardResolver().previewItemSQL(null, args(), ctx),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('retains the exact never-configured standalone cache preview without HUMAN admission', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      ctx.deployService.getLastDeployment.mockResolvedValue({
        manifest: { original: true },
      });
      ctx.queryService.preview.mockResolvedValue(completed.data);
      expect(
        await new DashboardResolver().previewItemSQL(null, args(), ctx),
      ).toEqual({
        data: [{ customer: 'permitted' }],
        cacheHit: true,
        cacheCreatedAt: 'original-created',
        cacheOverrodeAt: 'original-refresh',
        override: true,
      });
      expect(ctx.queryService.preview).toHaveBeenCalledWith(statement, {
        project: { id: 3 },
        manifest: { original: true },
        limit: 10,
        cacheEnabled: true,
        refresh: true,
      });
      expect(delegated).not.toHaveBeenCalled();
    });
  });

  describe('original dashboard HUMAN metadata readers', () => {
    let previous: string | undefined;
    let ctx: any;
    let deployment: any;
    const item = {
      id: 21,
      dashboardId: 4,
      type: 'BAR',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      detail: { sql: statement, chartSchema: { mark: 'bar' } },
    };
    const sourceRefs = [
      { catalog: 'wrenai', schema: 'public', table: 'native_model' },
      { catalog: 'wrenai', schema: 'public', table: 'native_view' },
    ];
    const resolve = async (
      _config: any,
      _operation: string,
      input: any,
      _token?: string,
    ) => ({
      resource: {
        ...resolution.resource,
        nativeType: input.resolveResource.nativeType,
        nativeRef: input.resolveResource.nativeRef,
      },
    });
    const read = async (method: 'getDashboard' | 'getDashboardItems') =>
      new DashboardResolver()[method](null, null, ctx);
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      calls.mockImplementation(resolve);
      deployment = {
        id: selection.deploymentId,
        projectId: 3,
        hash: selection.deploymentHash,
        status: 'SUCCESS',
        manifest: {
          catalog: 'wrenai',
          schema: 'public',
          models: [{ name: 'native_model' }],
          views: [
            { name: 'native_view', statement, properties: { viewId: '7' } },
          ],
        },
        nativeObjectRefs: capturedSources,
      };
      ctx = {
        nativeHumanToken: 'verified-native-token',
        nativeIdentityScope: 'a'.repeat(64),
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
        },
        projectRepository: { findOneBy: jest.fn() },
        deployRepository: {
          findLastProjectDeployLog: jest
            .fn()
            .mockImplementation(async () => deployment),
        },
        modelRepository: {
          findOneBy: jest.fn().mockResolvedValue({
            id: 8,
            projectId: 3,
            referenceName: 'native_model',
          }),
        },
        viewRepository: {
          findOneBy: jest.fn().mockResolvedValue({
            id: 7,
            projectId: 3,
            name: 'native_view',
            statement,
          }),
        },
        queryService: {
          sourceObjects: jest.fn().mockResolvedValue(sourceRefs),
          preview: jest.fn(),
        },
        dashboardService: {
          getCurrentDashboard: jest.fn().mockResolvedValue({
            id: 4,
            projectId: 3,
            name: 'Dashboard',
            cacheEnabled: true,
            nextScheduledAt: null,
          }),
          getDashboardItems: jest.fn().mockResolvedValue([item]),
          getDashboardItem: jest.fn().mockResolvedValue(item),
          parseCronExpression: jest
            .fn()
            .mockReturnValue({ frequency: 'NEVER' }),
          createDashboardItem: jest.fn().mockResolvedValue(item),
          updateDashboardItem: jest.fn().mockResolvedValue(item),
          updateDashboardItemLayouts: jest.fn().mockResolvedValue([item]),
        },
        askingService: {
          getResponse: jest.fn().mockResolvedValue({
            id: 31,
            sql: statement,
            chartDetail: { chartSchema: item.detail.chartSchema },
          }),
        },
        deployService: {
          getLastDeployment: jest.fn().mockResolvedValue(deployment),
        },
      };
    });
    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });
    it.each(['getDashboard', 'getDashboardItems'] as const)(
      '%s preserves the full original item only after every real native source is readable twice, without SQL or admission',
      async (method) => {
        const result = await read(method);
        expect(
          method === 'getDashboard' ? (result as any).items : result,
        ).toEqual([item]);
        expect(calls).toHaveBeenCalledTimes(4);
        expect(calls.mock.calls.map((entry) => entry[2])).toEqual(
          [...capturedSources, ...capturedSources].map((source) => ({
            bindingId: binding,
            resolveResource: {
              workspaceId: config.workspaceId,
              actionKey: 'data_query.describe@v1',
              actionVersion: 1,
              nativeType: source.nativeType,
              nativeRef: String(source.nativeId),
            },
          })),
        );
        expect(
          calls.mock.calls.every((entry) => entry[3] === ctx.nativeHumanToken),
        ).toBe(true);
        expect(ctx.queryService.sourceObjects).toHaveBeenCalledTimes(2);
        expect(ctx.queryService.sourceObjects).toHaveBeenCalledWith(statement, {
          manifest: deployment.manifest,
          timeoutMs: config.requestTimeoutMs,
          responseMaxBytes: config.responseMaxBytes,
        });
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        if (method === 'getDashboard')
          expect(result).toMatchObject({
            name: 'Dashboard',
            schedule: { frequency: 'NEVER' },
            nextScheduledAt: null,
          });
      },
    );
    it.each(['getDashboard', 'getDashboardItems'] as const)(
      '%s filters only an authoritative source read denial, not a readable first source',
      async (method) => {
        calls.mockImplementation(async (...args) => {
          if ((args[2].resolveResource as any).nativeType === 'view')
            throw new NativeQueryRefusal(
              403,
              'QUERY_ADMISSION_UNAVAILABLE',
              true,
            );
          return resolve(...args);
        });
        const result = await read(method);
        expect(
          method === 'getDashboard' ? (result as any).items : result,
        ).toEqual([]);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['getDashboard', 'getDashboardItems'] as const)(
      '%s never discloses a chart whose source permission was revoked during assembly',
      async (method) => {
        let checks = 0;
        calls.mockImplementation(async (...args) => {
          if (++checks === 4)
            throw new NativeQueryRefusal(
              403,
              'QUERY_ADMISSION_UNAVAILABLE',
              true,
            );
          return resolve(...args);
        });
        const result = await read(method);
        expect(
          method === 'getDashboard' ? (result as any).items : result,
        ).toEqual([]);
      },
    );
    it.each(['getDashboard', 'getDashboardItems'] as const)(
      '%s reports unavailable authorization rather than pretending all original items disappeared',
      async (method) => {
        calls.mockRejectedValue(
          new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
        );
        await expect(read(method)).rejects.toThrow(
          'QUERY_ADMISSION_UNAVAILABLE',
        );
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['item', 'deployment', 'sources', 'native-model'])(
      'refuses original %s facts changed before assembled metadata disclosure',
      async (changed) => {
        if (changed === 'item')
          ctx.dashboardService.getDashboardItem.mockResolvedValue({
            ...item,
            detail: { ...item.detail, sql: 'changed' },
          });
        if (changed === 'deployment')
          ctx.deployRepository.findLastProjectDeployLog
            .mockResolvedValueOnce(deployment)
            .mockResolvedValue({ ...deployment, hash: 'c'.repeat(40) });
        if (changed === 'sources')
          ctx.queryService.sourceObjects
            .mockResolvedValueOnce(sourceRefs)
            .mockResolvedValue([sourceRefs[0]]);
        if (changed === 'native-model')
          ctx.modelRepository.findOneBy
            .mockResolvedValueOnce({
              id: 8,
              projectId: 3,
              referenceName: 'native_model',
            })
            .mockResolvedValue(null);
        await expect(read('getDashboard')).rejects.toThrow(
          'QUERY_REFERENCE_CHANGED',
        );
      },
    );
    it.each([
      'identity',
      'token',
      'project',
      'dashboard',
      'foreign-item',
      'invalid-delivery',
    ])(
      'rejects %s before any unauthorized metadata/SQL disclosure',
      async (changed) => {
        if (changed === 'identity') ctx.nativeIdentityScope = undefined;
        if (changed === 'token') ctx.nativeHumanToken = undefined;
        if (changed === 'project')
          ctx.projectService.getCurrentProject.mockResolvedValue({ id: 99 });
        if (changed === 'dashboard')
          ctx.dashboardService.getCurrentDashboard.mockResolvedValue({
            id: 4,
            projectId: 99,
          });
        if (changed === 'foreign-item')
          ctx.dashboardService.getDashboardItems.mockResolvedValue([
            { ...item, dashboardId: 99 },
          ]);
        if (changed === 'invalid-delivery') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(
              new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
            );
        }
        await expect(read('getDashboardItems')).rejects.toBeInstanceOf(
          NativeQueryRefusal,
        );
        expect(calls).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    const write = (operation: string) => {
      const resolver = new DashboardResolver();
      if (operation === 'pin')
        return resolver.createDashboardItem(
          null,
          { data: { itemType: 'BAR' as any, responseId: 31 } },
          ctx,
        );
      if (operation === 'layout')
        return resolver.updateDashboardItemLayouts(
          null,
          { data: { layouts: [{ itemId: item.id, x: 0, y: 0, w: 3, h: 2 }] } },
          ctx,
        );
      return resolver.updateDashboardItem(
        null,
        { where: { id: item.id }, data: { displayName: 'Original title' } },
        ctx,
      );
    };
    it.each(['pin', 'update', 'layout'])(
      'keeps the original %s write/full response after fresh source reads without a second naked query',
      async (operation) => {
        expect(await write(operation)).toEqual(
          operation === 'layout' ? [item] : item,
        );
        expect(calls).toHaveBeenCalledTimes(8);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        expect(
          ctx.dashboardService[
            operation === 'pin'
              ? 'createDashboardItem'
              : operation === 'layout'
                ? 'updateDashboardItemLayouts'
                : 'updateDashboardItem'
          ],
        ).toHaveBeenCalledTimes(1);
        if (operation === 'pin')
          expect(ctx.dashboardService.createDashboardItem).toHaveBeenCalledWith(
            {
              dashboardId: 4,
              type: 'BAR',
              sql: statement,
              chartSchema: item.detail.chartSchema,
            },
            { id: 3 },
          );
      },
    );
    it.each(['pin', 'update', 'layout'])(
      'refuses an unreadable source before the original %s metadata write',
      async (operation) => {
        calls.mockRejectedValue(
          new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true),
        );
        await expect(write(operation)).rejects.toThrow('QUERY_SCOPE_DENIED');
        expect(ctx.dashboardService.createDashboardItem).not.toHaveBeenCalled();
        expect(ctx.dashboardService.updateDashboardItem).not.toHaveBeenCalled();
        expect(
          ctx.dashboardService.updateDashboardItemLayouts,
        ).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['pin', 'update', 'layout'])(
      'does not disclose the full %s write response after a source is revoked and never repeats the write',
      async (operation) => {
        let checks = 0;
        calls.mockImplementation(async (...args) => {
          if (++checks === 8)
            throw new NativeQueryRefusal(
              403,
              'QUERY_ADMISSION_UNAVAILABLE',
              true,
            );
          return resolve(...args);
        });
        await expect(write(operation)).rejects.toThrow(
          operation === 'pin'
            ? 'NATIVE_EXECUTION_UNKNOWN'
            : 'QUERY_SCOPE_DENIED',
        );
        expect(
          ctx.dashboardService[
            operation === 'pin'
              ? 'createDashboardItem'
              : operation === 'layout'
                ? 'updateDashboardItemLayouts'
                : 'updateDashboardItem'
          ],
        ).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('retains original standalone pin cache warming, INSERT and full response without a manufactured platform Action', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      expect(await write('pin')).toEqual(item);
      expect(ctx.queryService.preview).toHaveBeenCalledWith(statement, {
        project: { id: 3 },
        manifest: deployment.manifest,
        limit: 500,
        cacheEnabled: true,
        refresh: true,
      });
      expect(ctx.dashboardService.createDashboardItem).toHaveBeenCalledTimes(1);
      expect(calls).not.toHaveBeenCalled();
    });
    it('preserves the exact never-configured standalone metadata response without creating a query or permission ticket', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      expect(await read('getDashboardItems')).toEqual([item]);
      expect(calls).not.toHaveBeenCalled();
      expect(ctx.queryService.sourceObjects).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
  });

  describe('original native project scope permission consumers', () => {
    let previous: string | undefined;
    let ctx: any;
    const scopeConfig = {
      ...config,
      tenantId: 'a153ac6a-c04e-4d35-bb3e-15c01a9c38b7',
    };
    const scopeResult = (permission: string) => ({
      scope: {
        bindingId: binding,
        generation: 2,
        tenantId: scopeConfig.tenantId,
        workspaceId: config.workspaceId,
        nativeInstanceRef: config.nativeInstanceRef,
        nativeScopeRef: config.nativeScopeRef,
        permission,
        checkedRevision: 'fresh-public-scope',
      },
    });
    const update = () =>
      originalResolvers.Mutation.updateCurrentProject(
        null,
        { data: { language: 'zh-TW' } },
        ctx,
      );
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(scopeConfig);
      calls.mockImplementation(async (_config, _operation, input) =>
        scopeResult((input.authorizeScope as any).permission),
      );
      ctx = {
        nativeHumanToken: 'verified-native-token',
        nativeIdentityScope: 'a'.repeat(64),
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue({
            id: 3,
            sampleDataset: 'fixture',
            language: 'en',
          }),
          getGeneralConnectionInfo: jest.fn().mockReturnValue({}),
          generateProjectRecommendationQuestions: jest.fn(),
        },
        projectRepository: { updateOne: jest.fn() },
        config: { wrenProductVersion: 'fixture-original-version' },
      };
    });
    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });
    it('executes the original project mutation only between two current binding manage checks without creating a query Action', async () => {
      expect(await update()).toBe(true);
      expect(ctx.projectRepository.updateOne).toHaveBeenCalledWith(3, {
        language: 'zh-TW',
      });
      expect(calls.mock.calls.map((entry) => entry.slice(1))).toEqual([
        [
          'human-action',
          { bindingId: binding, authorizeScope: { permission: 'manage' } },
          ctx.nativeHumanToken,
        ],
        [
          'human-action',
          { bindingId: binding, authorizeScope: { permission: 'manage' } },
          ctx.nativeHumanToken,
        ],
      ]);
      expect(calls.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.projectRepository.updateOne.mock.invocationCallOrder[0],
      );
      expect(calls.mock.invocationCallOrder[1]).toBeGreaterThan(
        ctx.projectRepository.updateOne.mock.invocationCallOrder[0],
      );
    });
    it.each([
      'update',
      'reset',
      'pin',
      'layout',
      'schedule',
      'model',
      'instruction',
      'sql-pair',
    ] as const)(
      'refuses denied manage before the original %s write is entered',
      async (field) => {
        calls.mockRejectedValue(
          new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
        );
        const methods = {
          update: 'updateCurrentProject',
          reset: 'resetCurrentProject',
          pin: 'createDashboardItem',
          layout: 'updateDashboardItemLayouts',
          schedule: 'setDashboardSchedule',
          model: 'createModel',
          instruction: 'createInstruction',
          'sql-pair': 'createSqlPair',
        } as const;
        await expect(
          (originalResolvers.Mutation[methods[field]] as any)(null, {}, ctx),
        ).rejects.toThrow('QUERY_SCOPE_DENIED');
        expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
        expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      },
    );
    it('checks discovery for the full original settings response without requiring project manage or SQL', async () => {
      expect(
        await originalResolvers.Query.settings(null, {}, ctx),
      ).toMatchObject({
        productVersion: 'fixture-original-version',
        language: 'en',
      });
      expect(
        calls.mock.calls.every(
          (entry) =>
            (entry[2].authorizeScope as any)?.permission === 'discover',
        ),
      ).toBe(true);
      expect(calls).toHaveBeenCalledTimes(2);
      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
    });
    it('the original browser config consumes current HUMAN discovery and only returns its authoritative binding generation', async () => {
      const response = {
        setHeader: jest.fn(),
        status: jest.fn(),
        json: jest.fn(),
      };
      response.status.mockReturnValue(response);
      await configHandler(
        {
          headers: {
            'x-kailo-native-identity-scope': ctx.nativeIdentityScope,
            'x-kailo-native-human-token': ctx.nativeHumanToken,
          },
          body: { generation: 99, tenantId: 'not-authority' },
        } as any,
        response as any,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store',
      );
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          nativeBindingConfigured: true,
          nativeBindingGeneration: 2,
          queryScope: nativePreviewScope(scopeConfig, ctx.nativeIdentityScope),
        }),
      );
      expect(calls).toHaveBeenCalledWith(
        scopeConfig,
        'human-action',
        {
          bindingId: binding,
          authorizeScope: { permission: 'discover' },
        },
        ctx.nativeHumanToken,
      );
    });
    it.each(['scope', 'token', 'generation', 'empty-config'])(
      'browser config keeps configured %s refusal closed without standalone or a reusable identity',
      async (failure) => {
        const headers: any = {
          'x-kailo-native-identity-scope': ctx.nativeIdentityScope,
          'x-kailo-native-human-token': ctx.nativeHumanToken,
        };
        if (failure === 'scope')
          delete headers['x-kailo-native-identity-scope'];
        if (failure === 'token') delete headers['x-kailo-native-human-token'];
        if (failure === 'generation') {
          const denied = scopeResult('discover');
          denied.scope.generation = 0;
          calls.mockResolvedValue(denied);
        }
        if (failure === 'empty-config') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(new Error('unreadable delivery'));
        }
        const response = {
          setHeader: jest.fn(),
          status: jest.fn(),
          json: jest.fn(),
        };
        response.status.mockReturnValue(response);
        await configHandler({ headers } as any, response as any);
        expect(response.json).toHaveBeenCalledWith(
          expect.objectContaining({
            nativeBindingConfigured: true,
            nativeBindingGeneration: undefined,
            queryScope: undefined,
          }),
        );
      },
    );
    it('does not disclose even empty native metadata when current discovery is refused', async () => {
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
      );
      await expect(
        originalResolvers.Query.settings(null, {}, ctx),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
    });
    it.each(['identity', 'token', 'project', 'config'])(
      'does not fall back to standalone for a configured invalid %s',
      async (field) => {
        if (field === 'identity') ctx.nativeIdentityScope = undefined;
        if (field === 'token') ctx.nativeHumanToken = undefined;
        if (field === 'project')
          ctx.projectService.getCurrentProject.mockResolvedValue({ id: 99 });
        if (field === 'config') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(
              new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
            );
        }
        await expect(update()).rejects.toBeInstanceOf(NativeQueryRefusal);
        expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      },
    );
    it.each([
      'bindingId',
      'tenantId',
      'workspaceId',
      'nativeInstanceRef',
      'nativeScopeRef',
      'permission',
      'checkedRevision',
      'generation',
    ])(
      'refuses malformed authoritative scope %s before original mutation',
      async (field) => {
        const response = scopeResult('manage');
        (response.scope as any)[field] = field === 'generation' ? 0 : '';
        calls.mockResolvedValue(response);
        await expect(update()).rejects.toThrow('QUERY_SCOPE_DENIED');
        expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
      },
    );
    it('marks a native write UNKNOWN after the current scope is revoked, without retry or false rollback evidence', async () => {
      calls
        .mockResolvedValueOnce(scopeResult('manage'))
        .mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
      await expect(update()).rejects.toMatchObject({
        message: 'NATIVE_EXECUTION_UNKNOWN',
        extensions: {
          other: {
            nativeWrite: {
              outcome: 'UNKNOWN',
              scope: nativePreviewScope(scopeConfig, ctx.nativeIdentityScope),
            },
          },
        },
      });
      expect(ctx.projectRepository.updateOne).toHaveBeenCalledTimes(1);
    });
    it('refuses a changed binding generation after one original write without repeating it', async () => {
      const changed = scopeResult('manage');
      changed.scope.generation++;
      calls
        .mockResolvedValueOnce(scopeResult('manage'))
        .mockResolvedValueOnce(changed);
      await expect(update()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      expect(ctx.projectRepository.updateOne).toHaveBeenCalledTimes(1);
    });
    it('carries only the original created view reference when current Resource read refuses its body', async () => {
      const row = { id: 7, projectId: 3, name: 'OriginalView', statement };
      ctx.viewRepository = {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn().mockResolvedValue(row),
        findOneBy: jest.fn().mockResolvedValue(row),
      };
      ctx.deployService = {
        getLastDeployment: jest.fn().mockResolvedValue({ manifest: {} }),
      };
      ctx.askingService = {
        getResponse: jest.fn().mockResolvedValue({ sql: statement }),
      };
      ctx.queryService = {
        describeStatement: jest
          .fn()
          .mockResolvedValue({ columns: [{ name: 'customer' }] }),
      };
      ctx.telemetry = { sendEvent: jest.fn() };
      calls.mockImplementation(async (_config, _operation, input) => {
        if (input.authorizeScope) return scopeResult('manage');
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true);
      });
      let refused: any;
      try {
        await originalResolvers.Mutation.createView(
          null,
          { data: { name: 'OriginalView', responseId: 21 } },
          ctx,
        );
      } catch (error) {
        refused = error;
      }
      expect(refused).toMatchObject({
        message: 'NATIVE_EXECUTION_UNKNOWN',
        extensions: {
          other: {
            nativeWrite: {
              outcome: 'UNKNOWN',
              scope: nativePreviewScope(scopeConfig, ctx.nativeIdentityScope),
              reference: { nativeType: 'view', nativeId: 7 },
            },
          },
        },
      });
      expect(ctx.viewRepository.createOne).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(defaultApolloErrorHandler(refused))).not.toContain(
        statement,
      );
    });
    it('preserves the original UNKNOWN evidence through the actual Apollo GraphQL error formatter', async () => {
      calls.mockResolvedValueOnce(scopeResult('manage')).mockRejectedValue(
        Object.assign(new Error('private-native-error-body'), {
          credential: 'private-secret-value',
          request: { Authorization: 'Bearer private-native-token' },
        }),
      );
      const server = new ApolloServer({
        typeDefs:
          'type Query { ready: Boolean } type Mutation { updateCurrentProject: Boolean }',
        resolvers: { Mutation: { updateCurrentProject: update } },
        formatError: defaultApolloErrorHandler,
      });
      try {
        const result = await server.executeOperation({
          query: 'mutation UpdateCurrentProject { updateCurrentProject }',
        });
        expect(result.errors?.[0]).toMatchObject({
          message: 'NATIVE_EXECUTION_UNKNOWN',
          extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
        });
        expect(result.data?.updateCurrentProject).toBeNull();
        expect(ctx.projectRepository.updateOne).toHaveBeenCalledTimes(1);
        for (const sensitive of [
          'private-native-error-body',
          'private-secret-value',
          'private-native-token',
          'originalError',
        ])
          expect(JSON.stringify(result.errors)).not.toContain(sensitive);
      } finally {
        await server.stop();
      }
    });
    it('refuses an unknown permission instead of forwarding a reusable native permission ticket', async () => {
      await expect(
        authorizeNativeScope(scopeConfig, ctx.nativeHumanToken, 'query'),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(calls).not.toHaveBeenCalled();
    });
    it('retains the original never-configured standalone project mutation', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      expect(await update()).toBe(true);
      expect(ctx.projectRepository.updateOne).toHaveBeenCalledTimes(1);
      expect(calls).not.toHaveBeenCalled();
    });
  });

  it.each(
    ['answer', 'chart', 'adjust'].flatMap((artifact) =>
      ['completed', 'unknown', 'failed', 'malformed'].map((state) => [
        artifact,
        state,
      ]),
    ),
  )(
    'original %s resolver consumes %s HUMAN SQL evidence without background SQL',
    async (artifact, state) => {
      const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      const expected: any = {
        id: 91,
        threadId: 81,
        question: 'original question',
        sql: statement,
      };
      const value: any = {
        ...receipt,
        nativeType: 'wren.api_history',
        nativeId: 'original-query-history',
        terminalStatus: 'COMPLETED',
        data: { columns: [], data: [] },
      };
      if (state === 'unknown') {
        delete value.terminalStatus;
        value.submission = { ...value.submission, dispatchState: 'UNKNOWN' };
      }
      if (state === 'failed') value.terminalStatus = 'FAILED';
      if (state === 'malformed') value.data = {};
      const sqlPreview = jest
        .spyOn(ModelResolver.prototype, 'previewSql')
        .mockResolvedValue(value);
      const ctx: any = {
        projectService: {
          getCurrentProject: jest.fn(async () => ({
            id: config.projectId,
            language: 'EN',
          })),
        },
        askingService: {
          getResponse: jest.fn(async () => expected),
          generateThreadResponseAnswer: jest.fn(async () => expected),
          generateThreadResponseChart: jest.fn(async () => expected),
          adjustThreadResponseChart: jest.fn(async () => expected),
        },
      };
      try {
        const method =
          artifact === 'answer'
            ? 'generateThreadResponseAnswer'
            : artifact === 'chart'
              ? 'generateThreadResponseChart'
              : 'adjustThreadResponseChart';
        const invoke = () => {
          const resolver = new AskingResolver();
          const args = {
            responseId: expected.id,
            idempotencyKey: key,
            idempotencyScope: 'a'.repeat(64),
          };
          if (artifact === 'adjust')
            return resolver.adjustThreadResponseChart(
              null,
              { ...args, data: { chartType: ChartType.LINE } },
              ctx,
            );
          if (artifact === 'chart')
            return resolver.generateThreadResponseChart(null, args, ctx);
          return resolver.generateThreadResponseAnswer(null, args, ctx);
        };
        if (state === 'malformed')
          await expect(invoke()).rejects.toThrow(
            'QUERY_TERMINAL_EVIDENCE_REQUIRED',
          );
        else
          expect(await invoke()).toEqual({
            ...expected,
            [artifact === 'answer' ? 'queryReceipt' : 'chartQueryReceipt']:
              value,
          });
        expect(sqlPreview).toHaveBeenCalledWith(
          null,
          {
            data: {
              sql: statement,
              projectId: String(config.projectId),
              limit: 500,
              idempotencyKey: key,
              idempotencyScope: 'a'.repeat(64),
            },
          },
          ctx,
        );
        if (state === 'completed')
          expect(ctx.askingService[method]).toHaveBeenCalledWith(
            expected.id,
            ...(artifact === 'adjust' ? [{ chartType: ChartType.LINE }] : []),
            {
              language: 'English',
              nativeQuery: {
                historyId: value.nativeId,
                expected,
                data: value.data,
              },
            },
          );
        else expect(ctx.askingService[method]).not.toHaveBeenCalled();
      } finally {
        sqlPreview.mockRestore();
        if (original === undefined)
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
      }
    },
  );
  it('submits only a saved reference through the original action and never treats dispatch as data', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(freeze).toHaveBeenCalledWith(resource, 7, 10, undefined);
    expect(calls.mock.calls[1][2]).toEqual({
      bindingId: binding,
      resolveResource: {
        workspaceId: config.workspaceId,
        actionKey: 'data_query.query@v1',
        actionVersion: 1,
        nativeType: 'view',
        nativeRef: '7',
      },
    });
    const command = calls.mock.calls[2][2].command as any;
    expect(command.resourceId).toBe(resource);
    expect(command.resourceVersion).toBe(4);
    expect(command.componentAction.inputReference).toEqual(reference);
    expect(command.idempotencyKey).toBe(key);
    expect(command.actionKey).toBe('data_query.query@v1');
    expect(history).not.toHaveBeenCalled();
  });
  it('observes the same key without re-freezing a mutable view or repeating a query', async () => {
    calls.mockResolvedValue(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('selects different registered native objects without a configured global Resource and never reselects UNKNOWN', async () => {
    const cases = [
      { kind: 'view' as const, id: 7, resourceId: resource },
      { kind: 'model' as const, id: 8, resourceId: binding },
    ];
    for (const item of cases) {
      const frozen = {
        ...reference,
        resourceId: item.resourceId,
        nativeObjectRef: JSON.stringify({
          [item.kind === 'view' ? 'viewId' : 'modelId']: item.id,
          limit: 10,
        }),
      };
      const output = { ...receipt, inputReference: frozen };
      freeze.mockResolvedValueOnce(frozen);
      calls.mockReset();
      calls
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          resource: {
            ...resolution.resource,
            resourceId: item.resourceId,
            nativeType: item.kind,
            nativeRef: String(item.id),
          },
        })
        .mockResolvedValue(output);
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect((calls.mock.calls[2][2].command as any).resourceId).toBe(
        item.resourceId,
      );
      calls.mockClear();
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][2]).toEqual({
        bindingId: binding,
        idempotencyKey: item.resourceId,
      });
    }
    expect(freeze).toHaveBeenCalledTimes(2);
  });

  it.each([
    'missing',
    'resourceId',
    'resourceVersion',
    'nativeType',
    'nativeRef',
    'nativeInstanceRef',
    'nativeScopeRef',
  ])(
    'does not freeze or submit with %s invalid registered-resource facts',
    async (field) => {
      const changed =
        field === 'missing'
          ? null
          : {
              resource: {
                ...resolution.resource,
                [field]: field === 'resourceVersion' ? 0 : 'foreign-object',
              },
            };
      calls.mockResolvedValueOnce(null).mockResolvedValueOnce(changed);
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(freeze).not.toHaveBeenCalled();
    },
  );

  it('refuses forbidden resource resolution and a submission receipt for another resolved Resource', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(freeze).not.toHaveBeenCalled();
    calls.mockReset();
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce({
        ...receipt,
        inputReference: { ...reference, resourceId: binding },
      });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
  });
  it('does not submit after an unavailable or denied observation', async () => {
    calls.mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });
  it('returns original history only for the same AE, operation, binding and a second current admission', async () => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    history.mockResolvedValue(nativeRecord());
    expect(
      (await service.preview('verified-native-token', 7, 10, key)).data,
    ).toEqual(nativeRecord().responsePayload);
    expect(history).toHaveBeenCalledWith({
      id: 'native-result',
      projectId: 3,
      governanceBindingId: binding,
      governanceActionExecutionId: submission.actionExecutionId,
      governanceOperationId: submission.operationId,
      governanceKey: key,
      governanceState: 'SUCCEEDED',
    });
    expect(calls).toHaveBeenCalledTimes(4);
    expect(sources).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[1][2]).toMatchObject({
      resolveResource: {
        actionKey: 'data_query.query@v1',
        nativeType: 'model',
        nativeRef: '8',
      },
    });
    expect(calls.mock.calls[2][2]).toMatchObject({
      resolveResource: {
        actionKey: 'data_query.query@v1',
        nativeType: 'view',
        nativeRef: '7',
      },
    });
    expect(calls.mock.calls[3][2]).toEqual({
      bindingId: binding,
      idempotencyKey: key,
      sourceResources: [
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ],
    });
    calls.mockReset();
    calls
      .mockResolvedValueOnce(completed)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
  });

  it.each([
    'another native source',
    'denied source permission',
    'changed sources during authorization',
  ])('does not disclose the original result with %s', async (failure) => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    history.mockResolvedValue(nativeRecord());
    if (failure === 'changed sources during authorization')
      sources
        .mockResolvedValueOnce(capturedSources)
        .mockResolvedValueOnce(capturedSources.slice(1));
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      if (!query) return completed;
      if (failure === 'denied source permission')
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      return {
        resource: {
          ...resolution.resource,
          nativeType: query.nativeType,
          nativeRef:
            failure === 'another native source' ? '99' : query.nativeRef,
        },
      };
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow(
      failure === 'changed sources during authorization'
        ? 'QUERY_REFERENCE_CHANGED'
        : 'QUERY_SCOPE_DENIED',
    );
    expect(
      calls.mock.calls.filter((call) => !call[2].resolveResource),
    ).toHaveLength(failure === 'changed sources during authorization' ? 2 : 1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('does not disclose completed native data when the same AE source read/export policy intersection is denied', async () => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    history.mockResolvedValue(nativeRecord());
    calls.mockImplementation(async (_config, _operation, input) => {
      if (input.sourceResources)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
      { nativeType: 'model', nativeRef: '8' },
      { nativeType: 'view', nativeRef: '7' },
    ]);
    expect(freeze).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'discloses the original SQL-editor history only after current same-AE source policy checks (dry run %s)',
    async (dryRun) => {
      const id = 'e70f46be-16d8-40ae-8bfb-38bdc28615bc';
      const selected = { ...selection, historyId: id };
      const frozen = {
        ...reference,
        nativeObjectRef: JSON.stringify(selected),
        nativeRevision: digest({
          bindingId: binding,
          projectId: config.projectId,
          connection,
          selection: selected,
          sql: statement,
        }),
      };
      const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
      const completed = {
        ...receipt,
        inputReference: frozen,
        submission: { ...submission, actionKey: action },
        terminalStatus: 'COMPLETED',
        nativeType: 'wren.api_history',
        nativeId: id,
      };
      const record = nativeRecord(frozen);
      record.requestPayload.action = action;
      if (dryRun)
        record.responsePayload = {
          valid: true,
          deploymentId: selection.deploymentId,
          deploymentHash: selection.deploymentHash,
        } as any;
      history.mockResolvedValue(record);
      const native = {
        sqlIntent: jest.fn().mockResolvedValue(selected),
        sqlSelection: jest.fn(),
        sqlReference: jest.fn(),
        completedQuerySources: sources,
      };
      const human = new NativeHumanQuery(
        { ...config, dryRunAction: config.humanAction },
        native as any,
        { findOneBy: history } as any,
      );
      calls.mockImplementation(async (_config, _operation, input) => {
        const query = input.resolveResource as any;
        if (query)
          return {
            resource: {
              ...resolution.resource,
              nativeType: query.nativeType,
              nativeRef: query.nativeRef,
            },
          };
        return completed;
      });
      const result = await human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        dryRun,
      );
      expect(result.data).toEqual(record.responsePayload);
      expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ]);
      expect(
        calls.mock.calls
          .filter((call) => call[2].resolveResource)
          .every(
            (call) => (call[2].resolveResource as any).actionKey === action,
          ),
      ).toBe(true);
      expect(native.sqlSelection).not.toHaveBeenCalled();
      expect(native.sqlReference).not.toHaveBeenCalled();
    },
  );

  it.each([
    'missing history',
    'wrong API type',
    'another intent key',
    'another parameter hash',
    'another deployment ID',
    'another deployment hash',
    'missing SQL',
    'changed SQL',
    'another action',
    'request deployment ID',
    'request deployment hash',
    'request limit',
    'result deployment ID',
    'result deployment hash',
    'missing column type',
    'invalid row width',
    'unknown selection field',
    'missing selection deployment',
  ])(
    'refuses %s in the actual HUMAN history result consumer',
    async (changed) => {
      const completed = {
        ...receipt,
        inputReference: { ...reference },
        terminalStatus: 'COMPLETED',
        nativeType: 'wren.api_history',
        nativeId: 'native-result',
      };
      const record: any = nativeRecord();
      if (changed === 'wrong API type') record.apiType = ApiType.GET_MODELS;
      if (changed === 'another intent key') record.governanceKey = binding;
      if (changed === 'another parameter hash')
        record.governanceParameterHash = 'd'.repeat(64);
      if (changed === 'another deployment ID') record.governanceDeploymentId++;
      if (changed === 'another deployment hash')
        record.governanceDeploymentHash = 'd'.repeat(40);
      if (changed === 'missing SQL') delete record.requestPayload.sql;
      if (changed === 'changed SQL')
        record.requestPayload.sql = 'SELECT private';
      if (changed === 'another action')
        record.requestPayload.action = 'data_query.dry_run@v1';
      if (changed === 'request deployment ID')
        record.requestPayload.deploymentId++;
      if (changed === 'request deployment hash')
        record.requestPayload.deploymentHash = 'd'.repeat(40);
      if (changed === 'request limit') record.requestPayload.limit++;
      if (changed === 'result deployment ID')
        record.responsePayload.deploymentId++;
      if (changed === 'result deployment hash')
        record.responsePayload.deploymentHash = 'd'.repeat(40);
      if (changed === 'missing column type')
        record.responsePayload.columns = [{ name: 'customer' }];
      if (changed === 'invalid row width') record.responsePayload.data = [[1]];
      if (changed === 'unknown selection field')
        completed.inputReference.nativeObjectRef = JSON.stringify({
          ...selection,
          source: 'untrusted',
        });
      if (changed === 'missing selection deployment')
        completed.inputReference.nativeObjectRef = JSON.stringify({
          viewId: selection.viewId,
          limit: selection.limit,
        });
      calls.mockResolvedValue(completed);
      history.mockResolvedValue(changed === 'missing history' ? null : record);
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
    },
  );
  it.each(['RUNNING', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'])(
    'consumes the original %s task receipt without inventing native result rows',
    async (terminalStatus) => {
      const observed = { ...receipt, terminalStatus };
      calls.mockResolvedValue(observed);
      expect(
        await service.preview('verified-native-token', 7, 10, key),
      ).toEqual(observed);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
      expect(history).not.toHaveBeenCalled();
    },
  );
  it.each([
    { terminalStatus: 'UNKNOWN' },
    { terminalStatus: 'SUCCESS' },
    { terminalStatus: '' },
    { terminalStatus: null },
    { terminalStatus: 7 },
    { submission: { ...submission, gateState: 'NEW_GATE' } },
    { submission: { ...submission, gateState: null } },
    { submission: { ...submission, dispatchState: 'NEW_DISPATCH' } },
    { submission: { ...submission, dispatchState: null } },
    ...['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'].map(
      (terminalStatus) => ({
        terminalStatus,
        submission: { ...submission, dispatchState: 'UNKNOWN' },
      }),
    ),
    {
      terminalStatus: 'COMPLETED',
      submission: { ...submission, dispatchState: 'UNKNOWN' },
    },
    {
      terminalStatus: 'COMPLETED',
      submission: { ...submission, gateState: 'REVOKED' },
    },
  ])(
    'refuses unknown or contradictory task receipt evidence %j',
    async (changed) => {
      calls.mockResolvedValue({ ...receipt, ...changed });
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
      expect(history).not.toHaveBeenCalled();
    },
  );
  it('rejects another saved view or resource instead of exposing the result', async () => {
    calls.mockResolvedValue({
      ...receipt,
      inputReference: { ...reference, resourceId: 'invalid-reference' },
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    calls.mockResolvedValue(receipt);
    await expect(
      service.preview('verified-native-token', 8, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });
  it('requires an actual HUMAN token and delivered resource selection', async () => {
    await expect(service.preview(undefined, 7, 10, key)).rejects.toThrow(
      'NATIVE_HUMAN_ADMISSION_UNAVAILABLE',
    );
    const disabled = new NativeHumanQuery(
      { ...config, humanAction: undefined },
      {} as NativeQueryService,
      {} as ApiHistoryRepository,
    );
    await expect(
      disabled.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    expect(calls).not.toHaveBeenCalled();
  });

  it('admits the original model preview and reconciles its frozen model reference without issuing SQL', async () => {
    const modelReference = {
      ...reference,
      nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
    };
    const modelReceipt = { ...receipt, inputReference: modelReference };
    freeze.mockResolvedValue(modelReference);
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        resource: { ...resolution.resource, nativeType: 'model' },
      })
      .mockResolvedValue(modelReceipt);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(
      (calls.mock.calls[2][2].command as any).componentAction.inputReference,
    ).toEqual(modelReference);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    await expect(
      service.preview('verified-native-token', 8, 10, key, 'model'),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });

  it('routes the actual model resolver through HUMAN admission rather than direct engine preview', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-native-token',
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
      },
      modelRepository: {
        findOneBy: jest.fn().mockResolvedValue({ id: 7, projectId: 3 }),
      },
      queryService: { preview: jest.fn() },
    };
    const modelReceipt = {
      ...receipt,
      inputReference: {
        ...reference,
        nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
      },
    };
    calls.mockResolvedValue(modelReceipt);
    const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
    expect(
      await new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: scope,
          },
        },
        ctx,
      ),
    ).toEqual({ ...modelReceipt, previewScope: scope });
    expect(ctx.modelRepository.findOneBy).toHaveBeenCalledWith({
      id: 7,
      projectId: 3,
    });
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(1);
    await expect(
      new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: 'forged',
          },
        },
        ctx,
      ),
    ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  describe('original Asking saved-view preview consumer', () => {
    const view = {
      id: 7,
      projectId: 3,
      name: 'native_view',
      statement: 'SELECT customer FROM native_model',
    };
    let ctx: any, where: any, observed: any, command: any;
    let completed: boolean;
    beforeEach(() => {
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      completed = false;
      observed = null;
      command = null;
      const response = { id: 21, threadId: 11, viewId: 7, sql: view.statement };
      ctx = {
        nativeIdentityScope: 'a'.repeat(64),
        nativeHumanToken: 'verified-native-token',
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: 3 })),
        },
        projectRepository: { findOneBy: jest.fn(async () => nativeProject) },
        askingService: {
          getResponse: jest.fn(async () => ({ ...response })),
        },
        viewRepository: {
          findOneBy: jest.fn(async () => ({ ...view })),
        },
        deployRepository: {
          findLastProjectDeployLog: jest.fn(async () => ({
            id: 12,
            projectId: 3,
            hash: 'b'.repeat(40),
            status: 'SUCCESS',
          })),
          findOneBy: jest.fn(async () => ({
            id: 12,
            projectId: 3,
            hash: 'b'.repeat(40),
            status: 'SUCCESS',
            manifest: {
              catalog: nativeProject.catalog,
              schema: nativeProject.schema,
              models: [{ name: 'native_model', columns: [] }],
              views: [
                {
                  name: view.name,
                  statement: view.statement,
                  properties: { viewId: String(view.id) },
                },
              ],
            },
            nativeObjectRefs: capturedSources,
          })),
        },
        modelRepository: {
          findOneBy: jest.fn(async () => ({
            id: 8,
            projectId: 3,
            referenceName: 'native_model',
          })),
        },
        queryService: {
          preview: jest.fn(),
          sourceObjects: jest.fn(async () => [
            {
              catalog: nativeProject.catalog,
              schema: nativeProject.schema,
              table: 'native_model',
            },
          ]),
        },
      };
      where = {
        responseId: 21,
        limit: 10,
        idempotencyKey: key,
        idempotencyScope: nativePreviewScope(config, ctx.nativeIdentityScope),
      };
      require('./common').components.apiHistoryRepository.findOneBy = history;
      history.mockImplementation(async () =>
        nativeRecord(
          command.componentAction.inputReference,
          view.statement,
          [{ name: 'customer', type: 'VARCHAR' }],
          [['native']],
        ),
      );
      calls.mockImplementation(async (_config, _operation, input, token) => {
        expect(token).toBe('verified-native-token');
        const payload = input as any;
        if (payload.resolveResource)
          return {
            resource: {
              ...resolution.resource,
              nativeType: payload.resolveResource.nativeType,
              nativeRef: payload.resolveResource.nativeRef,
            },
          };
        if (payload.command) {
          command = payload.command;
          observed = {
            submission,
            inputReference: command.componentAction.inputReference,
            ...(completed
              ? {
                  terminalStatus: 'COMPLETED',
                  nativeType: 'wren.api_history',
                  nativeId: 'native-result',
                }
              : {}),
          };
        }
        return observed;
      });
    });
    it.each([false, true])(
      'uses real original view reference/admission/result consumers without direct SQL (completed=%s)',
      async (isCompleted) => {
        completed = isCompleted;
        const result = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(result).toMatchObject({
          responseId: 21,
          viewId: 7,
          previewScope: where.idempotencyScope,
          inputReference: {
            resourceId: resource,
            nativeObjectRef: expect.any(String),
            nativeRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(JSON.parse(result.inputReference.nativeObjectRef)).toEqual({
          viewId: 7,
          deploymentId: 12,
          deploymentHash: 'b'.repeat(40),
          limit: 10,
        });
        expect(command).toMatchObject({
          actionKey: 'data_query.query@v1',
          idempotencyKey: key,
          resourceId: resource,
          resourceVersion: 4,
        });
        expect(JSON.stringify(command)).not.toContain(view.statement);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        if (completed) {
          expect(result.data).toEqual({
            columns: [{ name: 'customer', type: 'VARCHAR' }],
            data: [['native']],
            deploymentId: 12,
            deploymentHash: 'b'.repeat(40),
          });
          expect(history).toHaveBeenCalledWith({
            id: 'native-result',
            projectId: 3,
            governanceBindingId: binding,
            governanceActionExecutionId: submission.actionExecutionId,
            governanceOperationId: submission.operationId,
            governanceKey: key,
            governanceState: 'SUCCEEDED',
          });
        } else {
          expect(result).not.toHaveProperty('data');
          expect(result).not.toHaveProperty('terminalStatus');
          expect(history).not.toHaveBeenCalled();
        }
        const replay = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(replay).toEqual(result);
        expect(
          ctx.deployRepository.findLastProjectDeployLog,
        ).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['scope', 'missing', 'generated', 'changed-sql', 'denied'])(
      'refuses %s before submitting a view query',
      async (failure) => {
        if (failure === 'scope') where.idempotencyScope = 'forged';
        if (failure === 'missing')
          ctx.askingService.getResponse.mockResolvedValue(null);
        if (failure === 'generated')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: null,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'changed-sql')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: 7,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'denied')
          calls.mockRejectedValue(
            new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
          );
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['response', 'view', 'revoked'])(
      'refuses %s changes after a completed query without returning its native rows',
      async (changed) => {
        completed = true;
        const original = ctx.askingService.getResponse.getMockImplementation();
        ctx.askingService.getResponse.mockImplementation(async () => {
          const value = await original();
          if (command && changed === 'response') value.sql = 'SELECT changed';
          return value;
        });
        const originalView =
          ctx.viewRepository.findOneBy.getMockImplementation();
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          const value = await originalView();
          if (command && changed === 'view') value.statement = 'SELECT changed';
          return value;
        });
        const originalCall = calls.getMockImplementation();
        calls.mockImplementation(async (...args) => {
          if (
            command &&
            changed === 'revoked' &&
            (args[2] as any).resolveResource
          )
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return originalCall(...args);
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command.actionKey).toBe('data_query.query@v1');
        expect(history).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each([false, true])(
      'refuses a changed view before command submission even if it changes back (ABA=%s)',
      async (changesBack) => {
        completed = true;
        let reads = 0;
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          reads++;
          // The initial authorized snapshot is S1. The actual reference read
          // sees S2; an eventual re-read alone would miss S1 -> S2 -> S1.
          return {
            ...view,
            statement:
              reads >= 3 && (!changesBack || reads === 3)
                ? 'SELECT private FROM another_model'
                : view.statement,
          };
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
        expect(reads).toBe(3);
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('does not reuse a previously frozen view statement for a changed Asking intent under the same key', async () => {
      let statement = 'SELECT previous FROM native_model';
      ctx.askingService.getResponse.mockImplementation(async () => ({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: statement,
      }));
      ctx.viewRepository.findOneBy.mockImplementation(async () => ({
        ...view,
        statement,
      }));
      const first = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(first).not.toHaveProperty('data');
      const frozen = first.inputReference.nativeRevision;
      statement = view.statement;
      await expect(
        new AskingResolver().previewData(null, { where }, ctx),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command.componentAction.inputReference.nativeRevision).toBe(
        frozen,
      );
      expect(
        ctx.deployRepository.findLastProjectDeployLog,
      ).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not substitute a saved-view reference for a partial CTE', async () => {
      ctx.askingService.getResponse.mockResolvedValue({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: view.statement,
        breakdownDetail: {
          steps: [
            {
              cteName: 'partial',
              summary: 'First step',
              sql: 'SELECT private FROM forbidden_model',
            },
          ],
        },
      });
      await expect(
        new AskingResolver().previewBreakdownData(
          null,
          {
            where: { ...where, stepIndex: 0 },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command).toBeNull();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not abandon the original preview when an unrelated answer finishes streaming', async () => {
      completed = true;
      const original = ctx.askingService.getResponse.getMockImplementation();
      ctx.askingService.getResponse.mockImplementation(async () => ({
        ...(await original()),
        answerDetail: {
          content: command
            ? 'Original answer finished'
            : 'Original answer streaming',
        },
      }));
      const result = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(result.data).toEqual({
        columns: [{ name: 'customer', type: 'VARCHAR' }],
        data: [['native']],
        deploymentId: 12,
        deploymentHash: 'b'.repeat(40),
      });
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(JSON.stringify(command)).not.toContain('Original answer');
    });
  });

  it('retains one person across credential rotation and separates another person or native binding', () => {
    const first = nativePreviewScope(config, 'a'.repeat(64));
    expect(
      nativePreviewScope(
        { ...config, serviceClientSecretFile: '/rotated-credential' },
        'a'.repeat(64),
      ),
    ).toBe(first);
    expect(nativePreviewScope(config, 'b'.repeat(64))).not.toBe(first);
    expect(
      nativePreviewScope({ ...config, bindingId: resource }, 'a'.repeat(64)),
    ).not.toBe(first);
    expect(() => nativePreviewScope(config, undefined)).toThrow(
      'NATIVE_AUTHENTICATION_REQUIRED',
    );
  });

  it('refuses forged or previous-person scope at the actual preview resolver before any Core or native call', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'b'.repeat(64),
      nativeHumanToken: 'verified-native-token',
    };
    for (const idempotencyScope of [
      undefined,
      'forged',
      nativePreviewScope(config, 'a'.repeat(64)),
    ]) {
      await expect(
        new ModelResolver().previewViewData(
          null,
          {
            where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    }
    expect(calls).not.toHaveBeenCalled();
    calls.mockResolvedValue(receipt);
    const idempotencyScope = nativePreviewScope(
      config,
      ctx.nativeIdentityScope,
    );
    expect(
      await new ModelResolver().previewViewData(
        null,
        {
          where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
        },
        ctx,
      ),
    ).toEqual({ ...receipt, previewScope: idempotencyScope });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('exports only the resolved native view resource through the actual reference handler', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers: { 'x-kailo-native-human-token': 'verified-native-token' },
          query: { viewId: '7', limit: '10' },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(reference);
      expect(nativeReference).toHaveBeenCalledWith(resource, 7, 10);
      expect(calls).toHaveBeenCalledTimes(2);
      for (const call of calls.mock.calls) {
        expect(call[2]).toEqual({
          bindingId: binding,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.query@v1',
            actionVersion: 1,
            nativeType: 'view',
            nativeRef: '7',
          },
        });
        expect(call[3]).toBe('verified-native-token');
      }
    } finally {
      nativeReference.mockRestore();
    }
  });

  it.each([
    'missing-token',
    'forged-resource',
    'denied',
    'revoked',
    'changed-resource',
    'changed-version',
  ])('does not disclose an exported reference for %s', async (failure) => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    if (failure === 'denied')
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
      );
    if (failure === 'revoked')
      calls
        .mockResolvedValueOnce(resolution)
        .mockRejectedValueOnce(
          new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
        );
    if (failure === 'changed-resource' || failure === 'changed-version')
      calls.mockResolvedValueOnce(resolution).mockResolvedValueOnce({
        resource: {
          ...resolution.resource,
          ...(failure === 'changed-resource'
            ? { resourceId: binding }
            : { resourceVersion: 5 }),
        },
      });
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers:
            failure === 'missing-token'
              ? {}
              : { 'x-kailo-native-human-token': 'verified-native-token' },
          query: {
            viewId: '7',
            limit: '10',
            ...(failure === 'forged-resource' ? { resourceId: resource } : {}),
          },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(
        failure === 'missing-token'
          ? 401
          : failure === 'forged-resource'
            ? 400
            : failure.startsWith('changed-')
              ? 409
              : 403,
      );
      expect(response.json).not.toHaveBeenCalledWith(reference);
      if (['missing-token', 'forged-resource', 'denied'].includes(failure))
        expect(nativeReference).not.toHaveBeenCalled();
    } finally {
      nativeReference.mockRestore();
    }
  });

  describe('original run_sql HTTP HUMAN consumer', () => {
    let server: Server,
      endpoint: string,
      row: any,
      observed: any,
      summaryRow: any;
    let completed: boolean, revoked: boolean;
    let prepared: jest.Mock, appended: jest.Mock, direct: jest.Mock;
    let summaryCreate: jest.Mock,
      summaryGet: jest.Mock,
      summaryStream: jest.Mock;
    let prepareSummary: jest.Mock, advanceSummary: jest.Mock;
    let chartCreate: jest.Mock, chartGet: jest.Mock, chartResult: any;
    let askCreate: jest.Mock,
      askGet: jest.Mock,
      askStream: jest.Mock,
      askResult: any;
    const originalConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const originalComponents = { ...components };
    const originalHistoryMethods = { ...components.apiHistoryRepository };
    const body = { sql: statement, limit: 10 };
    const identityScope = 'a'.repeat(64);
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': key,
      'x-kailo-native-human-token': 'verified-native-token',
      'x-kailo-native-identity-scope': identityScope,
    };
    const send = (input: any = body, changes = {}, method = 'POST') =>
      fetch(endpoint, {
        method,
        headers: { ...headers, ...changes },
        ...(method !== 'GET' ? { body: JSON.stringify(input) } : {}),
      });
    const summaryBody = {
      question: 'Original question',
      sql: statement,
      sampleSize: 10,
    };
    const sendSummary = (input: any = summaryBody, changes = {}) =>
      fetch(endpoint.replace('/run_sql', '/generate_summary'), {
        method: 'POST',
        headers: { ...headers, ...changes },
        body: JSON.stringify(input),
      });
    const sendChart = (input: any = summaryBody, changes = {}) =>
      fetch(endpoint.replace('/run_sql', '/generate_vega_chart'), {
        method: 'POST',
        headers: { ...headers, ...changes },
        body: JSON.stringify(input),
      });
    const askBody = { question: 'Original question', sampleSize: 10 };
    const sendAsk = (input: any = askBody, changes = {}, streaming = false) =>
      fetch(endpoint.replace('/run_sql', streaming ? '/stream/ask' : '/ask'), {
        method: 'POST',
        headers: { ...headers, ...changes },
        body: JSON.stringify(input),
      });

    beforeAll(async () => {
      server = createServer((request, response) => {
        void apiResolver(
          request,
          response,
          {},
          {
            default: request.url?.endsWith('/stream/ask')
              ? streamAskHandler
              : request.url?.endsWith('/ask')
                ? askHandler
                : request.url?.endsWith('/stream/generate_sql')
                  ? streamGenerateSqlHandler
                  : request.url?.endsWith('/generate_sql')
                    ? generateSqlHandler
                    : request.url?.endsWith('/generate_summary')
                      ? generateSummaryHandler
                      : request.url?.endsWith('/generate_vega_chart')
                        ? generateChartHandler
                        : runSqlHandler,
          },
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
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/run_sql`;
    });

    beforeEach(() => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      row = undefined;
      summaryRow = undefined;
      observed = null;
      completed = true;
      revoked = false;
      askResult = {
        status: AskResultStatus.FINISHED,
        type: AskResultType.TEXT_TO_SQL,
        response: [{ sql: statement }],
      };
      askCreate = jest.fn(async (input) => ({ queryId: input.queryId }));
      askGet = jest.fn(async () => structuredClone(askResult));
      askStream = jest.fn(async () =>
        Readable.from([
          'data: {"message":"Original explanation"}\n\n',
          `data: ${JSON.stringify({ done: true, queryId: key })}\n\n`,
        ]),
      );
      direct = jest.fn(async () => ({ columns: [], data: [] }));
      prepared = jest.fn(async (input) => {
        row ??= input;
        return row;
      });
      appended = jest.fn(async (input) => input);
      summaryCreate = jest.fn(async (input) => ({ queryId: input.queryId }));
      summaryGet = jest.fn(async () => ({
        status: TextBasedAnswerStatus.SUCCEEDED,
      }));
      chartResult = {
        status: ChartStatus.FINISHED,
        response: {
          reasoning: 'Original',
          chartType: ChartType.BAR,
          chartSchema: {
            title: 'Original chart',
            mark: 'bar',
            encoding: {
              x: { field: 'customer', type: 'nominal' },
              y: { aggregate: 'count', type: 'quantitative' },
            },
          },
        },
      };
      chartCreate = jest.fn(async (input) => ({ queryId: input.queryId }));
      chartGet = jest.fn(async () => structuredClone(chartResult));
      summaryStream = jest.fn(async () =>
        Readable.from([
          'data: {"message":"Original "}\n\n',
          'data: {"message":"summary"}\n\n',
          `data: ${JSON.stringify({ done: true, queryId: key })}\n\n`,
        ]),
      );
      prepareSummary = jest.fn(async (input) => {
        const created = !summaryRow;
        summaryRow ??= {
          ...structuredClone(input),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return digest(summaryRow.requestPayload) ===
          digest(input.requestPayload) &&
          summaryRow.threadId === input.threadId &&
          summaryRow.apiType === input.apiType &&
          summaryRow.projectId === input.projectId &&
          summaryRow.governanceBindingId === input.governanceBindingId
          ? { record: structuredClone(summaryRow), created }
          : null;
      });
      advanceSummary = jest.fn(
        async (expected, responsePayload, statusCode, durationMs) => {
          if (
            summaryRow.statusCode !== 202 ||
            expected.statusCode !== 202 ||
            digest(summaryRow.requestPayload) !==
              digest(expected.requestPayload) ||
            digest(summaryRow.responsePayload) !==
              digest(expected.responsePayload)
          )
            return null;
          summaryRow = {
            ...summaryRow,
            responsePayload,
            statusCode,
            durationMs,
          };
          return structuredClone(summaryRow);
        },
      );
      const deployment = {
        id: 12,
        projectId: config.projectId,
        hash: selection.deploymentHash,
        status: 'SUCCESS',
        manifest: {
          catalog: nativeProject.catalog,
          schema: nativeProject.schema,
          models: [{ name: 'native_model', columns: [] }],
        },
        nativeObjectRefs: [capturedSources[0]],
      };
      Object.assign(components, {
        projectService: {
          getCurrentProject: jest.fn(async () => nativeProject),
        },
        projectRepository: { findOneBy: jest.fn(async () => nativeProject) },
        deployService: { getLastDeployment: jest.fn(async () => deployment) },
        deployLogRepository: {
          findLastProjectDeployLog: jest.fn(async () => deployment),
          findOneBy: jest.fn(async () => deployment),
        },
        queryService: {
          preview: direct,
          sourceObjects: jest.fn(async () => [
            {
              catalog: nativeProject.catalog,
              schema: nativeProject.schema,
              table: 'native_model',
            },
          ]),
        },
        modelRepository: {
          findOneBy: jest.fn(async () => ({
            id: 8,
            projectId: config.projectId,
            referenceName: 'native_model',
          })),
        },
        wrenAIAdaptor: {
          ask: askCreate,
          getAskResult: askGet,
          getAskStreamingResult: askStream,
          createTextBasedAnswer: summaryCreate,
          getTextBasedAnswerResult: summaryGet,
          streamTextBasedAnswer: summaryStream,
          generateChart: chartCreate,
          getChartResult: chartGet,
        },
      });
      Object.assign(components.apiHistoryRepository, {
        prepareNativeSql: prepared,
        prepareNativeGeneration: prepareSummary,
        advanceNativeGeneration: advanceSummary,
        createOne: appended,
        findAllBy: jest.fn(async (where) =>
          [row, summaryRow].filter(
            (candidate) =>
              candidate &&
              Object.entries(where).every(
                ([name, value]) => candidate[name] === value,
              ),
          ),
        ),
        findOneBy: jest.fn(async (where) =>
          [row, summaryRow].find(
            (candidate) =>
              candidate &&
              Object.entries(where).every(
                ([name, value]) => candidate[name] === value,
              ),
          ),
        ),
      });
      calls.mockImplementation(async (_config, _operation, input) => {
        if (input.authorizeScope)
          return {
            scope: {
              ...config,
              generation: 2,
              permission: (input.authorizeScope as any).permission,
              checkedRevision: 'fresh-scope-fact',
            },
          };
        if (input.resolveResource) {
          const source = input.resolveResource as any;
          return {
            resource: {
              ...resolution.resource,
              nativeType: source.nativeType,
              nativeRef: source.nativeRef,
            },
          };
        }
        if (revoked && input.sourceResources)
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        if (input.command) {
          const command = input.command as any;
          observed = {
            ...receipt,
            inputReference: command.componentAction.inputReference,
            ...(completed
              ? {
                  terminalStatus: 'COMPLETED',
                  nativeType: 'wren.api_history',
                  nativeId: row.id,
                }
              : { submission: { ...submission, dispatchState: 'UNKNOWN' } }),
          };
          if (completed)
            Object.assign(row, {
              governanceState: 'SUCCEEDED',
              governanceActionExecutionId: submission.actionExecutionId,
              governanceOperationId: submission.operationId,
              governanceParameterHash: digest({
                target: { resourceId: observed.inputReference.resourceId },
                input: observed.inputReference,
              }),
              responsePayload: {
                columns: [{ name: 'customer', type: 'VARCHAR' }],
                data: [['native']],
                deploymentId: 12,
                deploymentHash: selection.deploymentHash,
              },
            });
        }
        return observed;
      });
    });

    describe('original generate_sql HUMAN-only native consumer', () => {
      const input = { question: 'Original SQL question' };
      const generate = (streaming = false, body = input, changes = {}) =>
        fetch(
          endpoint.replace(
            '/run_sql',
            streaming ? '/stream/generate_sql' : '/generate_sql',
          ),
          {
            method: 'POST',
            headers: { ...headers, ...changes },
            body: JSON.stringify(body),
          },
        );
      const noExecution = () => {
        expect(direct).not.toHaveBeenCalled();
        expect(summaryCreate).not.toHaveBeenCalled();
        expect(askStream).not.toHaveBeenCalled();
        expect(
          components.apiHistoryRepository.prepareNativeSql,
        ).not.toHaveBeenCalled();
        expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
      };
      it.each([false, true])(
        'retains the original SQL response/SSE and finished task without executing SQL or summary (stream=%s)',
        async (streaming) => {
          const response = await generate(streaming);
          expect(response.status).toBe(200);
          if (streaming) {
            const body = await response.text();
            expect(body).toContain('message_start');
            expect(body).toContain('sql_generation_success');
            expect(body).toContain(statement);
            expect(body).toContain('message_stop');
            expect(body).not.toContain('summary_generation');
          } else
            expect(await response.json()).toEqual({
              id: key,
              sql: statement,
              threadId: key,
            });
          expect(summaryRow.apiType).toBe(
            streaming ? ApiType.STREAM_GENERATE_SQL : ApiType.GENERATE_SQL,
          );
          expect(summaryRow.statusCode).toBe(200);
          expect(
            summaryRow.requestPayload.nativeAsk.metadataReference,
          ).toMatchObject({
            queryScope: nativePreviewScope(config, identityScope),
            generation: 2,
          });
          expect(askCreate).toHaveBeenCalledTimes(1);
          expect(askCreate.mock.calls[0][0]).toMatchObject({
            queryId: key,
            deployId: selection.deploymentHash,
          });
          expect((await generate(streaming)).status).toBe(200);
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each([false, true])(
        'observes the same original SQL generation after a lost create ACK (stream=%s)',
        async (streaming) => {
          askCreate.mockRejectedValue(new Error('lost native ACK'));
          expect((await generate(streaming)).status).toBe(200);
          expect((await generate(streaming)).status).toBe(200);
          expect(askGet).toHaveBeenCalledWith(key);
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each([false, true])(
        'preserves the never-configured standalone SQL generation without a fabricated scope or key (stream=%s)',
        async (streaming) => {
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
          askCreate.mockResolvedValue({ queryId: 'original-independent-task' });
          const response = await generate(streaming, input, {
            'idempotency-key': '',
            'x-kailo-native-human-token': '',
            'x-kailo-native-identity-scope': '',
          });
          expect(response.status).toBe(200);
          if (streaming) {
            const body = await response.text();
            expect(body).toContain('sql_generation_success');
            expect(body).toContain('message_stop');
          } else
            expect(await response.json()).toMatchObject({
              sql: statement,
              threadId: expect.any(String),
              id: expect.any(String),
            });
          expect(askGet).toHaveBeenCalledWith('original-independent-task');
          expect(askCreate).toHaveBeenCalledTimes(1);
          expect(prepareSummary).not.toHaveBeenCalled();
          expect(calls).not.toHaveBeenCalled();
          expect(appended).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each(['missing-cache', 'future-status', 'foreign-ACK'])(
        'keeps %s SQL generation UNKNOWN and never creates a replacement task',
        async (mode) => {
          if (mode === 'missing-cache')
            askGet.mockRejectedValue(new Error('missing cache'));
          if (mode === 'future-status') askResult.status = 'future';
          if (mode === 'foreign-ACK')
            askCreate.mockResolvedValue({ queryId: 'foreign' });
          const first = await generate(true);
          const body = await first.text();
          expect(body).not.toContain('sql_generation_success');
          expect(body).not.toContain('message_stop');
          expect(body).toContain('202');
          if (mode === 'foreign-ACK')
            askGet.mockRejectedValue(new Error('missing actual task'));
          const repeat = await generate();
          // The original stream/nonstream identities cannot substitute each other.
          expect(repeat.status).toBe(409);
          expect((await generate(true)).status).toBe(200);
          expect(askCreate).toHaveBeenCalledTimes(1);
          expect(summaryRow.statusCode).toBe(202);
          noExecution();
        },
      );
      it.each(['token', 'identity', 'empty-config', 'denied-source'])(
        'refuses configured %s before the original SQL generation POST',
        async (mode) => {
          if (mode === 'empty-config') {
            process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
            jest
              .mocked(loadQueryDelivery)
              .mockRejectedValue(new Error('invalid delivery'));
          }
          if (mode === 'denied-source') {
            const authority = calls.getMockImplementation();
            calls.mockImplementation(async (...args) => {
              if (args[2].resolveResource)
                throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
              return authority(...args);
            });
          }
          const response = await generate(
            false,
            input,
            mode === 'token'
              ? { 'x-kailo-native-human-token': '' }
              : mode === 'identity'
                ? { 'x-kailo-native-identity-scope': '' }
                : {},
          );
          expect([401, 403, 503]).toContain(response.status);
          expect(await response.json()).not.toHaveProperty('sql');
          expect(askCreate).not.toHaveBeenCalled();
          noExecution();
        },
      );
      it.each(['question', 'identity', 'dialect', 'surface'])(
        'does not substitute the original completed generation with a changed %s intent',
        async (mode) => {
          expect((await generate()).status).toBe(200);
          const response = await generate(
            mode === 'surface',
            {
              ...input,
              ...(mode === 'question' ? { question: 'Changed' } : {}),
              ...(mode === 'dialect' ? { returnSqlDialect: true } : {}),
            },
            mode === 'identity'
              ? { 'x-kailo-native-identity-scope': 'b'.repeat(64) }
              : {},
          );
          expect(response.status).toBe(409);
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each(['scope', 'source', 'generation'])(
        'withholds SQL success if %s changes during the original terminal history write',
        async (mode) => {
          const advance = advanceSummary.getMockImplementation();
          advanceSummary.mockImplementation(async (...args) => {
            const result = await advance(...args);
            if (args[2] === 200) {
              const authority = calls.getMockImplementation();
              calls.mockImplementation(async (...call) => {
                if (
                  (mode === 'scope' && call[2].authorizeScope) ||
                  (mode === 'source' && call[2].resolveResource)
                )
                  throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
                const value = await authority(...call);
                if (mode === 'generation' && value?.scope)
                  value.scope.generation = 3;
                return value;
              });
            }
            return result;
          });
          const response = await generate(true);
          const body = await response.text();
          expect(body).not.toContain('sql_generation_success');
          expect(body).not.toContain('message_stop');
          expect(body).toContain('error');
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each(['DUCKDB', 'POSTGRES'])(
        'uses the original %s native SQL dialect converter only, with the captured manifest and no execution',
        async (type) => {
          jest
            .mocked(components.projectService.getCurrentProject)
            .mockResolvedValue({ ...nativeProject, type } as any);
          const convert = jest.fn(async () => 'original native dialect SQL');
          Object.assign(components, {
            wrenEngineAdaptor: { getNativeSQL: convert },
            ibisAdaptor: { getNativeSql: convert },
          });
          const response = await generate(false, {
            ...input,
            returnSqlDialect: true,
          } as any);
          expect(response.status).toBe(200);
          expect((await response.json()).sql).toBe(
            'original native dialect SQL',
          );
          expect(convert).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(convert.mock.calls[0])).toContain(
            'native_model',
          );
          expect(
            (await generate(false, { ...input, returnSqlDialect: true } as any))
              .status,
          ).toBe(200);
          expect(convert).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each(['', undefined])(
        'retains the original empty native-converter fallback (%s) without claiming converted SQL',
        async (output) => {
          const convert = jest.fn(async () => output);
          Object.assign(components, {
            wrenEngineAdaptor: { getNativeSQL: convert },
            ibisAdaptor: { getNativeSql: convert },
          });
          const body = { ...input, returnSqlDialect: true } as any;
          const response = await generate(false, body);
          expect(response.status).toBe(200);
          expect((await response.json()).sql).toBe(askResult.response[0].sql);
          expect(summaryRow.responsePayload.nativeAsk.nativeSql).toBe(
            output ?? null,
          );
          expect((await generate(false, body)).status).toBe(200);
          expect(convert).toHaveBeenCalledTimes(1);
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each([AskResultType.GENERAL, AskResultType.MISLEADING_QUERY])(
        'preserves original confirmed %s non-SQL classification without a query or replacement task',
        async (type) => {
          askResult = {
            status: AskResultStatus.FINISHED,
            type,
            intentReasoning: 'Original non-SQL explanation',
          };
          const first = await generate();
          expect(first.status).toBe(400);
          expect(await first.json()).toMatchObject({
            code: 'NON_SQL_QUERY',
            error: 'Original non-SQL explanation',
          });
          expect((await generate()).status).toBe(400);
          expect(askCreate).toHaveBeenCalledTimes(1);
          noExecution();
        },
      );
      it.each([false, true])(
        'uses the original generation History GraphQL consumer with current source read (revoked=%s)',
        async (denied) => {
          expect((await generate()).status).toBe(200);
          Object.assign(components.apiHistoryRepository, {
            count: jest.fn(async () => 1),
            findAllWithPagination: jest.fn(async () => [summaryRow]),
          });
          if (denied) {
            const authority = calls.getMockImplementation();
            calls.mockImplementation(async (...args) => {
              if (args[2].resolveResource)
                throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
              return authority(...args);
            });
          }
          const resolver = new ApiHistoryResolver();
          const graphql = new ApolloServer({
            typeDefs,
            resolvers: {
              JSON: GraphQLJSON,
              Query: { apiHistory: resolver.getApiHistory },
              ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
            },
            context: () => ({
              ...components,
              deployRepository: components.deployLogRepository,
              nativeHumanToken: headers['x-kailo-native-human-token'],
              nativeIdentityScope: identityScope,
            }),
          });
          try {
            const response = await graphql.executeOperation({
              query: API_HISTORY,
              variables: {
                filter: {
                  queryScope: nativePreviewScope(config, identityScope),
                  generation: 2,
                },
                pagination: { offset: 0, limit: 10 },
              },
            });
            if (denied) expect(response.errors).toBeDefined();
            else {
              expect(response.errors).toBeUndefined();
              expect(response.data.apiHistory.items[0].responsePayload).toEqual(
                { sql: statement, threadId: key },
              );
              expect(
                response.data.apiHistory.items[0].requestPayload,
              ).not.toHaveProperty('nativeAsk');
            }
            expect(askCreate).toHaveBeenCalledTimes(1);
            noExecution();
          } finally {
            await graphql.stop();
          }
        },
      );
    });

    it.each([false, true])(
      'original ask SQL and SSE surfaces consume actual query disclosure and one captured native task (stream=%s)',
      async (streaming) => {
        const response = await sendAsk(askBody, {}, streaming);
        expect(response.status).toBe(200);
        const result = streaming
          ? await response.text()
          : await response.json();
        if (streaming) {
          expect(result).toContain('message_start');
          expect(result).toContain('sql_generation_success');
          expect(result).toContain('summary_generation');
          expect(result).toContain('message_stop');
        } else
          expect(result).toEqual({
            id: key,
            threadId: key,
            sql: statement,
            summary: 'Original summary',
          });
        expect(askCreate).toHaveBeenCalledTimes(1);
        expect(askCreate.mock.calls[0][0]).toMatchObject({
          queryId: key,
          deployId: selection.deploymentHash,
          query: askBody.question,
        });
        expect(summaryCreate.mock.calls[0][0]).toMatchObject({
          queryId: key,
          sql: statement,
          sqlData: row.responsePayload,
        });
        expect(summaryRow.statusCode).toBe(200);
        expect(summaryRow.responsePayload.nativeAsk.doneQueryId).toBe(key);
        expect(direct).not.toHaveBeenCalled();
        const repeated = await sendAsk(askBody, {}, streaming);
        expect(repeated.status).toBe(200);
        expect(askCreate).toHaveBeenCalledTimes(1);
        expect(summaryCreate).toHaveBeenCalledTimes(1);
        expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
          1,
        );
      },
    );

    it.each([false, true])(
      'original GENERAL answer keeps its explanation and actual native done proof (stream=%s)',
      async (streaming) => {
        askResult = {
          status: AskResultStatus.UNDERSTANDING,
          type: AskResultType.GENERAL,
        };
        const response = await sendAsk(askBody, {}, streaming);
        expect(response.status).toBe(200);
        const result = streaming
          ? await response.text()
          : await response.json();
        if (streaming) {
          expect(result).toContain('explanation');
          expect(result).toContain('message_stop');
        } else
          expect(result).toEqual({
            id: key,
            threadId: key,
            type: 'NON_SQL_QUERY',
            explanation: 'Original explanation',
          });
        expect(summaryCreate).not.toHaveBeenCalled();
        expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
          0,
        );
      },
    );

    it('lost original Ask POST acknowledgement observes the exact fixed task without creating another task or SQL', async () => {
      askCreate.mockRejectedValue(new Error('lost ACK'));
      const response = await sendAsk();
      expect(response.status).toBe(200);
      expect(askGet).toHaveBeenCalledWith(key);
      expect((await sendAsk()).status).toBe(200);
      expect(askCreate).toHaveBeenCalledTimes(1);
      expect(summaryCreate).toHaveBeenCalledTimes(1);
    });

    it('original Chinese GENERAL text remains exact across split native UTF-8 chunks', async () => {
      askResult = {
        status: AskResultStatus.UNDERSTANDING,
        type: AskResultType.GENERAL,
      };
      const frame = Buffer.from('data: {"message":"中文回答"}\n\n');
      const offset = frame.indexOf(Buffer.from('中')) + 1;
      askStream.mockResolvedValue(
        Readable.from([
          frame.subarray(0, offset),
          frame.subarray(offset),
          `data: ${JSON.stringify({ done: true, queryId: key })}\n\n`,
        ]),
      );
      const response = await sendAsk();
      expect(response.status).toBe(200);
      expect((await response.json()).explanation).toBe('中文回答');
    });

    it.each(['missing', 'unknown', 'foreign-ACK'])(
      'unverifiable original Ask %s remains pending and does not rePOST or execute SQL',
      async (mode) => {
        if (mode === 'missing')
          askGet.mockRejectedValue(new Error('404 cache missing'));
        if (mode === 'unknown') askResult.status = 'future';
        if (mode === 'foreign-ACK')
          askCreate.mockResolvedValue({ queryId: 'foreign' });
        expect((await sendAsk()).status).toBe(202);
        if (mode === 'foreign-ACK')
          askGet.mockRejectedValue(new Error('missing actual owned ID'));
        expect((await sendAsk()).status).toBe(202);
        expect(askCreate).toHaveBeenCalledTimes(1);
        expect(summaryCreate).not.toHaveBeenCalled();
        expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
          0,
        );
        expect(summaryRow.statusCode).toBe(202);
      },
    );

    it.each([AskResultStatus.FAILED, AskResultStatus.STOPPED])(
      'confirmed original Ask %s retains native evidence and never executes SQL',
      async (status) => {
        askResult = { status, error: { message: 'private provider detail' } };
        const response = await sendAsk();
        expect(response.status).toBe(409);
        expect(JSON.stringify(await response.json())).not.toContain(
          'private provider',
        );
        expect(summaryRow.responsePayload.nativeAsk.status).toBe(status);
        expect((await sendAsk()).status).toBe(409);
        expect(askCreate).toHaveBeenCalledTimes(1);
        expect(summaryCreate).not.toHaveBeenCalled();
      },
    );

    it('pending query AE does not generate an unadmitted answer or repeat the original SQL', async () => {
      completed = false;
      expect((await sendAsk()).status).toBe(202);
      expect((await sendAsk()).status).toBe(202);
      expect(summaryCreate).not.toHaveBeenCalled();
      expect(askCreate).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
    });

    it.each(['EOF', 'foreign-done'])(
      'original GENERAL stream %s is not success and is never restarted blindly',
      async (mode) => {
        askResult = {
          status: AskResultStatus.UNDERSTANDING,
          type: AskResultType.GENERAL,
        };
        askStream.mockResolvedValue(
          Readable.from([
            'data: {"message":"partial"}\n\n',
            ...(mode === 'foreign-done'
              ? ['data: {"done":true,"queryId":"foreign"}\n\n']
              : []),
          ]),
        );
        const first = await sendAsk();
        expect(first.status).toBe(mode === 'EOF' ? 202 : 503);
        expect(summaryRow.statusCode).toBe(202);
        expect(
          summaryRow.responsePayload.nativeAsk.doneQueryId,
        ).toBeUndefined();
        expect((await sendAsk()).status).toBe(202);
        expect(askStream).toHaveBeenCalledTimes(1);
      },
    );

    it('same-key changed question/user/surface is rejected without another native task', async () => {
      expect((await sendAsk()).status).toBe(200);
      expect(
        (await sendAsk({ ...askBody, question: 'different' })).status,
      ).toBe(409);
      expect(
        (
          await sendAsk(askBody, {
            'x-kailo-native-identity-scope': 'b'.repeat(64),
          })
        ).status,
      ).toBe(409);
      expect((await sendAsk(askBody, {}, true)).status).toBe(409);
      expect(askCreate).toHaveBeenCalledTimes(1);
    });

    it('actual captured MDL read revocation prevents the native Ask POST', async () => {
      const previous = calls.getMockImplementation();
      calls.mockImplementation(async (...input) => {
        if (input[2].resolveResource)
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        return previous(...input);
      });
      expect((await sendAsk()).status).toBe(403);
      expect(askCreate).not.toHaveBeenCalled();
    });

    it('SQL generation stays bound to the actual authorized MDL deployment before command', async () => {
      jest
        .mocked(components.deployLogRepository.findLastProjectDeployLog)
        .mockImplementation(
          async () =>
            ({
              ...(await components.deployLogRepository.findOneBy({
                hash: selection.deploymentHash,
              })),
              id: 99,
              projectId: config.projectId,
              hash: 'c'.repeat(40),
              status: 'SUCCESS',
            }) as any,
        );
      const response = await sendAsk();
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        0,
      );
      expect(response.status).toBe(412);
      expect(summaryCreate).not.toHaveBeenCalled();
    });

    it('completed original Ask API History fields reauthorize the original query instead of exposing saved data directly', async () => {
      expect((await sendAsk()).status).toBe(200);
      const selected = structuredClone(summaryRow);
      const ctx = {
        ...components,
        nativeIdentityScope: identityScope,
        nativeHumanToken: headers['x-kailo-native-human-token'],
        deployRepository: components.deployLogRepository,
      };
      const fields = new ApiHistoryResolver().getApiHistoryNestedResolver();
      expect(
        await fields.responsePayload(selected, {}, ctx as any),
      ).toMatchObject({ sql: statement, summary: 'Original summary' });
      revoked = true;
      await expect(
        fields.responsePayload(selected, {}, ctx as any),
      ).rejects.toMatchObject({ status: 403 });
      expect(askCreate).toHaveBeenCalledTimes(1);
      expect(summaryCreate).toHaveBeenCalledTimes(1);
    });

    afterAll(async () => {
      if (originalConfig === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalConfig;
      Object.keys(components.apiHistoryRepository).forEach((name) => {
        delete components.apiHistoryRepository[name];
      });
      Object.assign(components.apiHistoryRepository, originalHistoryMethods);
      Object.keys(components).forEach((name) => {
        delete components[name];
      });
      Object.assign(components, originalComponents);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    });

    it('preserves the original response through real NativeHumanQuery/history/source disclosure, not direct SQL or a second history', async () => {
      const response = await send({ ...body, threadId: 'original-thread' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: row.id,
        records: [{ customer: 'native' }],
        columns: [{ name: 'customer', type: 'VARCHAR' }],
        threadId: 'original-thread',
        totalRows: 1,
      });
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(prepared).toHaveBeenCalledTimes(1);
      expect(row.requestPayload.previewScope).toBe(
        nativePreviewScope(config, identityScope),
      );
      expect(row.headers).toEqual({});
      expect(row.threadId).toBe('original-thread');
      expect(JSON.stringify(row)).not.toContain(
        headers['x-kailo-native-human-token'],
      );
      const commands = calls.mock.calls.filter((call) => call[2].command);
      expect(commands).toHaveLength(1);
      expect(JSON.stringify(commands)).not.toContain(statement);
      expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
        { nativeType: 'model', nativeRef: '8' },
      ]);
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
    });

    it('observes UNKNOWN with the same key/history/thread and never repeats native SQL or admission', async () => {
      completed = false;
      const first = await send();
      expect(first.status).toBe(202);
      const value = await first.json();
      expect(value.id).toBe(row.id);
      expect(value.threadId).toBe(key);
      expect(row.threadId).toBe(key);
      expect(value.receipt.submission.dispatchState).toBe('UNKNOWN');
      expect(value).not.toHaveProperty('records');
      const second = await send();
      expect(second.status).toBe(202);
      expect(await second.json()).toEqual(value);
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
      expect(prepared).toHaveBeenCalledTimes(1);
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
    });

    it.each([
      'missing-token',
      'missing-scope',
      'missing-key',
      'bad-key',
      'invalid-limit',
      'changed-project',
      'broken-config',
    ])(
      'refuses %s without falling back to standalone SQL/history',
      async (failure) => {
        const changes: Record<string, string> = {};
        let input = body;
        if (failure === 'missing-token')
          changes['x-kailo-native-human-token'] = '';
        if (failure === 'missing-scope')
          changes['x-kailo-native-identity-scope'] = '';
        if (failure === 'missing-key') changes['idempotency-key'] = '';
        if (failure === 'bad-key') changes['idempotency-key'] = 'not-an-intent';
        if (failure === 'invalid-limit') input = { ...body, limit: 0 };
        if (failure === 'changed-project')
          jest
            .spyOn(components.projectService, 'getCurrentProject')
            .mockResolvedValue({ id: 4 } as any);
        if (failure === 'broken-config') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(new Error('private delivery credential'));
        }
        const response = await send(input, changes);
        expect(response.status).toBe(
          failure.startsWith('missing-') && failure !== 'missing-key'
            ? 401
            : failure === 'changed-project'
              ? 409
              : failure === 'broken-config'
                ? 503
                : 400,
        );
        expect(await response.text()).not.toMatch(
          /native-token|private delivery credential|records/,
        );
        expect(calls).not.toHaveBeenCalled();
        expect(direct).not.toHaveBeenCalled();
        expect(prepared).not.toHaveBeenCalled();
        expect(appended).not.toHaveBeenCalled();
      },
    );

    it('rejects a changed person or SQL on reentry and never creates a replacement command', async () => {
      completed = false;
      expect((await send()).status).toBe(202);
      expect(
        (await send(body, { 'x-kailo-native-identity-scope': 'b'.repeat(64) }))
          .status,
      ).toBe(409);
      expect(
        (await send({ ...body, sql: `${statement} WHERE false` })).status,
      ).toBe(409);
      expect((await send({ ...body, threadId: 'another-thread' })).status).toBe(
        409,
      );
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
      expect(prepared).toHaveBeenCalledTimes(1);
      expect(direct).not.toHaveBeenCalled();
    });

    it('rejects a competing original history thread before a Core command, without reparenting the winner', async () => {
      prepared.mockImplementation(async (input) => {
        row = { ...input, threadId: 'winning-original-thread' };
        return row;
      });
      const response = await send({
        ...body,
        threadId: 'losing-original-thread',
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'QUERY_INTENT_CONFLICT' });
      expect(row.threadId).toBe('winning-original-thread');
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        0,
      );
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
    });

    it.each([
      'FAILED',
      'CANCELED',
      'TERMINATED',
      'TIMED_OUT',
      'DENIED',
      'RUNNING',
      'unrecognized',
    ])(
      'preserves %s receipt evidence without returning original records or re-executing',
      async (status) => {
        completed = false;
        expect((await send()).status).toBe(202);
        if (status === 'DENIED')
          observed.submission = {
            ...submission,
            gateState: 'DENIED',
            dispatchState: 'NOT_DISPATCHED',
          };
        else {
          observed.submission = submission;
          observed.terminalStatus = status;
        }
        const response = await send();
        expect(response.status).toBe(
          status === 'unrecognized'
            ? 503
            : status === 'RUNNING'
              ? 202
              : status === 'DENIED'
                ? 403
                : 409,
        );
        const value = await response.json();
        expect(value).not.toHaveProperty('records');
        if (status !== 'unrecognized') expect(value.receipt).toEqual(observed);
        expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
          1,
        );
        expect(prepared).toHaveBeenCalledTimes(1);
        expect(direct).not.toHaveBeenCalled();
        expect(appended).not.toHaveBeenCalled();
      },
    );

    it('withholds completed original records after current source policy is revoked', async () => {
      expect((await send()).status).toBe(200);
      revoked = true;
      const response = await send();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'QUERY_SCOPE_DENIED' });
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
    });

    it('leaves the never-configured independent native API response and history intact', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      const response = await send();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: expect.any(String),
        records: [],
        columns: [],
        threadId: expect.any(String),
        totalRows: 0,
      });
      expect(direct).toHaveBeenCalledWith(
        statement,
        expect.objectContaining({ limit: 10, modelingOnly: false }),
      );
      expect(appended).toHaveBeenCalledTimes(1);
      expect(calls).not.toHaveBeenCalled();
      expect(prepared).not.toHaveBeenCalled();
    });

    it('generates the original summary from the same admitted SQL and persists real done before original History disclosure', async () => {
      const response = await sendSummary({
        ...summaryBody,
        threadId: 'original-summary-thread',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: key,
        summary: 'Original summary',
        threadId: 'original-summary-thread',
      });
      expect(summaryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryId: key,
          query: summaryBody.question,
          sql: statement,
          sqlData: row.responsePayload,
          threadId: 'original-summary-thread',
        }),
      );
      expect(summaryRow.apiType).toBe(ApiType.GENERATE_SUMMARY);
      expect(summaryRow.responsePayload.nativeSummary.doneQueryId).toBe(key);
      expect(
        summaryRow.requestPayload.nativeSummary.queryReference.historyId,
      ).toBe(row.id);
      expect(summaryRow.governanceKey).toBeUndefined();
      expect(JSON.stringify(summaryRow)).not.toContain('verified-native-token');
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
      const reader = new NativeHumanQuery(
        config,
        new NativeQueryService(
          config,
          components.projectRepository,
          components.deployLogRepository,
          components.apiHistoryRepository,
          components.queryService,
          components.viewRepository,
          components.modelRepository,
          components.modelColumnRepository,
        ),
        components.apiHistoryRepository,
      );
      const history = await reader.readHistory(
        'verified-native-token',
        summaryRow,
      );
      expect(history.responsePayload).toEqual({
        summary: 'Original summary',
        threadId: 'original-summary-thread',
      });
      expect(history.requestPayload).not.toHaveProperty('nativeSummary');
    });

    it('observes a lost summary create ACK under the original task ID, never a second AI POST or SQL', async () => {
      summaryCreate.mockRejectedValue(new Error('lost ACK'));
      expect((await sendSummary()).status).toBe(200);
      const again = await sendSummary();
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({
        id: key,
        summary: 'Original summary',
        threadId: key,
      });
      expect(summaryCreate).toHaveBeenCalledTimes(1);
      expect(summaryStream).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
      expect(direct).not.toHaveBeenCalled();
    });

    it('admits only one original summary POST and consuming stream under concurrent HTTP re-entry', async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => sendSummary()),
      );
      expect(responses.some((response) => response.status === 200)).toBe(true);
      expect(
        responses.every((response) => [200, 202].includes(response.status)),
      ).toBe(true);
      expect(summaryCreate).toHaveBeenCalledTimes(1);
      expect(summaryStream).toHaveBeenCalledTimes(1);
      expect(summaryRow.responsePayload.nativeSummary.doneQueryId).toBe(key);
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
    });

    it.each([false, true])(
      'discloses summary through the original API History GraphQL document only with current source rights (revoked %s)',
      async (deny) => {
        expect((await sendSummary()).status).toBe(200);
        revoked = deny;
        calls.mockClear();
        const ctx = {
          ...components,
          deployRepository: components.deployLogRepository,
          nativeHumanToken: 'verified-native-token',
          nativeIdentityScope: identityScope,
          apiHistoryRepository: {
            count: jest.fn(async () => 1),
            findAllWithPagination: jest.fn(async () => [summaryRow]),
          },
        };
        const resolver = new ApiHistoryResolver();
        const graphql = new ApolloServer({
          typeDefs,
          resolvers: {
            JSON: GraphQLJSON,
            Query: { apiHistory: resolver.getApiHistory },
            ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
          },
          context: () => ctx,
        });
        try {
          await graphql.start();
          const result = await graphql.executeOperation({
            query: API_HISTORY,
            variables: {
              filter: {
                queryScope: nativePreviewScope(config, identityScope),
                generation: 2,
              },
              pagination: { offset: 0, limit: 10 },
            },
          });
          const item = result.data.apiHistory.items[0];
          if (deny) {
            expect(item.requestPayload).toBeNull();
            expect(item.responsePayload).toBeNull();
            expect(result.errors).toHaveLength(2);
          } else {
            expect(result.errors).toBeUndefined();
            expect(item.requestPayload).not.toHaveProperty('nativeSummary');
            expect(item.responsePayload).toEqual({
              summary: 'Original summary',
              threadId: key,
            });
          }
          expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
          expect(summaryCreate).toHaveBeenCalledTimes(1);
        } finally {
          await graphql.stop();
        }
      },
    );

    it('does not expose summary History as standalone when the binding delivery is present but empty', async () => {
      expect((await sendSummary()).status).toBe(200);
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
      jest
        .mocked(loadQueryDelivery)
        .mockRejectedValue(
          new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE'),
        );
      const resolver = new ApiHistoryResolver().getApiHistoryNestedResolver();
      await expect(
        resolver.responsePayload(summaryRow, null, {} as any),
      ).rejects.toMatchObject({ status: 503 });
    });

    it.each([
      'sql',
      'result',
      'sources',
      'deployment',
      'missing-done',
      'foreign-done',
      'task-id',
      'reference-key',
      'summary-type',
      'thread',
    ])(
      'the original summary History consumer rejects changed %s rather than exposing an unverified derived body',
      async (change) => {
        expect((await sendSummary()).status).toBe(200);
        if (change === 'sql') row.requestPayload.sql = 'SELECT changed';
        if (change === 'result') row.responsePayload.data = [['changed']];
        if (change === 'sources') row.requestPayload.nativeSources = [];
        if (change === 'deployment')
          row.requestPayload.deploymentHash = 'changed';
        if (change === 'missing-done')
          delete summaryRow.responsePayload.nativeSummary;
        if (change === 'foreign-done')
          summaryRow.responsePayload.nativeSummary.doneQueryId = 'foreign';
        if (change === 'task-id')
          summaryRow.requestPayload.nativeSummary.taskId = 'foreign';
        if (change === 'reference-key')
          summaryRow.requestPayload.nativeSummary.queryReference.key = resource;
        if (change === 'summary-type')
          summaryRow.responsePayload.summary = { unverified: true };
        if (change === 'thread') summaryRow.threadId = 'foreign';
        const reader = new NativeHumanQuery(
          config,
          new NativeQueryService(
            config,
            components.projectRepository,
            components.deployLogRepository,
            components.apiHistoryRepository,
            components.queryService,
            components.viewRepository,
            components.modelRepository,
            components.modelColumnRepository,
          ),
          components.apiHistoryRepository,
        );
        await expect(
          reader.readHistory(
            'verified-native-token',
            structuredClone(summaryRow),
          ),
        ).rejects.toMatchObject({ status: 503 });
        expect(summaryCreate).toHaveBeenCalledTimes(1);
        expect(direct).not.toHaveBeenCalled();
      },
    );

    it.each([
      'missing-task',
      'preprocessing',
      'unknown-status',
      'lost-stream',
      'no-done',
      'foreign-done',
      'malformed-event',
    ])(
      'does not treat summary %s as completion or repeat its original side effect',
      async (failure) => {
        if (failure === 'missing-task')
          summaryGet.mockRejectedValue(new Error('404 expired cache'));
        if (failure === 'preprocessing')
          summaryGet.mockResolvedValue({
            status: TextBasedAnswerStatus.PREPROCESSING,
          });
        if (failure === 'unknown-status')
          summaryGet.mockResolvedValue({ status: 'FUTURE_UNKNOWN' });
        if (failure === 'lost-stream')
          summaryStream.mockRejectedValue(new Error('stream ACK lost'));
        if (failure === 'no-done')
          summaryStream.mockResolvedValue(
            Readable.from(['data: {"message":"partial"}\n\n']),
          );
        if (failure === 'foreign-done')
          summaryStream.mockResolvedValue(
            Readable.from(['data: {"done":true,"queryId":"foreign"}\n\n']),
          );
        if (failure === 'malformed-event')
          summaryStream.mockResolvedValue(Readable.from(['data: invalid\n\n']));
        const first = await sendSummary();
        expect(first.status).toBe(
          ['foreign-done', 'malformed-event'].includes(failure) ? 503 : 202,
        );
        const pending = await first.json();
        expect(pending).not.toHaveProperty('summary');
        if (first.status === 202) {
          expect(pending.queryReceipt.submission.actionKey).toBe(
            'data_query.query@v1',
          );
          expect(pending).not.toHaveProperty('receipt');
        }
        expect(summaryRow.statusCode).toBe(202);
        const again = await sendSummary();
        expect(again.status).toBe(202);
        expect(await again.json()).not.toHaveProperty('summary');
        expect(summaryCreate).toHaveBeenCalledTimes(1);
        expect(summaryStream.mock.calls.length).toBeLessThanOrEqual(1);
        expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
          1,
        );
      },
    );

    it('keeps SQL UNKNOWN under its original key without starting summary generation', async () => {
      completed = false;
      expect((await sendSummary()).status).toBe(202);
      expect((await sendSummary()).status).toBe(202);
      expect(summaryCreate).not.toHaveBeenCalled();
      expect(prepareSummary).not.toHaveBeenCalled();
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
    });

    it.each(['question', 'language', 'thread', 'identity', 'sql'])(
      'rejects changed summary %s before another generation or output',
      async (change) => {
        expect((await sendSummary()).status).toBe(200);
        const input = {
          ...summaryBody,
          ...(change === 'question' ? { question: 'Different' } : {}),
          ...(change === 'language' ? { language: 'zh-TW' } : {}),
          ...(change === 'thread' ? { threadId: 'Different' } : {}),
          ...(change === 'sql'
            ? { sql: 'SELECT different FROM native_model' }
            : {}),
        };
        const response = await sendSummary(
          input,
          change === 'identity'
            ? { 'x-kailo-native-identity-scope': 'b'.repeat(64) }
            : {},
        );
        expect(response.status).toBe(409);
        expect(await response.json()).not.toHaveProperty('summary');
        expect(summaryCreate).toHaveBeenCalledTimes(1);
      },
    );

    it('refuses summary output after current source authorization is revoked, including completed History', async () => {
      expect((await sendSummary()).status).toBe(200);
      revoked = true;
      expect((await sendSummary()).status).toBe(403);
      const reader = new NativeHumanQuery(
        config,
        new NativeQueryService(
          config,
          components.projectRepository,
          components.deployLogRepository,
          components.apiHistoryRepository,
          components.queryService,
          components.viewRepository,
          components.modelRepository,
          components.modelColumnRepository,
        ),
        components.apiHistoryRepository,
      );
      await expect(
        reader.readHistory('verified-native-token', summaryRow),
      ).rejects.toMatchObject({ status: 403 });
      expect(summaryCreate).toHaveBeenCalledTimes(1);
      expect(summaryRow.statusCode).toBe(200);
    });

    it('records actual native FAILED without calling it successful or regenerating', async () => {
      summaryGet.mockResolvedValue({
        status: TextBasedAnswerStatus.FAILED,
        error: { message: 'private provider message' },
      });
      expect((await sendSummary()).status).toBe(409);
      expect(summaryRow.statusCode).toBe(409);
      expect((await sendSummary()).status).toBe(409);
      expect(summaryCreate).toHaveBeenCalledTimes(1);
      expect(summaryStream).not.toHaveBeenCalled();
      expect(JSON.stringify(summaryRow)).not.toContain(
        'private provider message',
      );
    });

    it.each(['token', 'scope', 'empty-config'])(
      'does not fall back to standalone summary for missing %s',
      async (missing) => {
        const changes =
          missing === 'token'
            ? { 'x-kailo-native-human-token': '' }
            : missing === 'scope'
              ? { 'x-kailo-native-identity-scope': '' }
              : {};
        if (missing === 'empty-config') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(
              new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE'),
            );
        }
        const response = await sendSummary(summaryBody, changes);
        expect(response.status).toBe(missing === 'empty-config' ? 503 : 401);
        expect(summaryCreate).not.toHaveBeenCalled();
        expect(direct).not.toHaveBeenCalled();
      },
    );

    it('returns the complete original Vega enhancement with admitted data, never raw SQL or a SERVICE re-query', async () => {
      const response = await sendChart({
        ...summaryBody,
        threadId: 'original-chart-thread',
      });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({
        id: key,
        threadId: 'original-chart-thread',
        vegaSpec: enhanceVegaSpec(chartResult.response.chartSchema, [
          { customer: 'native' },
        ]),
      });
      expect(result.vegaSpec.data.values).toEqual([{ customer: 'native' }]);
      expect(result.vegaSpec.config).toHaveProperty('font');
      expect(result.vegaSpec.params).not.toHaveLength(0);
      expect(chartCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryId: key,
          query: summaryBody.question,
          sql: statement,
          data: row.responsePayload,
          projectId: String(config.projectId),
        }),
      );
      expect(summaryRow.apiType).toBe(ApiType.GENERATE_VEGA_CHART);
      expect(
        summaryRow.requestPayload.nativeChart.queryReference.historyId,
      ).toBe(row.id);
      expect(summaryRow.responsePayload.nativeChart.doneQueryId).toBe(key);
      expect(summaryCreate).not.toHaveBeenCalled();
      expect(direct).not.toHaveBeenCalled();
      expect(appended).not.toHaveBeenCalled();
      expect(JSON.stringify(summaryRow)).not.toContain('verified-native-token');
    });

    it('observes the same native chart after lost POST ACK and cache delay without regenerating or rerunning SQL', async () => {
      chartCreate.mockRejectedValue(new Error('lost original ACK'));
      chartGet.mockRejectedValueOnce(new Error('native task not yet visible'));
      const pending = await sendChart();
      expect(pending.status).toBe(202);
      expect((await pending.json()).queryReceipt.submission.actionKey).toBe(
        'data_query.query@v1',
      );
      expect((await sendChart()).status).toBe(200);
      expect((await sendChart()).status).toBe(200);
      expect(chartCreate).toHaveBeenCalledTimes(1);
      expect(chartGet.mock.calls.every(([id]) => id === key)).toBe(true);
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
    });

    it('never adopts a foreign chart create ACK and then observes only the persisted original task ID', async () => {
      chartCreate.mockResolvedValue({ queryId: 'foreign-task' });
      expect((await sendChart()).status).toBe(202);
      expect(chartGet).not.toHaveBeenCalled();
      expect((await sendChart()).status).toBe(200);
      expect(chartGet).toHaveBeenCalledWith(key);
      expect(chartCreate).toHaveBeenCalledTimes(1);
    });

    it.each([
      ChartStatus.FETCHING,
      ChartStatus.GENERATING,
      'UNKNOWN_FUTURE',
      'MISSING_CACHE',
    ])(
      'keeps original chart %s uncertain without replacing the native key',
      async (status) => {
        if (status === 'MISSING_CACHE')
          chartGet.mockRejectedValue(new Error('404'));
        else chartGet.mockResolvedValue({ status });
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await sendChart();
          expect(response.status).toBe(202);
          const body = await response.json();
          expect(body).not.toHaveProperty('vegaSpec');
          expect(body).not.toHaveProperty('receipt');
          expect(body.id).toBe(key);
        }
        expect(summaryRow.statusCode).toBe(202);
        expect(chartCreate).toHaveBeenCalledTimes(1);
        chartGet.mockReset().mockResolvedValue(chartResult);
        expect((await sendChart()).status).toBe(200);
        expect(chartCreate).toHaveBeenCalledTimes(1);
      },
    );

    it.each([ChartStatus.FAILED, ChartStatus.STOPPED])(
      'records actual native chart %s without leaking provider details or repeating POST',
      async (status) => {
        chartGet.mockResolvedValue({
          status,
          error: { message: 'private-provider-detail' },
        });
        const first = await sendChart();
        expect(first.status).toBe(409);
        expect(await first.json()).toEqual({
          id: key,
          threadId: key,
          error:
            status === ChartStatus.FAILED
              ? 'CHART_GENERATION_FAILED'
              : 'CHART_GENERATION_STOPPED',
        });
        expect(summaryRow.responsePayload.nativeChart.status).toBe(status);
        expect(JSON.stringify(summaryRow)).not.toContain(
          'private-provider-detail',
        );
        expect((await sendChart()).status).toBe(409);
        expect(chartCreate).toHaveBeenCalledTimes(1);
        expect(chartGet).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['missing-schema', 'contradictory-error'])(
      'does not claim a chart terminal for %s',
      async (failure) => {
        chartGet.mockResolvedValue(
          failure === 'missing-schema'
            ? { status: ChartStatus.FINISHED }
            : {
                ...chartResult,
                error: { message: 'unverified raw error' },
              },
        );
        const response = await sendChart();
        expect(response.status).toBe(503);
        expect(await response.json()).not.toHaveProperty('vegaSpec');
        expect(summaryRow.statusCode).toBe(202);
        chartGet.mockReset().mockResolvedValue(chartResult);
        expect((await sendChart()).status).toBe(200);
        expect(chartCreate).toHaveBeenCalledTimes(1);
      },
    );

    it('waits for the actual original SQL receipt before admitting any chart task', async () => {
      completed = false;
      expect((await sendChart()).status).toBe(202);
      expect((await sendChart()).status).toBe(202);
      expect(chartCreate).not.toHaveBeenCalled();
      expect(prepareSummary).not.toHaveBeenCalled();
      expect(calls.mock.calls.filter((call) => call[2].command)).toHaveLength(
        1,
      );
    });

    it('rechecks source rights after native chart preparation but before sending data to AI', async () => {
      const prepare = prepareSummary.getMockImplementation();
      prepareSummary.mockImplementation(async (...args) => {
        const result = await prepare(...args);
        revoked = true;
        return result;
      });
      expect((await sendChart()).status).toBe(403);
      expect(chartCreate).not.toHaveBeenCalled();
      expect(chartGet).not.toHaveBeenCalled();
    });

    it('does not persist or disclose the chart when rights are revoked during the native task', async () => {
      chartGet.mockImplementation(async () => {
        revoked = true;
        return chartResult;
      });
      expect((await sendChart()).status).toBe(403);
      expect(summaryRow.statusCode).toBe(202);
      expect(summaryRow.responsePayload).not.toHaveProperty('vegaSpec');
    });

    it.each(['question', 'thread', 'identity', 'sql', 'sampleSize'])(
      'does not let chart re-entry change %s and consume the previous task',
      async (change) => {
        expect((await sendChart()).status).toBe(200);
        const input = {
          ...summaryBody,
          ...(change === 'question' ? { question: 'Different' } : {}),
          ...(change === 'thread' ? { threadId: 'Different' } : {}),
          ...(change === 'sql'
            ? { sql: 'SELECT different FROM native_model' }
            : {}),
          ...(change === 'sampleSize' ? { sampleSize: 11 } : {}),
        };
        const response = await sendChart(
          input,
          change === 'identity'
            ? { 'x-kailo-native-identity-scope': 'b'.repeat(64) }
            : {},
        );
        expect(response.status).toBe(409);
        expect(await response.json()).not.toHaveProperty('vegaSpec');
        expect(chartCreate).toHaveBeenCalledTimes(1);
      },
    );

    it('does not reuse a summary native task as a chart under the same original caller key', async () => {
      expect((await sendSummary()).status).toBe(200);
      expect((await sendChart()).status).toBe(409);
      expect(chartCreate).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'consumes original chart History GraphQL including original data sanitization (revoked %s)',
      async (deny) => {
        expect((await sendChart()).status).toBe(200);
        revoked = deny;
        calls.mockClear();
        const ctx = {
          ...components,
          deployRepository: components.deployLogRepository,
          nativeHumanToken: 'verified-native-token',
          nativeIdentityScope: identityScope,
          apiHistoryRepository: {
            count: jest.fn(async () => 1),
            findAllWithPagination: jest.fn(async () => [summaryRow]),
          },
        };
        const resolver = new ApiHistoryResolver();
        const graphql = new ApolloServer({
          typeDefs,
          resolvers: {
            JSON: GraphQLJSON,
            Query: { apiHistory: resolver.getApiHistory },
            ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
          },
          context: () => ctx,
        });
        try {
          await graphql.start();
          const result = await graphql.executeOperation({
            query: API_HISTORY,
            variables: {
              filter: {
                queryScope: nativePreviewScope(config, identityScope),
                generation: 2,
              },
              pagination: { offset: 0, limit: 10 },
            },
          });
          const item = result.data.apiHistory.items[0];
          if (deny) {
            expect(item.requestPayload).toBeNull();
            expect(item.responsePayload).toBeNull();
            expect(result.errors).toHaveLength(2);
          } else {
            expect(result.errors).toBeUndefined();
            expect(item.requestPayload).not.toHaveProperty('nativeChart');
            expect(item.responsePayload).not.toHaveProperty('nativeChart');
            expect(item.responsePayload.vegaSpec.data.values).toEqual([
              '1 data points omitted',
            ]);
            expect(item.responsePayload.vegaSpec.config).toHaveProperty('font');
          }
          expect(calls.mock.calls.every((call) => !call[2].command)).toBe(true);
          expect(chartCreate).toHaveBeenCalledTimes(1);
        } finally {
          await graphql.stop();
        }
      },
    );

    it.each(['token', 'scope', 'empty-config'])(
      'does not fall back to native SQL for missing chart %s',
      async (missing) => {
        const changes =
          missing === 'token'
            ? { 'x-kailo-native-human-token': '' }
            : missing === 'scope'
              ? { 'x-kailo-native-identity-scope': '' }
              : {};
        if (missing === 'empty-config') {
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
          jest
            .mocked(loadQueryDelivery)
            .mockRejectedValue(
              new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE'),
            );
        }
        expect((await sendChart(summaryBody, changes)).status).toBe(
          missing === 'empty-config' ? 503 : 401,
        );
        expect(chartCreate).not.toHaveBeenCalled();
        expect(direct).not.toHaveBeenCalled();
      },
    );
  });

  it('uses Chinese by default and a single English locale for necessary preview guidance', () => {
    expect(getQueryPreviewText().check).toBe('检查原查询');
    expect(getQueryPreviewText('en').check).toBe('Check query');
    expect(Object.values(getQueryPreviewText('en')).join(' ')).not.toMatch(
      /[\u4e00-\u9fff]/,
    );
    expect(getQueryPreviewText('zh-CN').pending).not.toContain(' / ');
  });
});

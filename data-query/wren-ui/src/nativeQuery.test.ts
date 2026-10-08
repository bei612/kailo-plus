import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { randomInt, randomUUID } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import knex, { Knex } from 'knex';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ProjectRepository } from './apollo/server/repositories/projectRepository';
import { DeployLogRepository } from './apollo/server/repositories/deployLogRepository';
import { ViewRepository } from './apollo/server/repositories/viewRepository';
import { ModelRepository } from './apollo/server/repositories/modelRepository';
import { ModelColumnRepository } from './apollo/server/repositories/modelColumnRepository';
import {
  ApiHistoryRepository,
  ApiType,
} from './apollo/server/repositories/apiHistoryRepository';
import {
  ThreadResponse,
  ThreadResponseRepository,
} from './apollo/server/repositories/threadResponseRepository';
import { ThreadRepository } from './apollo/server/repositories/threadRepository';
import { AskingService } from './apollo/server/services/askingService';
import { QueryService } from './apollo/server/services/queryService';
import { NativeQueryService } from './apollo/server/services/nativeQueryService';
import { canReadNativeMetadata } from './apollo/server/services/nativeHumanQuery';
import { WrenEngineAdaptor } from './apollo/server/adaptors/wrenEngineAdaptor';
import { IbisAdaptor } from './apollo/server/adaptors/ibisAdaptor';
import { encryptConnectionInfo } from './apollo/server/dataSource';
import { DataSourceName } from './apollo/server/types';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import {
  digest,
  loadQueryDelivery,
  NativeQueryDelivery,
} from './apollo/server/services/nativeQueryAdmission';
import handler, {
  config as routeConfig,
} from './pages/api/platform-adapter/[operation]';

let mockComponents: any;
jest.mock('./common', () => ({
  get components() {
    return mockComponents;
  },
}));

const integration = process.env.WREN_QUERY_TEST_DATABASE_URL
  ? describe
  : describe.skip;

integration('original Wren native answer PostgreSQL CAS', () => {
  let database: Knex;
  let tx: Knex.Transaction;
  let repository: ThreadResponseRepository;
  let expected: ThreadResponse;
  let projectId: number;
  const originalDelivery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;

  beforeAll(async () => {
    const url = new URL(process.env.WREN_QUERY_TEST_DATABASE_URL);
    database = knex({ client: 'pg', connection: url.toString() });
    const identity = await database.raw('SELECT current_database() AS name');
    expect(identity.rows[0].name).toBe(
      decodeURIComponent(url.pathname.slice(1)),
    );
    // This existing database was independently verified as the original Wren
    // test fixture. Never migrate it or run the other suite's setup here.
    const fixture = await database('project')
      .where({ display_name: 'isolated-query-fixture' })
      .first();
    expect(fixture).toBeDefined();
    projectId = fixture.id;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
  });
  beforeEach(async () => {
    tx = await database.transaction();
    const threadId = randomInt(1, 2147483647);
    await tx('thread').insert({ id: threadId, project_id: projectId });
    repository = new ThreadResponseRepository(tx);
    expected = await repository.createOne({
      id: randomInt(1, 2147483647),
      threadId,
      question: randomUUID(),
      sql: 'SELECT 1 AS original_value',
    });
    // The native schema defaults to JSONB {}, not SQL NULL. Exercise the
    // original nullable snapshot explicitly; {} is a distinct changed value.
    await tx('thread_response')
      .where({ id: expected.id })
      .update({ answer_detail: null });
    expected = await repository.findOneBy({ id: expected.id });
  });
  afterEach(async () => {
    if (tx) await tx.rollback();
    if (expected) {
      expect(
        await database('thread_response').where({ id: expected.id }),
      ).toEqual([]);
      expect(await database('thread').where({ id: expected.threadId })).toEqual(
        [],
      );
    }
  });
  afterAll(async () => {
    if (originalDelivery === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalDelivery;
    if (database) await database.destroy();
  });

  it('commits one original summary task owner before POST and returns only one INSERT winner', async () => {
    const history = new ApiHistoryRepository(tx);
    const input = {
      id: randomUUID(),
      projectId,
      apiType: ApiType.GENERATE_SUMMARY,
      governanceBindingId: randomUUID(),
      threadId: randomUUID(),
      headers: {},
      statusCode: 202,
      durationMs: 0,
      requestPayload: {
        question: 'Original',
        nativeSummary: { taskId: randomUUID() },
      },
      responsePayload: { threadId: 'original-thread' },
    };
    const first = await history.prepareNativeSummary(input);
    expect(first.created).toBe(true);
    const second = await history.prepareNativeSummary(input);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    const stream = await history.advanceNativeSummary(
      first.record,
      { summary: '', threadId: input.threadId },
      202,
      1,
    );
    expect(stream).not.toBeNull();
    expect(
      await history.advanceNativeSummary(
        second.record,
        { summary: '', threadId: input.threadId },
        202,
        1,
      ),
    ).toBeNull();
    const done = await history.advanceNativeSummary(
      stream,
      {
        summary: 'original answer',
        threadId: input.threadId,
        nativeSummary: { doneQueryId: input.id },
      },
      200,
      2,
    );
    expect(done.statusCode).toBe(200);
    expect(
      await history.advanceNativeSummary(
        stream,
        { summary: 'late duplicate' },
        200,
        3,
      ),
    ).toBeNull();
    expect(
      (await history.findOneBy({ id: input.id })).responsePayload.summary,
    ).toBe('original answer');
  });

  it.each([
    'requestPayload',
    'responsePayload',
    'projectId',
    'governanceBindingId',
    'threadId',
    'apiType',
    'statusCode',
  ])(
    'the original summary JSONB CAS rejects changed %s without replacing the native task/result',
    async (field) => {
      const history = new ApiHistoryRepository(tx);
      const input = {
        id: randomUUID(),
        projectId,
        apiType: ApiType.GENERATE_SUMMARY,
        governanceBindingId: randomUUID(),
        threadId: randomUUID(),
        headers: {},
        statusCode: 202,
        durationMs: 0,
        requestPayload: {
          question: 'Original',
          nativeSummary: { taskId: randomUUID() },
        },
        responsePayload: { threadId: 'original-thread' },
      };
      const first = await history.prepareNativeSummary(input);
      const changed = {
        ...first.record,
        ...(field === 'requestPayload'
          ? { requestPayload: { question: 'changed' } }
          : {}),
        ...(field === 'responsePayload'
          ? { responsePayload: { summary: 'changed' } }
          : {}),
        ...(field === 'projectId' ? { projectId: projectId + 1 } : {}),
        ...(field === 'governanceBindingId'
          ? { governanceBindingId: randomUUID() }
          : {}),
        ...(field === 'threadId' ? { threadId: randomUUID() } : {}),
        ...(field === 'apiType' ? { apiType: ApiType.RUN_SQL } : {}),
        ...(field === 'statusCode' ? { statusCode: 200 } : {}),
      };
      expect(
        await history.advanceNativeSummary(
          changed,
          { summary: 'untrusted' },
          200,
          1,
        ),
      ).toBeNull();
      expect(
        (await history.findOneBy({ id: input.id })).responsePayload,
      ).toEqual(input.responsePayload);
      if (
        [
          'requestPayload',
          'projectId',
          'governanceBindingId',
          'threadId',
          'apiType',
        ].includes(field)
      )
        expect(await history.prepareNativeSummary(changed)).toBeNull();
    },
  );

  it('compares actual JSONB snapshots rather than object key ordering', async () => {
    const historyId = randomUUID();
    const claimed = await repository.claimNativeAnswer(expected, {
      queryHistoryId: historyId,
      status: 'PREPROCESSING',
    });
    expect(claimed.answerDetail).toEqual({
      status: 'PREPROCESSING',
      queryHistoryId: historyId,
    });
    const completed = await repository.claimNativeAnswer(
      {
        ...claimed,
        answerDetail: { status: 'PREPROCESSING', queryHistoryId: historyId },
      },
      {
        ...claimed.answerDetail,
        status: 'FINISHED',
        content: 'original answer',
      },
    );
    expect(completed.answerDetail.status).toBe('FINISHED');
    expect(
      (await repository.findOneBy({ id: expected.id })).answerDetail,
    ).toEqual(completed.answerDetail);
  });
  it.each(['sql', 'question', 'chartDetail'])(
    'the original chart CAS refuses changed %s before native create/result persistence',
    async (field) => {
      const update =
        field === 'chartDetail'
          ? {
              chart_detail: JSON.stringify({
                status: 'FINISHED',
                chartSchema: { mark: 'bar' },
              }),
            }
          : { [field]: randomUUID() };
      await tx('thread_response').where({ id: expected.id }).update(update);
      const current = await repository.findOneBy({ id: expected.id });
      expect(
        await repository.claimNativeChart(expected, {
          queryHistoryId: randomUUID(),
          status: 'GENERATING',
        }),
      ).toBeNull();
      expect(await repository.findOneBy({ id: expected.id })).toEqual(current);
    },
  );
  it('the original chart CAS admits one overlapping native claim and preserves the exact terminal snapshot', async () => {
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map((queryHistoryId) =>
        repository.claimNativeChart(expected, {
          queryHistoryId,
          status: 'GENERATING',
        }),
      ),
    );
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    const [claimed] = winners;
    const terminal = await repository.claimNativeChart(claimed, {
      ...claimed.chartDetail,
      status: 'FINISHED',
      queryId: 'original-chart-id',
      chartSchema: { mark: 'bar' },
    });
    expect(terminal.chartDetail.queryHistoryId).toBe(
      claimed.chartDetail.queryHistoryId,
    );
    expect(
      await repository.claimNativeChart(claimed, { status: 'FAILED' }),
    ).toBeNull();
    expect(await repository.findOneBy({ id: expected.id })).toEqual(terminal);
  });

  it.each(['sql', 'question', 'threadId', 'answerDetail'])(
    'refuses an actually changed %s without overwriting native state',
    async (field) => {
      if (field === 'threadId') {
        const changedThread = randomInt(1, 2147483647);
        await tx('thread').insert({ id: changedThread, project_id: projectId });
        await tx('thread_response')
          .where({ id: expected.id })
          .update({ thread_id: changedThread });
      } else {
        const update =
          field === 'answerDetail'
            ? { answer_detail: JSON.stringify({}) }
            : { [field]: randomUUID() };
        await tx('thread_response').where({ id: expected.id }).update(update);
      }
      const current = await repository.findOneBy({ id: expected.id });
      expect(
        await repository.claimNativeAnswer(expected, {
          queryHistoryId: randomUUID(),
          status: 'FINISHED',
        }),
      ).toBeNull();
      expect(await repository.findOneBy({ id: expected.id })).toEqual(current);
    },
  );

  it('admits only one concurrent repository claim from the same native snapshot', async () => {
    const claims = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      claims.map((historyId) =>
        repository.claimNativeAnswer(expected, {
          queryHistoryId: historyId,
          status: 'PREPROCESSING',
        }),
      ),
    );
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(
      (await repository.findOneBy({ id: expected.id })).answerDetail,
    ).toEqual(winners[0].answerDetail);
  });

  const asking = () =>
    Object.assign(Object.create(AskingService.prototype), {
      threadResponseRepository: repository,
      threadRepository: new ThreadRepository(tx),
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      wrenAIAdaptor: {
        createTextBasedAnswer: jest.fn(async (input) => ({
          queryId: input.queryId,
        })),
        getTextBasedAnswerResult: jest.fn(async () => ({
          status: 'PREPROCESSING',
        })),
      },
      textBasedAnswerBackgroundTracker: { addTask: jest.fn() },
    });
  const input = () => ({
    language: 'zh-TW',
    nativeQuery: {
      historyId: randomUUID(),
      expected,
      data: { columns: [{ name: 'original_value', type: 'int' }], data: [[1]] },
    },
  });

  it('concurrent original Asking consumers create one AI task with real CAS and then rejoin it', async () => {
    const service = asking();
    const request = input();
    const read = service.getResponse.bind(service);
    let initialReads = 0;
    let release: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(service, 'getResponse').mockImplementation(async (id) => {
      const value = await read(id);
      if (++initialReads <= 2) {
        if (initialReads === 2) release();
        await bothRead;
      }
      return value;
    });
    const replies = await Promise.all([
      service.generateThreadResponseAnswer(expected.id, request),
      service.generateThreadResponseAnswer(expected.id, request),
    ]);
    expect(replies).toHaveLength(2);
    expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
      1,
    );
    expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith({
      queryId: replies[0].answerDetail.queryId,
      query: expected.question,
      sql: expected.sql,
      sqlData: request.nativeQuery.data,
      threadId: String(expected.threadId),
      configurations: { language: request.language },
    });
    const current = await repository.findOneBy({ id: expected.id });
    expect(current.answerDetail).toEqual({
      queryHistoryId: request.nativeQuery.historyId,
      queryId: expect.any(String),
      status: 'PREPROCESSING',
    });
    await service.generateThreadResponseAnswer(expected.id, request);
    expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
      1,
    );
  });

  it('retains the original persisted claim after a lost AI acknowledgement and never creates again', async () => {
    const service = asking();
    const request = input();
    service.wrenAIAdaptor.createTextBasedAnswer.mockRejectedValue(
      new Error('lost native acknowledgement'),
    );
    await expect(
      service.generateThreadResponseAnswer(expected.id, request),
    ).rejects.toThrow('lost native acknowledgement');
    expect(
      (await repository.findOneBy({ id: expected.id })).answerDetail,
    ).toEqual({
      queryHistoryId: request.nativeQuery.historyId,
      queryId: expect.any(String),
      status: 'PREPROCESSING',
    });
    await service.generateThreadResponseAnswer(expected.id, request);
    expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
      1,
    );
  });
});

integration('original Wren query handler, SDK and native history', () => {
  let database: Knex;
  let upstream: HttpServer;
  let native: HttpServer;
  let endpoint: string;
  let directory: string;
  let delivery: NativeQueryDelivery;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let gatewayKeys: Awaited<ReturnType<typeof generateKeyPair>>;
  let queries = 0;
  let peps = 0;
  let denyAt = 0;
  let engineFails = false;
  let observedManifest: unknown;
  let authorizedTarget: Record<string, unknown> | undefined;
  let changeTargetAt = 0;
  let tokenStatus = 200;
  let metadataStatus = 200;
  let metadataErrorBody = '';
  let metadataReads = 0;
  let onPep: (() => Promise<void>) | undefined;
  let rawModel: { id: number };
  let sourceReads = 0;
  let sourceStatus = 200;
  let sourceEvidence: unknown;
  let expectedSourceManifest: unknown;
  let expectedSourceSql: string;
  let onSources: (() => Promise<void>) | undefined;
  let onQuery: (() => Promise<void>) | undefined;
  let deniedSource: string | undefined;
  let sourceChecks: unknown[][];
  const serviceSecret = randomUUID();
  const serviceToken = randomUUID();
  const resource = randomUUID();
  const actor = randomUUID();
  const rawName = `raw_${randomUUID().replaceAll('-', '')}`;
  const rawManifest = {
    catalog: 'wrenai',
    schema: 'public',
    models: [
      {
        name: rawName,
        refSql: 'SELECT 1 AS one',
        cached: false,
        columns: [{ name: 'one', type: 'INTEGER', isCalculated: false }],
      },
    ],
  };
  const input = {
    sql: `SELECT one FROM "${rawName}"`,
    deploymentId: 1,
    deploymentHash: 'a'.repeat(40),
    limit: 5,
  };
  const originalConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const listen = (server: HttpServer) =>
    new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      ),
    );

  beforeAll(async () => {
    database = knex({
      client: 'pg',
      connection: process.env.WREN_QUERY_TEST_DATABASE_URL,
    });
    await database.migrate.latest({
      directory: join(process.cwd(), 'migrations'),
    });
    await database('project')
      .insert({
        id: 1,
        type: 'DUCKDB',
        display_name: 'isolated-query-fixture',
        catalog: 'wrenai',
        schema: 'public',
        connection_info: '{}',
      })
      .onConflict('id')
      .merge();
    rawModel = await new ModelRepository(database).createOne({
      projectId: 1,
      displayName: 'native source fixture',
      referenceName: rawName,
      sourceTableName: 'one',
      refSql: 'SELECT 1 AS one',
      cached: false,
    });
    await database('deploy_log')
      .insert({
        id: 1,
        project_id: 1,
        hash: input.deploymentHash,
        status: 'SUCCESS',
        manifest: JSON.stringify(rawManifest),
        native_object_refs: JSON.stringify([
          { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
        ]),
      })
      .onConflict('id')
      .merge();
    keys = await generateKeyPair('ES256');
    gatewayKeys = await generateKeyPair('ES256');
    directory = mkdtempSync(join(tmpdir(), 'wren-governed-query-'));
    writeFileSync(
      join(directory, 'action-jwks.json'),
      JSON.stringify({
        keys: [
          { ...(await exportJWK(keys.publicKey)), kid: 'action', alg: 'ES256' },
        ],
      }),
    );
    writeFileSync(
      join(directory, 'gateway-jwks.json'),
      JSON.stringify({
        keys: [
          {
            ...(await exportJWK(gatewayKeys.publicKey)),
            kid: 'gateway',
            alg: 'ES256',
          },
        ],
      }),
    );
    writeFileSync(join(directory, 'client-secret'), serviceSecret, {
      mode: 0o600,
    });
    upstream = createServer(async (request, response) => {
      let text = '';
      for await (const chunk of request) text += chunk;
      response.setHeader('content-type', 'application/json');
      if (request.url === '/token') {
        expect(request.headers.authorization).toBe(
          `Basic ${Buffer.from(`wren-binding:${serviceSecret}`).toString('base64')}`,
        );
        expect(text).toBe('grant_type=client_credentials');
        if (tokenStatus !== 200) {
          response.writeHead(tokenStatus).end('{}');
          return;
        }
        response.end(
          JSON.stringify({ token_type: 'Bearer', access_token: serviceToken }),
        );
      } else if (request.url === '/service/v1/adapter/human-action') {
        metadataReads++;
        expect(request.headers.authorization).toBe(`Bearer ${serviceToken}`);
        expect(request.headers['x-kailo-native-human-token']).toBe(
          'fixture-human-token',
        );
        const body = JSON.parse(text);
        expect(body).toEqual({
          bindingId: delivery.bindingId,
          resolveResource: {
            workspaceId: delivery.workspaceId,
            actionKey: 'data_query.describe@v1',
            actionVersion: 1,
            nativeType: 'model',
            nativeRef: '7',
          },
        });
        if (metadataStatus !== 200)
          response.writeHead(metadataStatus).end(metadataErrorBody);
        else
          response.end(
            JSON.stringify({
              resource: {
                resourceId: resource,
                resourceVersion: 1,
                nativeType: 'model',
                nativeRef: '7',
                nativeInstanceRef: delivery.nativeInstanceRef,
                nativeScopeRef: delivery.nativeScopeRef,
              },
            }),
          );
      } else if (request.url === '/service/v1/adapter/pep_check') {
        peps++;
        await onPep?.();
        if (changeTargetAt && peps >= changeTargetAt && authorizedTarget)
          authorizedTarget = {
            ...authorizedTarget,
            nativeRef: 'different-model',
          };
        const body = JSON.parse(text);
        expect(request.headers.authorization).toBe(`Bearer ${serviceToken}`);
        expect(body.bindingId).toBe(delivery.bindingId);
        const claims = JSON.parse(
          Buffer.from(body.actionToken.split('.')[1], 'base64url').toString(),
        );
        const argumentsValue = JSON.parse(body.argumentsJson);
        if (body.sourceResources !== undefined) {
          expect(body.operation).toBe('execute');
          expect(Array.isArray(body.sourceResources)).toBe(true);
          expect(body.sourceResources.length).toBeGreaterThan(0);
          for (const source of body.sourceResources)
            expect(Object.keys(source).sort()).toEqual([
              'nativeRef',
              'nativeType',
            ]);
          sourceChecks.push(body.sourceResources);
        }
        expect(claims.normalized_parameter_hash).toBe(
          digest(
            body.operation === 'execute'
              ? argumentsValue
              : { operation: body.operation, arguments: argumentsValue },
          ),
        );
        if (
          (denyAt && peps >= denyAt) ||
          body.sourceResources?.some(
            (source) => source.nativeRef === deniedSource,
          )
        )
          response.writeHead(403).end('{}');
        else
          response.end(
            JSON.stringify({
              actionExecutionId: claims.action_execution_id,
              operationId: claims.operation_id,
              authorizationMinZedToken: 'actual-fixture-pep-revision',
              ...(body.operation === 'execute' && authorizedTarget
                ? { targetResource: authorizedTarget }
                : {}),
            }),
          );
      } else if (request.url === '/v2/analysis/sql/sources') {
        sourceReads++;
        const body = JSON.parse(text);
        expect(body.sql).toBe(expectedSourceSql);
        expect(
          JSON.parse(Buffer.from(body.manifestStr, 'base64').toString()),
        ).toEqual(expectedSourceManifest);
        await onSources?.();
        response.writeHead(sourceStatus).end(JSON.stringify(sourceEvidence));
      } else if (request.url === '/v1/mdl/preview') {
        await onQuery?.();
        queries++;
        observedManifest = JSON.parse(text).manifest;
        if (engineFails) response.writeHead(503).end('{}');
        else
          response.end(
            JSON.stringify({
              columns: [{ name: 'one', type: 'INTEGER' }],
              data: [[1]],
            }),
          );
      } else if (request.url === '/v1/mdl/dry-run') {
        queries++;
        response.end('[]');
      } else if (
        request.url?.startsWith('/v2/connector/postgres/query') ||
        request.url?.startsWith('/v3/connector/postgres/query')
      ) {
        await onQuery?.();
        queries++;
        const body = JSON.parse(text);
        observedManifest = JSON.parse(
          Buffer.from(body.manifestStr, 'base64').toString(),
        );
        expect(body.sql).toBe(expectedSourceSql);
        expect(body.connectionInfo.connectionUrl).toBeTruthy();
        if (engineFails) response.writeHead(503).end('{}');
        else
          response.end(
            JSON.stringify({
              columns: ['one'],
              dtypes: { one: 'int32' },
              data: [[1]],
            }),
          );
      } else response.writeHead(404).end('{}');
    });
    const source = `http://127.0.0.1:${await listen(upstream)}`;
    mockComponents = {
      projectRepository: new ProjectRepository(database),
      deployLogRepository: new DeployLogRepository(database),
      viewRepository: new ViewRepository(database),
      modelRepository: new ModelRepository(database),
      modelColumnRepository: new ModelColumnRepository(database),
      apiHistoryRepository: new ApiHistoryRepository(database),
      queryService: new QueryService({
        wrenEngineAdaptor: new WrenEngineAdaptor({
          wrenEngineEndpoint: source,
        }),
        ibisAdaptor: new IbisAdaptor({ ibisServerEndpoint: source }),
        telemetry: new PostHogTelemetry(),
      }),
    };
    native = createServer((request, response) => {
      void apiResolver(
        request,
        response,
        { operation: request.url?.split('/').pop() },
        { default: handler, config: routeConfig },
        {
          previewModeId: '',
          previewModeEncryptionKey: '',
          previewModeSigningKey: '',
        },
        false,
      );
    });
    endpoint = `http://127.0.0.1:${await listen(native)}`;
    delivery = {
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: 'isolated-wren-fixture',
      nativeScopeRef: '1',
      projectId: 1,
      projectConnectionDigest: digest({
        type: 'DUCKDB',
        connectionInfo: {},
        catalog: 'wrenai',
        schema: 'public',
      }),
      actionTokenIssuer: `${source}/action`,
      actionTokenAudience: 'wren-binding',
      actionTokenJwksFile: join(directory, 'action-jwks.json'),
      serviceTokenUrl: `${source}/token`,
      serviceClientId: 'wren-binding',
      serviceClientSecretFile: join(directory, 'client-secret'),
      corePepUrl: `${source}/service/v1/adapter/pep_check`,
      requestTimeoutMs: 5000,
      responseMaxBytes: 65536,
      requestMaxBytes: 65536,
      gatewayIssuer: `${source}/gateway`,
      gatewayAudience: 'wren-mcp-transport',
      gatewayCallerId: 'controlled-gateway',
      gatewayJwksFile: join(directory, 'gateway-jwks.json'),
      gatewayMaxTokenSeconds: 60,
      mcpAuthority: new URL(endpoint).host,
    };
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(
      directory,
      'delivery.json',
    );
    writeFileSync(
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
      JSON.stringify(delivery),
    );
  }, 30000);

  beforeEach(async () => {
    queries = 0;
    peps = 0;
    denyAt = 0;
    engineFails = false;
    authorizedTarget = {
      resourceId: resource,
      nativeType: 'model',
      nativeRef: String(rawModel.id),
      nativeInstanceRef: delivery.nativeInstanceRef,
      nativeScopeRef: delivery.nativeScopeRef,
    };
    sourceReads = 0;
    sourceStatus = 200;
    expectedSourceManifest = rawManifest;
    expectedSourceSql = input.sql;
    sourceEvidence = [
      {
        catalog: rawManifest.catalog,
        schemaTable: { schema: rawManifest.schema, table: rawName },
      },
    ];
    onSources = undefined;
    onQuery = undefined;
    deniedSource = undefined;
    sourceChecks = [];
    await database('deploy_log')
      .where({ id: 1 })
      .update({
        manifest: JSON.stringify(rawManifest),
        native_object_refs: JSON.stringify([
          { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
        ]),
      });
    changeTargetAt = 0;
    tokenStatus = 200;
    metadataStatus = 200;
    metadataErrorBody = JSON.stringify({
      class: 'DENIED',
      reason: 'PERMISSION_DENIED',
    });
    metadataReads = 0;
    onPep = undefined;
  });

  it('distinguishes real service-token HTTP 403 from an object read denial through the actual metadata helper', async () => {
    tokenStatus = 403;
    await expect(
      canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
    ).rejects.toMatchObject({ status: 503 });
    expect(metadataReads).toBe(0);
    tokenStatus = 200;
    metadataStatus = 403;
    expect(
      await canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
    ).toBe(false);
    for (const body of [
      JSON.stringify({ class: 'DENIED', reason: 'SCOPE_GUARD_FAILED' }),
      JSON.stringify({ class: 'BLOCKED', reason: 'CAPABILITY_BLOCKED' }),
      '',
      '{',
      '{}',
      JSON.stringify({
        class: 'DENIED',
        reason: 'PERMISSION_DENIED',
        operationId: 7,
      }),
      JSON.stringify({
        class: 'DENIED',
        reason: 'PERMISSION_DENIED',
        extra: true,
      }),
    ]) {
      metadataErrorBody = body;
      await expect(
        canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
      ).rejects.toMatchObject({ resourcePermissionDenied: false });
    }
    metadataErrorBody = JSON.stringify({
      class: 'DENIED',
      reason: 'PERMISSION_DENIED',
      operationId: 'read-operation',
    });
    expect(
      await canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
    ).toBe(false);
    metadataStatus = 503;
    await expect(
      canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
    ).rejects.toMatchObject({ status: 503 });
    metadataStatus = 200;
    expect(
      await canReadNativeMetadata(delivery, 'fixture-human-token', 'model', 7),
    ).toBe(true);
  });

  it('loads only the controlled result policy and rejects retired single-resource query delivery', async () => {
    const humanAction = {
      resultExposurePolicyId: randomUUID(),
      resultExposurePolicyVersion: 1,
    };
    try {
      writeFileSync(
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
        JSON.stringify({ ...delivery, humanAction }),
      );
      expect((await loadQueryDelivery()).humanAction).toEqual(humanAction);
      for (const retired of [
        { resourceId: resource },
        { resourceVersion: 1 },
      ]) {
        writeFileSync(
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
          JSON.stringify({
            ...delivery,
            humanAction: { ...humanAction, ...retired },
          }),
        );
        await expect(loadQueryDelivery()).rejects.toThrow(
          'QUERY_ADMISSION_UNAVAILABLE',
        );
      }
    } finally {
      writeFileSync(
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
        JSON.stringify(delivery),
      );
    }
  });

  afterAll(async () => {
    for (const server of [native, upstream])
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    if (database) {
      if (rawModel) {
        await database('deploy_log')
          .where({ id: 1 })
          .update({
            manifest: JSON.stringify({
              catalog: 'wrenai',
              schema: 'public',
              models: [],
            }),
            native_object_refs: JSON.stringify([]),
          });
        await database('model').where({ id: rawModel.id }).delete();
      }
      await database.destroy();
    }
    if (directory) rmSync(directory, { recursive: true });
    if (originalConfig === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalConfig;
  });

  const signed = async (
    action: string,
    raw: unknown,
    ae = randomUUID(),
    operation = randomUUID(),
    observing = false,
    changedClaims = {},
  ) =>
    new SignJWT({
      tenant_id: delivery.tenantId,
      workspace_id: delivery.workspaceId,
      action_execution_id: ae,
      operation_id: operation,
      actor_principal_id: actor,
      agent_principal_id: actor,
      initiating_human_principal_id: randomUUID(),
      action_key: `${action}@v1`,
      action_definition_version: 1,
      target_type: 'RESOURCE',
      target_id: resource,
      normalized_parameter_hash: digest(
        observing
          ? { operation: 'observe', arguments: raw }
          : { target: { resourceId: resource }, input: raw },
      ),
      authorization_min_zed_token: 'fixture-original',
      delegation_id: randomUUID(),
      delegation_version: 1,
      result_exposure_policy_id: randomUUID(),
      result_exposure_policy_version: 1,
      ...changedClaims,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'action' })
      .setIssuer(delivery.actionTokenIssuer)
      .setAudience(delivery.actionTokenAudience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);

  const call = async (
    token: string,
    key: string,
    action = 'data_query.query',
    argumentsValue: unknown = input,
  ) => {
    const machine = await new SignJWT({ azp: delivery.gatewayCallerId })
      .setProtectedHeader({ alg: 'ES256', kid: 'gateway' })
      .setIssuer(delivery.gatewayIssuer)
      .setAudience(delivery.gatewayAudience)
      .setSubject(delivery.gatewayCallerId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('30s')
      .sign(gatewayKeys.privateKey);
    const client = new Client({ name: 'original-sdk-fixture', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), {
          requestInit: {
            headers: {
              'x-kailo-gateway-authorization': `Bearer ${machine}`,
              authorization: `Bearer ${token}`,
              'idempotency-key': key,
            },
          },
        }),
      );
      return await client.callTool({
        name: action,
        arguments: argumentsValue as Record<string, unknown>,
      });
    } finally {
      await client.close();
    }
  };

  it('validates the actual binding route with fresh secret receipt and native role ACL, rejecting writes and mismatched credentials', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const databaseName = `wrn_${suffix}`;
    const reader = `reader_${suffix}`;
    const writer = `writer_${suffix}`;
    const nativeUrl = new URL(process.env.WREN_QUERY_TEST_DATABASE_URL);
    nativeUrl.pathname = `/${databaseName}`;
    const originalBindingConfig = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    const originalProject = await database('project').where({ id: 1 }).first();
    const originalDigest = delivery.projectConnectionDigest;
    let source: Knex;
    let proxy: HttpServer;
    let reads = 0;
    let wrongCredential = false;
    let wrongServiceCredential = false;
    const requestId = randomUUID();
    const serviceRequestId = randomUUID();
    const reference = {
      secretKey: 'connection',
      locator: 'kv/data/reader',
      version: 7,
      audience: 'wren-binding-reader',
    };
    const serviceReference = {
      secretKey: 'service',
      locator: 'kv/data/service',
      version: 8,
      audience: 'wren-binding-service',
    };
    const binding = {
      bindingId: delivery.bindingId,
      bindingVersion: 1,
      tenantId: delivery.tenantId,
      workspaceId: delivery.workspaceId,
      componentReleaseId: randomUUID(),
      servicePrincipalId: randomUUID(),
      adapterServiceRef: 'native-wren',
      nativeInstanceRef: delivery.nativeInstanceRef,
      nativeScopeRef: delivery.nativeScopeRef,
      isolationMode: 'DEDICATED_INSTANCE',
      normalizedConfig: { projectId: 1 },
      configDigest: digest({ projectId: 1 }),
      secretRefs: [reference, serviceReference],
    };
    const metadata = {
      binding,
      componentTypeKey: 'fixture-data-query',
      protocolRange: { min: 1, max: 1 },
      artifactDigest: 'a'.repeat(64),
      secretSocket: join(directory, 'bao.sock'),
      secretNamespace: `tenants/${delivery.tenantId}`,
      connectionSecretPath: 'kv/data/reader',
      connectionSecretKey: reference.secretKey,
      serviceSecretPath: 'kv/data/service',
      serviceSecretKey: serviceReference.secretKey,
    };
    const key = randomUUID();
    const credential = {
      host: nativeUrl.hostname,
      port: Number(nativeUrl.port || 5432),
      database: databaseName,
      user: reader,
      password: '',
      ssl: false,
    };
    const manage = async (
      operation: string,
      raw: unknown,
      action = 'application_binding.create',
    ) => {
      const token = await new SignJWT({
        tenant_id: delivery.tenantId,
        workspace_id: delivery.workspaceId,
        action_execution_id: randomUUID(),
        operation_id: randomUUID(),
        action_key: action,
        target_type: 'APPLICATION_BINDING',
        target_id: delivery.bindingId,
        authorization_min_zed_token: 'fixture-original',
        normalized_parameter_hash: digest({ operation, arguments: raw }),
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'action' })
        .setIssuer(delivery.actionTokenIssuer)
        .setAudience(delivery.actionTokenAudience)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      return fetch(`${endpoint}/${operation}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
        body: JSON.stringify(raw),
      });
    };
    try {
      // Unique isolated database/roles, never a business datasource or role.
      await database.raw(`create database "${databaseName}"`);
      await database.raw(`create role "${reader}" login`);
      await database.raw(`create role "${writer}"`);
      source = knex({ client: 'pg', connection: nativeUrl.toString() });
      await source.raw(
        `revoke create, temporary on database "${databaseName}" from public`,
      );
      await source.raw('revoke create on schema public from public');
      await source.raw('create table fixture_rows (value integer)');
      await source.raw(`grant select on fixture_rows to "${reader}"`);
      const encrypted = encryptConnectionInfo(
        DataSourceName.POSTGRES,
        credential,
      );
      await database('project')
        .where({ id: 1 })
        .update({
          type: 'POSTGRES',
          connection_info: JSON.stringify(encrypted),
        });
      delivery.projectConnectionDigest = digest({
        type: 'POSTGRES',
        connectionInfo: encrypted,
        catalog: 'wrenai',
        schema: 'public',
      });
      writeFileSync(
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
        JSON.stringify(delivery),
      );
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = join(
        directory,
        'binding.json',
      );
      writeFileSync(
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE,
        JSON.stringify(metadata),
      );
      proxy = createServer((request, response) => {
        reads++;
        expect(request.headers['x-vault-namespace']).toBe(
          `tenants/${delivery.tenantId}`,
        );
        expect(request.headers['x-vault-token']).toBeUndefined();
        expect([
          '/v1/kv/data/reader?version=7',
          '/v1/kv/data/service?version=8',
        ]).toContain(request.url);
        const serviceRead = request.url === '/v1/kv/data/service?version=8';
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            request_id: serviceRead ? serviceRequestId : requestId,
            data: {
              metadata: {
                version: serviceRead ? 8 : 7,
                destroyed: false,
                deletion_time: '',
              },
              data: serviceRead
                ? {
                    value: wrongServiceCredential
                      ? 'wrong-service'
                      : serviceSecret,
                  }
                : {
                    connectionInfo: {
                      ...credential,
                      ...(wrongCredential ? { password: 'wrong-fixture' } : {}),
                    },
                  },
            },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        proxy.listen(metadata.secretSocket, resolve),
      );
      const handshake = {
        idempotencyKey: key,
        componentReleaseId: binding.componentReleaseId,
        componentTypeKey: metadata.componentTypeKey,
        protocolRange: metadata.protocolRange,
      };
      expect(await (await manage('handshake', handshake)).json()).toEqual({
        protocolVersion: '1',
        artifactDigest: metadata.artifactDigest,
      });
      expect(reads).toBe(0);
      const args = { ...binding, idempotencyKey: key };
      const valid = await manage('validate_binding', args);
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({
        bindingId: delivery.bindingId,
        isolationMode: 'DEDICATED_INSTANCE',
        secretReads: [
          {
            secretKey: reference.secretKey,
            version: 7,
            audience: reference.audience,
            requestId,
          },
          {
            secretKey: serviceReference.secretKey,
            version: serviceReference.version,
            audience: serviceReference.audience,
            requestId: serviceRequestId,
          },
        ],
        executionMappings: [
          { actionKey: 'data_query.query@v1', cancelCapability: 'UNSUPPORTED' },
          { actionKey: 'data_query.dry_run@v1' },
          { actionKey: 'data_query.describe@v1' },
        ],
      });
      expect(
        (await manage('validate_binding', args, 'data_query.query')).status,
      ).toBe(403);
      writeFileSync(
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE,
        JSON.stringify({
          ...metadata,
          binding: { ...binding, isolationMode: 'NAMESPACE' },
        }),
      );
      expect(
        (
          await manage('validate_binding', {
            ...args,
            isolationMode: 'NAMESPACE',
          })
        ).status,
      ).toBe(503);
      writeFileSync(
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE,
        JSON.stringify(metadata),
      );
      // The original UI follows getCurrentProject, not an adapter-only id.
      // A different first project must not activate the frozen binding.
      const currentProject = jest.spyOn(
        mockComponents.projectRepository,
        'getCurrentProject',
      );
      currentProject.mockImplementationOnce(async () => ({
        ...(await mockComponents.projectRepository.findOneBy({ id: 1 })),
        id: 2,
      }));
      expect((await manage('validate_binding', args)).status).toBe(403);
      currentProject.mockRestore();
      wrongCredential = true;
      expect((await manage('validate_binding', args)).status).toBe(403);
      wrongCredential = false;
      wrongServiceCredential = true;
      expect((await manage('validate_binding', args)).status).toBe(403);
      wrongServiceCredential = false;
      await source.raw(`grant update on fixture_rows to "${reader}"`);
      expect((await manage('validate_binding', args)).status).toBe(403);
      await source.raw(`revoke update on fixture_rows from "${reader}"`);
      await source.raw(`grant update on fixture_rows to "${writer}"`);
      await source.raw(`grant "${writer}" to "${reader}"`);
      expect((await manage('validate_binding', args)).status).toBe(403);
      await source.raw(`revoke "${writer}" from "${reader}"`);
      expect((await manage('validate_binding', args)).status).toBe(200);
      // A login's default SET ROLE must not hide privileges it can recover with
      // RESET ROLE. Check session_user as well as current_user.
      await source.raw(`revoke update on fixture_rows from "${writer}"`);
      await source.raw(`grant update on fixture_rows to "${reader}"`);
      await source.raw(`grant "${writer}" to "${reader}"`);
      await source.raw(`alter role "${reader}" set role to '${writer}'`);
      expect((await manage('validate_binding', args)).status).toBe(403);
      await source.raw(`alter role "${reader}" reset role`);
      await source.raw(`revoke "${writer}" from "${reader}"`);
      await source.raw(`revoke update on fixture_rows from "${reader}"`);

      // Native ACLs can change without a project/SecretRef revision. Consume
      // the real reader-role probe on original SQL and stored-result paths.
      const completed = await humanReference();
      try {
        const first = await completed.execute(completed.key);
        expect(first.status).toBe(200);
        const result = await first.json();
        expect(result.execution.platformStatus).toBe('SUCCEEDED');
        expect(JSON.parse(result.resultJson).data).toEqual([[1]]);
        expect(queries).toBe(1);
        const stored = await mockComponents.apiHistoryRepository.findOneBy({
          governanceBindingId: delivery.bindingId,
          governanceKey: completed.key,
        });
        await source.raw(`grant update on fixture_rows to "${writer}"`);
        await source.raw(`grant "${writer}" to "${reader}"`);
        await expect(
          completed.service.completedQuerySources(stored, completed.reference),
        ).rejects.toThrow('BINDING_SCOPE_DENIED');
        expect((await completed.execute(completed.key)).status).toBe(403);
        expect(queries).toBe(1);
        expect(
          await mockComponents.apiHistoryRepository.findOneBy({
            governanceBindingId: delivery.bindingId,
            governanceKey: completed.key,
          }),
        ).toMatchObject({
          governanceState: 'SUCCEEDED',
          responsePayload: stored.responsePayload,
        });
        // Metadata-only observation still reconciles the proven native
        // outcome; refusal to disclose is not a fabricated task failure.
        const observation = {
          externalExecutionId: randomUUID(),
          idempotencyKey: completed.key,
          nativeType: result.execution.nativeType,
          nativeId: result.execution.nativeId,
        };
        const observed = await completed.service.observe(
          await completed.signHuman({
            normalized_parameter_hash: digest({
              operation: 'observe',
              arguments: observation,
            }),
          }),
          observation,
        );
        expect(JSON.parse(JSON.stringify(observed))).toMatchObject({
          execution: {
            idempotencyKey: completed.key,
            nativeId: result.execution.nativeId,
            platformStatus: 'SUCCEEDED',
            nativeStatus: 'SUCCEEDED',
            terminalAt: result.execution.terminalAt,
          },
        });
        expect(observed).not.toHaveProperty('resultJson');
        await source.raw(`revoke "${writer}" from "${reader}"`);
        await source.raw(`revoke update on fixture_rows from "${writer}"`);
        expect(
          await completed.service.completedQuerySources(
            stored,
            completed.reference,
          ),
        ).toEqual(stored.requestPayload.nativeSources);
        expect((await completed.execute(completed.key)).status).toBe(200);
        expect(queries).toBe(1);
      } finally {
        await source.raw(`revoke "${writer}" from "${reader}"`);
        await source.raw(`revoke update on fixture_rows from "${writer}"`);
        await database('view').where({ id: completed.view.id }).delete();
      }

      const inFlight = await humanReference();
      try {
        onQuery = async () => {
          await source.raw(`grant update on fixture_rows to "${reader}"`);
        };
        expect((await inFlight.execute(inFlight.key)).status).toBe(403);
        expect(queries).toBe(2);
        const stored = await mockComponents.apiHistoryRepository.findOneBy({
          governanceBindingId: delivery.bindingId,
          governanceKey: inFlight.key,
        });
        expect(stored.governanceState).toBe('SUCCEEDED');
        expect(stored.responsePayload.data).toEqual([[1]]);
        expect((await inFlight.execute(inFlight.key)).status).toBe(403);
        expect(queries).toBe(2);
        onQuery = undefined;
        await source.raw(`revoke update on fixture_rows from "${reader}"`);
        expect((await inFlight.execute(inFlight.key)).status).toBe(200);
        expect(queries).toBe(2);
      } finally {
        onQuery = undefined;
        await source.raw(`revoke update on fixture_rows from "${reader}"`);
        await database('view').where({ id: inFlight.view.id }).delete();
      }

      const beforeQuery = await humanReference();
      const history: ApiHistoryRepository = mockComponents.apiHistoryRepository;
      const originalFreeze = history.freezeGovernedQuerySources.bind(history);
      const freeze = jest
        .spyOn(history, 'freezeGovernedQuerySources')
        .mockImplementation(async (...args) => {
          const frozen = await originalFreeze(...args);
          await source.raw(`grant update on fixture_rows to "${reader}"`);
          return frozen;
        });
      try {
        const rejected = await beforeQuery.execute(beforeQuery.key);
        expect(rejected.status).toBe(200);
        const outcome = await rejected.json();
        expect(outcome.execution.platformStatus).toBe('FAILED');
        expect(outcome).not.toHaveProperty('resultJson');
        expect(queries).toBe(2);
        expect(
          await mockComponents.apiHistoryRepository.findOneBy({
            governanceBindingId: delivery.bindingId,
            governanceKey: beforeQuery.key,
          }),
        ).toMatchObject({
          governanceState: 'FAILED',
          responsePayload: { error: 'NOT_DISPATCHED' },
        });
        freeze.mockRestore();
        await source.raw(`revoke update on fixture_rows from "${reader}"`);
        // A proven-unsent failure remains the same native history, not an
        // invitation to repeat an old admitted intent after privileges change.
        const replay = await beforeQuery.execute(beforeQuery.key);
        expect(replay.status).toBe(200);
        expect((await replay.json()).execution.platformStatus).toBe('FAILED');
        expect(queries).toBe(2);
      } finally {
        freeze.mockRestore();
        await source.raw(`revoke update on fixture_rows from "${reader}"`);
        await database('view').where({ id: beforeQuery.view.id }).delete();
      }
      denyAt = peps + 2;
      expect((await manage('validate_binding', args)).status).toBe(403);
    } finally {
      if (proxy)
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await database('project').where({ id: 1 }).update({
        type: originalProject.type,
        connection_info: originalProject.connection_info,
      });
      delivery.projectConnectionDigest = originalDigest;
      writeFileSync(
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
        JSON.stringify(delivery),
      );
      if (originalBindingConfig === undefined)
        delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
      else
        process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = originalBindingConfig;
      if (source) await source.destroy();
      await database.raw(`drop database if exists "${databaseName}"`);
      await database.raw(`drop role if exists "${reader}"`);
      await database.raw(`drop role if exists "${writer}"`);
    }
  }, 30000);

  it.each(['data_query.query', 'data_query.dry_run'])(
    'attaches %s to the same original SQL-editor history row and never repeats its native call',
    async (action) => {
      const service = new NativeQueryService(
        delivery,
        mockComponents.projectRepository,
        mockComponents.deployLogRepository,
        mockComponents.apiHistoryRepository,
        mockComponents.queryService,
        mockComponents.viewRepository,
        mockComponents.modelRepository,
        mockComponents.modelColumnRepository,
      );
      const key = randomUUID(),
        scope = 'd'.repeat(64);
      const draft = await service.sqlSelection(
        key,
        input.sql,
        input.limit,
        scope,
        `${action}@v1` as 'data_query.query@v1' | 'data_query.dry_run@v1',
      );
      const reference = await service.sqlReference(resource, draft);
      const selection = JSON.parse(reference.nativeObjectRef);
      expect(JSON.stringify(reference)).not.toContain(input.sql);
      const before = await mockComponents.apiHistoryRepository.findOneBy({
        id: selection.historyId,
      });
      expect(before.governanceState).toBeNull();
      expect(before.governanceActionExecutionId).toBeNull();
      expect(before.requestPayload.previewScope).toBe(scope);
      expect(before.requestPayload.sql).toBe(input.sql);
      const awaiting = {
        externalExecutionId: randomUUID(),
        idempotencyKey: key,
        nativeType: 'wren.api_history',
      };
      expect(
        await service.observe(
          await signed(action, awaiting, randomUUID(), randomUUID(), true),
          awaiting,
        ),
      ).toEqual({
        execution: {
          idempotencyKey: key,
          nativeType: 'wren.api_history',
          platformStatus: 'UNKNOWN',
          cancelCapability: 'UNSUPPORTED',
        },
      });
      expect(queries).toBe(0);
      const token = await signed(action, reference);
      const first = (await call(token, key, action, reference))
        .structuredContent as any;
      expect(first.execution.platformStatus).toBe('SUCCEEDED');
      expect(first.execution.nativeId).toBe(selection.historyId);
      expect(queries).toBe(1);
      const after = await mockComponents.apiHistoryRepository.findOneBy({
        id: selection.historyId,
      });
      expect(after.governanceActionExecutionId).toBeTruthy();
      expect(after.requestPayload).toEqual(before.requestPayload);
      expect(
        (
          await database('api_history').where({
            governance_binding_id: delivery.bindingId,
            governance_key: key,
          })
        ).length,
      ).toBe(1);
      const replay = (await call(token, key, action, reference))
        .structuredContent as any;
      expect(replay).toMatchObject({
        execution: {
          nativeId: first.execution.nativeId,
          platformStatus: 'SUCCEEDED',
        },
      });
      expect(JSON.parse(replay.resultJson)).toEqual(
        JSON.parse(first.resultJson),
      );
      expect(queries).toBe(1);
      await expect(
        service.sqlSelection(
          key,
          input.sql,
          input.limit,
          'e'.repeat(64),
          `${action}@v1` as any,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.sqlSelection(
          key,
          `${input.sql} `,
          input.limit,
          scope,
          `${action}@v1` as any,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await mockComponents.apiHistoryRepository.prepareNativeSql({
          ...before,
          requestPayload: { ...before.requestPayload, nativeSources: [] },
        }),
      ).toBeNull();
      const unchanged = await mockComponents.apiHistoryRepository.findOneBy({
        id: after.id,
      });
      expect(unchanged.requestPayload).toEqual(before.requestPayload);
    },
  );

  it('keeps the original prepared SQL history UNKNOWN after transport loss without another native query', async () => {
    const service = new NativeQueryService(
      delivery,
      mockComponents.projectRepository,
      mockComponents.deployLogRepository,
      mockComponents.apiHistoryRepository,
      mockComponents.queryService,
      mockComponents.viewRepository,
      mockComponents.modelRepository,
      mockComponents.modelColumnRepository,
    );
    const key = randomUUID();
    const draft = await service.sqlSelection(
      key,
      input.sql,
      input.limit,
      'f'.repeat(64),
      'data_query.query@v1',
    );
    const reference = await service.sqlReference(resource, draft);
    const token = await signed('data_query.query', reference);
    engineFails = true;
    const first = (await call(token, key, 'data_query.query', reference))
      .structuredContent as any;
    expect(first.execution.platformStatus).toBe('UNKNOWN');
    expect(first.execution.nativeId).toBe(
      JSON.parse(reference.nativeObjectRef).historyId,
    );
    expect(
      (await call(token, key, 'data_query.query', reference)).structuredContent,
    ).toMatchObject({
      execution: {
        nativeId: first.execution.nativeId,
        platformStatus: 'UNKNOWN',
      },
    });
    expect(queries).toBe(1);
    const record = await mockComponents.apiHistoryRepository.findOneBy({
      id: first.execution.nativeId,
    });
    expect(record.governanceState).toBe('UNKNOWN');
    expect(record.responsePayload).toBeNull();
  });

  it('atomically claims one prepared SQL history during competing deliveries without another native task', async () => {
    const service = new NativeQueryService(
      delivery,
      mockComponents.projectRepository,
      mockComponents.deployLogRepository,
      mockComponents.apiHistoryRepository,
      mockComponents.queryService,
      mockComponents.viewRepository,
      mockComponents.modelRepository,
      mockComponents.modelColumnRepository,
    );
    const key = randomUUID();
    const reference = await service.sqlReference(
      resource,
      await service.sqlSelection(
        key,
        input.sql,
        input.limit,
        'd'.repeat(64),
        'data_query.query@v1',
      ),
    );
    const token = await signed('data_query.query', reference);
    let started: () => void, release: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    onQuery = async () => {
      started();
      await wait;
    };
    const pending = call(token, key, 'data_query.query', reference);
    try {
      await entered;
      const competing = (await call(token, key, 'data_query.query', reference))
        .structuredContent as any;
      expect(competing.execution.platformStatus).toBe('UNKNOWN');
      expect(competing.execution.nativeId).toBe(
        JSON.parse(reference.nativeObjectRef).historyId,
      );
      expect(competing.resultJson).toBeUndefined();
    } finally {
      release();
    }
    const first = (await pending).structuredContent as any;
    expect(first.execution.platformStatus).toBe('SUCCEEDED');
    expect(queries).toBe(1);
    expect(
      (
        await database('api_history').where({
          governance_binding_id: delivery.bindingId,
          governance_key: key,
        })
      ).length,
    ).toBe(1);
  });

  it('runs the frozen deployment through the original native QueryService once and reuses native history', async () => {
    const key = randomUUID();
    let beforeSql: any;
    let repeatFreeze: boolean, replaceFreeze: boolean;
    onQuery = async () => {
      beforeSql = await mockComponents.apiHistoryRepository.findOneBy({
        governanceBindingId: delivery.bindingId,
        governanceKey: key,
      });
      repeatFreeze =
        await mockComponents.apiHistoryRepository.freezeGovernedQuerySources(
          beforeSql.id,
          beforeSql.governanceParameterHash,
          beforeSql.requestPayload.nativeSources,
        );
      replaceFreeze =
        await mockComponents.apiHistoryRepository.freezeGovernedQuerySources(
          beforeSql.id,
          beforeSql.governanceParameterHash,
          [],
        );
    };
    const token = await signed('data_query.query', input);
    const first = await call(token, key);
    const result = first.structuredContent as any;
    expect(result.execution.platformStatus).toBe('SUCCEEDED');
    expect(JSON.parse(result.resultJson).data).toEqual([[1]]);
    expect(observedManifest).toEqual(rawManifest);
    expect(beforeSql.governanceState).toBe('UNKNOWN');
    expect(beforeSql.requestPayload.nativeSources).toEqual([
      { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
    ]);
    expect(repeatFreeze).toBe(true);
    expect(replaceFreeze).toBe(false);
    expect((await call(token, key)).structuredContent).toMatchObject({
      execution: {
        nativeId: result.execution.nativeId,
        platformStatus: 'SUCCEEDED',
      },
    });
    expect(queries).toBe(1);
    expect(sourceReads).toBe(2);
    const stored = await database('api_history')
      .where({ id: result.execution.nativeId })
      .first();
    expect(stored.governance_parameter_hash).toBe(
      digest({ target: { resourceId: resource }, input }),
    );
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(serviceSecret);
    expect(JSON.stringify(stored)).not.toContain(serviceToken);
  });

  it('consumes every original captured model through the same execute PEP and result envelope, including revocation', async () => {
    const dependentName = `dependent_${randomUUID().replaceAll('-', '')}`;
    const [dependent] = await database('model')
      .insert({
        project_id: delivery.projectId,
        display_name: dependentName,
        reference_name: dependentName,
        ref_sql: 'SELECT 2 AS two',
        cached: false,
      })
      .returning('id');
    const manifest = {
      ...rawManifest,
      models: [
        ...rawManifest.models,
        {
          name: dependentName,
          refSql: 'SELECT 2 AS two',
          cached: false,
          columns: [{ name: 'two', type: 'INTEGER', isCalculated: false }],
        },
      ],
    };
    const nativeSources = [
      { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
      {
        nativeType: 'model',
        nativeId: dependent.id,
        nativeName: dependentName,
      },
    ];
    const expected = nativeSources.map((source) => ({
      nativeType: source.nativeType,
      nativeRef: String(source.nativeId),
    }));
    const selected = {
      ...input,
      sql: `SELECT one FROM "${rawName}" WHERE EXISTS (SELECT two FROM "${dependentName}")`,
    };
    expectedSourceSql = selected.sql;
    expectedSourceManifest = manifest;
    sourceEvidence = [
      ...(sourceEvidence as unknown[]),
      {
        catalog: manifest.catalog,
        schemaTable: { schema: manifest.schema, table: dependentName },
      },
    ];
    await database('deploy_log')
      .where({ id: input.deploymentId })
      .update({
        manifest: JSON.stringify(manifest),
        native_object_refs: JSON.stringify(nativeSources),
      });
    try {
      const key = randomUUID();
      const token = await signed('data_query.query', selected);
      onQuery = async () => {
        expect(sourceChecks.length).toBeGreaterThan(0);
      };
      const first = (await call(token, key, 'data_query.query', selected))
        .structuredContent as any;
      expect(first.execution.platformStatus).toBe('SUCCEEDED');
      expect(first.sourceResources).toEqual(expected);
      expect(
        sourceChecks.every(
          (check) => JSON.stringify(check) === JSON.stringify(expected),
        ),
      ).toBe(true);
      expect(queries).toBe(1);
      const record = await mockComponents.apiHistoryRepository.findOneBy({
        id: first.execution.nativeId,
      });
      expect(record.requestPayload.nativeSources).toEqual(nativeSources);
      deniedSource = String(dependent.id);
      await expect(
        call(token, key, 'data_query.query', selected),
      ).rejects.toThrow('QUERY_ADMISSION_UNAVAILABLE');
      expect(queries).toBe(1);
      expect(
        (
          await mockComponents.apiHistoryRepository.findOneBy({
            id: first.execution.nativeId,
          })
        ).governanceState,
      ).toBe('SUCCEEDED');
      const refused = (
        await call(
          await signed('data_query.query', selected),
          randomUUID(),
          'data_query.query',
          selected,
        )
      ).structuredContent as any;
      expect(refused.execution.platformStatus).toBe('FAILED');
      expect(refused.resultJson).toBeUndefined();
      expect(queries).toBe(1);
    } finally {
      await database('model').where({ id: dependent.id }).del();
    }
  });

  it('never backfills or replaces completed history sources to make a replay disclose data', async () => {
    const key = randomUUID();
    const token = await signed('data_query.query', input);
    const first = (await call(token, key)).structuredContent as any;
    const stored = await mockComponents.apiHistoryRepository.findOneBy({
      id: first.execution.nativeId,
    });
    const changed = { ...stored.requestPayload, nativeSources: [] };
    await mockComponents.apiHistoryRepository.updateOne(stored.id, {
      requestPayload: changed,
    });
    try {
      await expect(call(token, key)).rejects.toThrow(
        'QUERY_EVIDENCE_UNAVAILABLE',
      );
      expect(queries).toBe(1);
      const after = await mockComponents.apiHistoryRepository.findOneBy({
        id: stored.id,
      });
      expect(after.governanceState).toBe('SUCCEEDED');
      expect(after.requestPayload.nativeSources).toEqual([]);
    } finally {
      await mockComponents.apiHistoryRepository.updateOne(stored.id, {
        requestPayload: stored.requestPayload,
      });
    }
  });

  it.each([
    ['empty', () => []],
    [
      'duplicate source',
      () => [
        ...(sourceEvidence as unknown[]),
        ...(sourceEvidence as unknown[]),
      ],
    ],
    ['unknown response', () => ({ sources: [] })],
    ['null response', () => null],
    [
      'other native model',
      () => [
        {
          catalog: rawManifest.catalog,
          schemaTable: { schema: rawManifest.schema, table: 'another-model' },
        },
      ],
    ],
    [
      'hidden or descriptor dependency',
      () => [
        ...(sourceEvidence as unknown[]),
        {
          catalog: rawManifest.catalog,
          schemaTable: { schema: rawManifest.schema, table: 'dependent-model' },
        },
      ],
    ],
    [
      'foreign catalog',
      () => [
        {
          catalog: 'another-catalog',
          schemaTable: { schema: rawManifest.schema, table: rawName },
        },
      ],
    ],
    [
      'foreign schema',
      () => [
        {
          catalog: rawManifest.catalog,
          schemaTable: { schema: 'another-schema', table: rawName },
        },
      ],
    ],
    [
      'physical source instead of captured model',
      () => [
        {
          catalog: rawManifest.catalog,
          schemaTable: { schema: rawManifest.schema, table: 'physical-source' },
        },
      ],
    ],
    [
      'missing namespace',
      () => [{ schemaTable: { schema: rawManifest.schema, table: rawName } }],
    ],
    [
      'unknown field',
      () => [
        {
          ...(sourceEvidence as Record<string, unknown>[])[0],
          authorized: true,
        },
      ],
    ],
    [
      'malformed native object',
      () => [
        {
          catalog: rawManifest.catalog,
          schemaTable: { schema: rawManifest.schema, table: null },
        },
      ],
    ],
    [
      'oversized native evidence',
      () => [
        {
          catalog: rawManifest.catalog,
          schemaTable: {
            schema: rawManifest.schema,
            table: rawName.repeat(delivery.responseMaxBytes),
          },
        },
      ],
    ],
  ])(
    'refuses %s source evidence before native SQL and records an unsent original history',
    async (_name, evidence) => {
      sourceEvidence = (evidence as () => unknown)();
      const key = randomUUID();
      const token = await signed('data_query.query', input);
      const result = (await call(token, key)).structuredContent as any;
      expect(result.execution.platformStatus).toBe('FAILED');
      expect(result.resultJson).toBeUndefined();
      expect(queries).toBe(0);
      expect(sourceReads).toBe(1);
      const stored = await database('api_history')
        .where({ id: result.execution.nativeId })
        .first();
      expect(stored).toMatchObject({
        governance_state: 'FAILED',
        response_payload: { error: 'NOT_DISPATCHED' },
        status_code: 403,
        duration_ms: 0,
      });
      expect((await call(token, key)).structuredContent).toMatchObject({
        execution: {
          nativeId: result.execution.nativeId,
          platformStatus: 'FAILED',
        },
      });
      expect(queries).toBe(0);
      expect(sourceReads).toBe(1);
    },
  );

  it('does not dispatch SQL when the original Engine source-analysis request fails', async () => {
    sourceStatus = 503;
    const result = (
      await call(await signed('data_query.query', input), randomUUID())
    ).structuredContent as any;
    expect(result.execution.platformStatus).toBe('FAILED');
    expect(result.resultJson).toBeUndefined();
    expect(sourceReads).toBe(1);
    expect(queries).toBe(0);
  });

  it('does not select a first captured object when the original model and view share a native name', async () => {
    const [view] = await database('view')
      .insert({
        project_id: delivery.projectId,
        name: rawName,
        statement: input.sql,
        cached: false,
      })
      .returning('id');
    const manifest = {
      ...rawManifest,
      views: [
        {
          name: rawName,
          statement: input.sql,
          properties: { viewId: String(view.id) },
        },
      ],
    };
    await database('deploy_log')
      .where({ id: input.deploymentId })
      .update({
        manifest: JSON.stringify(manifest),
        native_object_refs: JSON.stringify([
          { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
          { nativeType: 'view', nativeId: view.id, nativeName: rawName },
        ]),
      });
    try {
      expectedSourceManifest = manifest;
      const result = (
        await call(await signed('data_query.query', input), randomUUID())
      ).structuredContent as any;
      expect(result.execution.platformStatus).toBe('FAILED');
      expect(result.resultJson).toBeUndefined();
      expect(queries).toBe(0);
      expect(sourceReads).toBe(1);
    } finally {
      await database('view').where({ id: view.id }).del();
    }
  });

  it('enforces the delivered response bound in the actual original QueryService source read', async () => {
    sourceEvidence = [
      {
        catalog: rawManifest.catalog,
        schemaTable: {
          schema: rawManifest.schema,
          table: rawName.repeat(delivery.responseMaxBytes),
        },
      },
    ];
    await expect(
      mockComponents.queryService.sourceObjects(input.sql, {
        manifest: rawManifest,
        timeoutMs: delivery.requestTimeoutMs,
        responseMaxBytes: delivery.responseMaxBytes,
      }),
    ).rejects.toThrow('Native source evidence unavailable');
    expect(sourceReads).toBe(1);
    expect(queries).toBe(0);
  });

  it.each([
    'permission',
    'target',
    'model alias',
    'manifest',
    'native capture',
  ])(
    'rechecks actual %s changed during native source analysis before original SQL dispatch',
    async (changed) => {
      onSources = async () => {
        if (changed === 'permission') denyAt = peps + 1;
        if (changed === 'target') authorizedTarget.nativeRef = 'another-model';
        if (changed === 'model alias')
          await database('model')
            .where({ id: rawModel.id })
            .update({ reference_name: 'changed-alias' });
        if (changed === 'manifest')
          await database('deploy_log')
            .where({ id: 1 })
            .update({
              manifest: JSON.stringify({ ...rawManifest, models: [] }),
            });
        if (changed === 'native capture')
          await database('deploy_log')
            .where({ id: 1 })
            .update({ native_object_refs: JSON.stringify([]) });
      };
      try {
        const result = (
          await call(await signed('data_query.query', input), randomUUID())
        ).structuredContent as any;
        expect(result.execution.platformStatus).toBe('FAILED');
        expect(result.resultJson).toBeUndefined();
        expect(sourceReads).toBe(1);
        expect(queries).toBe(0);
        const stored = await database('api_history')
          .where({ id: result.execution.nativeId })
          .first();
        expect(stored.response_payload).toEqual({ error: 'NOT_DISPATCHED' });
        expect(stored.duration_ms).toBe(0);
      } finally {
        await database('model')
          .where({ id: rawModel.id })
          .update({ reference_name: rawName });
      }
    },
  );

  it('rechecks native source evidence before completed result disclosure without reexecuting or rewriting success', async () => {
    const key = randomUUID();
    const token = await signed('data_query.query', input);
    const first = (await call(token, key)).structuredContent as any;
    expect(first.execution.platformStatus).toBe('SUCCEEDED');
    sourceEvidence = [];
    await expect(call(token, key)).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(queries).toBe(1);
    expect(sourceReads).toBe(2);
    const stored = await database('api_history')
      .where({ id: first.execution.nativeId })
      .first();
    expect(stored.governance_state).toBe('SUCCEEDED');
    expect(stored.response_payload.data).toEqual([[1]]);
  });

  it('does not let the same AE change its native key or frozen SQL', async () => {
    const token = await signed('data_query.query', input);
    await call(token, randomUUID());
    await expect(call(token, randomUUID())).rejects.toThrow(
      'QUERY_ADMISSION_UNAVAILABLE',
    );
    await expect(
      call(token, randomUUID(), 'data_query.query', {
        ...input,
        sql: 'SELECT 2',
      }),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(queries).toBe(1);
  });

  it('keeps an uncertain native call UNKNOWN without replay, and observes metadata only', async () => {
    engineFails = true;
    const key = randomUUID();
    const ae = randomUUID();
    const operation = randomUUID();
    const token = await signed('data_query.query', input, ae, operation);
    const first = (await call(token, key)).structuredContent as any;
    expect(first.execution.platformStatus).toBe('UNKNOWN');
    expect(first.resultJson).toBeUndefined();
    await call(token, key);
    expect(queries).toBe(1);
    const reference = {
      externalExecutionId: randomUUID(),
      idempotencyKey: key,
      nativeType: 'wren.api_history',
      nativeId: first.execution.nativeId,
    };
    const response = await fetch(`${endpoint}/observe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await signed('data_query.query', reference, ae, operation, true)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(reference),
    });
    expect(response.status).toBe(200);
    const observation = await response.json();
    expect(Object.keys(observation)).toEqual(['execution']);
    expect(observation.execution).toMatchObject({
      platformStatus: 'UNKNOWN',
      nativeId: first.execution.nativeId,
      nativeType: 'wren.api_history',
      cancelCapability: 'UNSUPPORTED',
      idempotencyKey: key,
    });
    expect(observation.execution.terminalAt).toBeUndefined();
    expect(queries).toBe(1);
  });

  it('fresh denial before the native call is a proven unsent failure, not an infinite UNKNOWN', async () => {
    denyAt = 2;
    const result = (
      await call(await signed('data_query.query', input), randomUUID())
    ).structuredContent as any;
    expect(result.execution.platformStatus).toBe('FAILED');
    expect(queries).toBe(0);
  });

  it('does not disclose a completed query after fresh authorization is revoked', async () => {
    onPep = async () => {
      if (queries === 1) denyAt = peps;
    };
    const ae = randomUUID();
    const key = randomUUID();
    const token = await signed('data_query.query', input, ae);
    await expect(call(token, key)).rejects.toThrow(
      'QUERY_ADMISSION_UNAVAILABLE',
    );
    expect(queries).toBe(1);
    const stored = await database('api_history')
      .where({ governance_action_execution_id: ae })
      .first();
    expect(stored.governance_state).toBe('SUCCEEDED');
    await expect(call(token, key)).rejects.toThrow(
      'QUERY_ADMISSION_UNAVAILABLE',
    );
    expect(queries).toBe(1);
  });

  it('denies stale deployment and changed native credentials before invoking the engine', async () => {
    const stale = { ...input, deploymentHash: 'b'.repeat(40) };
    await expect(
      call(
        await signed('data_query.query', stale),
        randomUUID(),
        'data_query.query',
        stale,
      ),
    ).rejects.toThrow('QUERY_DEPLOYMENT_CHANGED');
    await database('project')
      .where({ id: 1 })
      .update({ connection_info: '{"changed":true}' });
    try {
      await expect(
        call(await signed('data_query.query', input), randomUUID()),
      ).rejects.toThrow('QUERY_NATIVE_SCOPE_CHANGED');
    } finally {
      await database('project')
        .where({ id: 1 })
        .update({ connection_info: '{}' });
    }
    expect(queries).toBe(0);
  });

  const description = async () => {
    const models = await Promise.all(
      ['authorized', 'other'].map((kind) =>
        mockComponents.modelRepository.createOne({
          projectId: 1,
          displayName: kind,
          referenceName: `${kind}_${randomUUID().replaceAll('-', '')}`,
          sourceTableName: kind,
          refSql: `SELECT 'private-${kind}-sql'`,
          cached: false,
        }),
      ),
    );
    const manifest = {
      catalog: 'wrenai',
      schema: 'public',
      models: models.map((model) => ({
        name: model.referenceName,
        refSql: model.refSql,
        cached: false,
        columns: [
          {
            name: `${model.displayName}_column`,
            type: 'INTEGER',
            isCalculated: false,
          },
        ],
      })),
    };
    const captures = models.map((model) => ({
      nativeType: 'model',
      nativeId: model.id,
      nativeName: model.referenceName,
    }));
    await database('deploy_log')
      .where({ id: 1 })
      .update({
        manifest: JSON.stringify(manifest),
        native_object_refs: JSON.stringify(captures),
      });
    authorizedTarget = {
      resourceId: resource,
      nativeType: 'model',
      nativeRef: String(models[0].id),
      nativeInstanceRef: delivery.nativeInstanceRef,
      nativeScopeRef: delivery.nativeScopeRef,
    };
    const expected = {
      deploymentId: 1,
      deploymentHash: input.deploymentHash,
      models: [
        {
          name: models[0].referenceName,
          columns: [{ name: 'authorized_column', type: 'INTEGER' }],
        },
      ],
    };
    const execute = (token: string, key: string, target = resource) =>
      fetch(`${endpoint}/execute`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          actionKey: 'data_query.describe@v1',
          idempotencyKey: key,
          arguments: { target: { resourceId: target }, input: {} },
        }),
      });
    const clean = async () => {
      await database('deploy_log')
        .where({ id: 1 })
        .update({
          manifest: JSON.stringify({
            catalog: 'wrenai',
            schema: 'public',
            models: [],
          }),
          native_object_refs: JSON.stringify([]),
        });
      await database('model')
        .whereIn(
          'id',
          models.map((model) => model.id),
        )
        .delete();
    };
    return { models, manifest, captures, expected, execute, clean };
  };

  it('describes exactly the Core-authorized captured model through real MCP and HTTP execute without revealing other models or SQL', async () => {
    const { expected, models, execute, clean } = await description();
    try {
      const ae = randomUUID(),
        key = randomUUID();
      const token = await signed(
        'data_query.describe',
        {},
        ae,
        randomUUID(),
        false,
        {
          targetResource: {
            ...authorizedTarget,
            nativeRef: String(models[1].id),
          },
        },
      );
      const first = (await call(token, key, 'data_query.describe', {}))
        .structuredContent as any;
      expect(first.execution.platformStatus).toBe('SUCCEEDED');
      expect(JSON.parse(first.resultJson)).toEqual(expected);
      expect(first.resultJson).not.toContain(models[1].referenceName);
      expect(first.resultJson).not.toContain('private-');
      const response = await execute(
        await signed('data_query.describe', {}),
        randomUUID(),
      );
      expect(response.status).toBe(200);
      expect(JSON.parse((await response.json()).resultJson)).toEqual(expected);
      const replay = (await call(token, key, 'data_query.describe', {}))
        .structuredContent as any;
      expect(replay).toMatchObject({
        execution: {
          nativeId: first.execution.nativeId,
          platformStatus: 'SUCCEEDED',
        },
      });
      expect(JSON.parse(replay.resultJson)).toEqual(expected);
      expect(queries).toBe(0);
    } finally {
      await clean();
    }
  });

  it.each([
    'absent',
    'resourceId',
    'nativeType',
    'nativeRef',
    'nativeInstanceRef',
    'nativeScopeRef',
  ])(
    'does not describe a model when authoritative target %s is missing or foreign',
    async (field) => {
      const { clean } = await description();
      try {
        if (field === 'absent') authorizedTarget = undefined;
        else
          authorizedTarget[field] =
            field === 'resourceId' ? randomUUID() : 'foreign';
        await expect(
          call(
            await signed('data_query.describe', {}),
            randomUUID(),
            'data_query.describe',
            {},
          ),
        ).rejects.toThrow('QUERY_SCOPE_DENIED');
        expect(queries).toBe(0);
      } finally {
        await clean();
      }
    },
  );

  it.each(['legacy', 'same-name-replacement'])(
    'does not infer describe authorization from a current model name when capture is %s',
    async (kind) => {
      const { models, captures, clean } = await description();
      try {
        await database('deploy_log')
          .where({ id: 1 })
          .update({
            native_object_refs:
              kind === 'legacy'
                ? null
                : JSON.stringify([
                    { ...captures[0], nativeId: models[1].id },
                    { ...captures[1], nativeId: models[0].id },
                  ]),
          });
        await expect(
          call(
            await signed('data_query.describe', {}),
            randomUUID(),
            'data_query.describe',
            {},
          ),
        ).rejects.toThrow(
          kind === 'legacy'
            ? 'QUERY_EVIDENCE_UNAVAILABLE'
            : 'QUERY_REFERENCE_CHANGED',
        );
        expect(queries).toBe(0);
      } finally {
        await clean();
      }
    },
  );

  it('denies a submitted HTTP describe target different from the frozen action target before PEP or native execution', async () => {
    const { execute, clean } = await description();
    try {
      const response = await execute(
        await signed('data_query.describe', {}),
        randomUUID(),
        randomUUID(),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'QUERY_SCOPE_DENIED' });
      expect(peps).toBe(0);
      expect(queries).toBe(0);
    } finally {
      await clean();
    }
  });

  it.each(['permission', 'target', 'manifest', 'model'])(
    'does not disclose completed describe metadata when final %s evidence changes',
    async (kind) => {
      const { models, manifest, clean } = await description();
      const ae = randomUUID(),
        key = randomUUID();
      try {
        if (kind === 'permission') denyAt = 3;
        if (kind === 'target') changeTargetAt = 3;
        if (kind === 'manifest')
          onPep = async () => {
            if (peps === 3)
              await database('deploy_log')
                .where({ id: 1 })
                .update({
                  manifest: JSON.stringify({
                    ...manifest,
                    models: manifest.models.map((model) => ({
                      ...model,
                      columns: [],
                    })),
                  }),
                });
          };
        if (kind === 'model')
          onPep = async () => {
            if (peps === 3)
              await database('model')
                .where({ id: models[0].id })
                .update({ reference_name: 'changed-native-name' });
          };
        await expect(
          call(
            await signed('data_query.describe', {}, ae),
            key,
            'data_query.describe',
            {},
          ),
        ).rejects.toThrow(
          kind === 'permission'
            ? 'QUERY_ADMISSION_UNAVAILABLE'
            : kind === 'target'
              ? 'QUERY_SCOPE_DENIED'
              : 'QUERY_REFERENCE_CHANGED',
        );
        const stored = await database('api_history')
          .where({ governance_action_execution_id: ae })
          .first();
        expect(stored.governance_state).toBe('SUCCEEDED');
        expect(stored.response_payload.models).toHaveLength(1);
        expect(stored.response_payload.models[0].name).toBe(
          models[0].referenceName,
        );
        expect(queries).toBe(0);
      } finally {
        await clean();
      }
    },
  );

  it('keeps describe replay on its original captured deployment after a newer deployment becomes current', async () => {
    const { models, manifest, captures, expected, clean } = await description();
    const deploymentId = Number.parseInt(randomUUID().slice(0, 7), 16);
    const key = randomUUID(),
      token = await signed('data_query.describe', {});
    try {
      const original = (await call(token, key, 'data_query.describe', {}))
        .structuredContent as any;
      await database('deploy_log').insert({
        id: deploymentId,
        project_id: 1,
        hash: 'b'.repeat(40),
        status: 'SUCCESS',
        manifest: JSON.stringify({
          ...manifest,
          models: manifest.models.map((model) => ({ ...model, columns: [] })),
        }),
        native_object_refs: JSON.stringify(captures),
      });
      expect(
        (await mockComponents.deployLogRepository.findLastProjectDeployLog(1))
          .id,
      ).toBe(deploymentId);
      const replay = (await call(token, key, 'data_query.describe', {}))
        .structuredContent as any;
      expect(replay.execution.nativeId).toBe(original.execution.nativeId);
      expect(JSON.parse(replay.resultJson)).toEqual(expected);
      expect(replay.resultJson).not.toContain(models[1].referenceName);
      expect(queries).toBe(0);
    } finally {
      await database('deploy_log').where({ id: deploymentId }).delete();
      await clean();
    }
  });

  it('returns the contracted execution envelope for an absent native history without claiming a writer fence or result', async () => {
    const reference = {
      externalExecutionId: randomUUID(),
      idempotencyKey: randomUUID(),
      nativeType: 'wren.api_history',
    };
    const response = await fetch(`${endpoint}/observe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await signed('data_query.query', reference, randomUUID(), randomUUID(), true)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(reference),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      execution: {
        idempotencyKey: reference.idempotencyKey,
        nativeType: reference.nativeType,
        platformStatus: 'UNKNOWN',
        cancelCapability: 'UNSUPPORTED',
      },
    });
    expect(queries).toBe(0);
  });

  it('preserves the original native dry-run execution path', async () => {
    const dry = (
      await call(
        await signed('data_query.dry_run', input),
        randomUUID(),
        'data_query.dry_run',
      )
    ).structuredContent as any;
    expect(JSON.parse(dry.resultJson).valid).toBe(true);
    expect(queries).toBe(1);
  });

  it('rejects anonymous, browser-cookie and cross-origin machine calls before query admission', async () => {
    expect((await fetch(`${endpoint}/mcp`, { method: 'POST' })).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${endpoint}/mcp`, {
          method: 'POST',
          headers: { cookie: 'native-session=untrusted' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${endpoint}/mcp`, {
          method: 'POST',
          headers: { origin: 'https://native.invalid' },
        })
      ).status,
    ).toBe(403);
    expect(queries).toBe(0);
    expect(peps).toBe(0);
  });

  const humanReference = async (kind: 'view' | 'model' = 'view') => {
    const view =
      kind === 'view'
        ? await mockComponents.viewRepository.createOne({
            projectId: 1,
            name: `reference_${randomUUID()}`,
            statement: input.sql,
            cached: false,
          })
        : await mockComponents.modelRepository.createOne({
            projectId: 1,
            displayName: 'governed model',
            referenceName: `model_${randomUUID().replaceAll('-', '')}`,
            sourceTableName: 'source',
            refSql: 'SELECT 1',
            cached: false,
          });
    const manifest = {
      ...rawManifest,
      models: [
        ...rawManifest.models,
        ...(kind === 'model'
          ? [{ ...rawManifest.models[0], name: view.referenceName }]
          : []),
      ],
      views:
        kind === 'view'
          ? [
              {
                name: view.name,
                statement: view.statement,
                properties: { viewId: String(view.id) },
              },
            ]
          : [],
    };
    await database('deploy_log')
      .where({ id: input.deploymentId })
      .update({
        manifest: JSON.stringify(manifest),
        native_object_refs: JSON.stringify([
          { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
          {
            nativeType: kind,
            nativeId: view.id,
            nativeName: kind === 'model' ? view.referenceName : view.name,
          },
        ]),
      });
    expectedSourceManifest = manifest;
    expectedSourceSql =
      kind === 'model'
        ? `select * from "${view.referenceName}"`
        : view.statement;
    sourceEvidence = [
      {
        catalog: rawManifest.catalog,
        schemaTable: {
          schema: rawManifest.schema,
          table: kind === 'model' ? view.referenceName : rawName,
        },
      },
    ];
    const service = new NativeQueryService(
      delivery,
      mockComponents.projectRepository,
      mockComponents.deployLogRepository,
      mockComponents.apiHistoryRepository,
      mockComponents.queryService,
      mockComponents.viewRepository,
      mockComponents.modelRepository,
      mockComponents.modelColumnRepository,
    );
    const reference =
      kind === 'view'
        ? await service.reference(resource, view.id, 5)
        : await service.modelReference(resource, view.id, 5);
    authorizedTarget = {
      resourceId: resource,
      nativeType: kind,
      nativeRef: String(view.id),
      nativeInstanceRef: delivery.nativeInstanceRef,
      nativeScopeRef: delivery.nativeScopeRef,
    };
    expect(JSON.stringify(reference)).not.toContain('SELECT');
    const ae = randomUUID(),
      operation = randomUUID(),
      key = randomUUID();
    const humanClaims = {
      tenant_id: delivery.tenantId,
      workspace_id: delivery.workspaceId,
      action_execution_id: ae,
      operation_id: operation,
      actor_principal_id: actor,
      initiating_human_principal_id: actor,
      action_key: 'data_query.query@v1',
      action_definition_version: 1,
      target_type: 'RESOURCE',
      target_id: resource,
      normalized_parameter_hash: digest({
        target: { resourceId: resource },
        input: reference,
      }),
      authorization_min_zed_token: 'fixture-original',
      external_execution_id: randomUUID(),
      idempotency_key: key,
      result_exposure_policy_id: randomUUID(),
      result_exposure_policy_version: 1,
    };
    const signHuman = (changed = {}) =>
      new SignJWT({ ...humanClaims, ...changed })
        .setProtectedHeader({ alg: 'ES256', kid: 'action' })
        .setIssuer(delivery.actionTokenIssuer)
        .setAudience(delivery.actionTokenAudience)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const token = await signHuman();
    const execute = (requestKey: string, ticket = token) =>
      fetch(`${endpoint}/execute`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ticket}`,
          'content-type': 'application/json',
          'idempotency-key': requestKey,
        },
        body: JSON.stringify({
          actionKey: 'data_query.query@v1',
          idempotencyKey: requestKey,
          arguments: { target: { resourceId: resource }, input: reference },
        }),
      });
    return { view, service, reference, ae, operation, key, signHuman, execute };
  };

  it('executes the HUMAN model selection once through the actual adapter and rejects changed columns before SQL', async () => {
    const {
      view: model,
      service,
      reference,
      key,
      execute,
    } = await humanReference('model');
    try {
      expect(JSON.parse(reference.nativeObjectRef)).toMatchObject({
        modelId: model.id,
        deploymentHash: input.deploymentHash,
      });
      expect((await execute(key)).status).toBe(200);
      expect(queries).toBe(1);
      expect((await execute(key)).status).toBe(200);
      expect(queries).toBe(1);
      const record = await mockComponents.apiHistoryRepository.findOneBy({
        governanceBindingId: delivery.bindingId,
        governanceKey: key,
      });
      expect(record.requestPayload.sql).toBe(
        `select * from "${model.referenceName}"`,
      );
      await mockComponents.modelColumnRepository.createOne({
        modelId: model.id,
        displayName: 'Changed',
        referenceName: 'changed',
        sourceColumnName: 'changed',
        type: 'INTEGER',
        isCalculated: false,
        notNull: false,
        isPk: false,
      });
      expect((await execute(key)).status).toBe(412);
      expect(queries).toBe(1);
      await database('model_column').where({ model_id: model.id }).delete();
      await database('model').where({ id: model.id }).delete();
      await expect(
        service.modelReference(resource, model.id, 5),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    } finally {
      await database('model_column').where({ model_id: model.id }).delete();
      await database('model').where({ id: model.id }).delete();
    }
  });

  it.each([
    'missing',
    'resourceId',
    'nativeType',
    'nativeRef',
    'nativeInstanceRef',
    'nativeScopeRef',
  ])(
    'refuses HUMAN model execution with %s exact-target evidence and records a proven unsent outcome',
    async (field) => {
      const {
        view: model,
        key,
        signHuman,
        execute,
      } = await humanReference('model');
      const forgedFacts = authorizedTarget;
      if (field === 'missing') authorizedTarget = undefined;
      else
        authorizedTarget = {
          ...authorizedTarget,
          [field]: 'another-native-target',
        };
      try {
        expect(
          (await execute(key, await signHuman({ targetResource: forgedFacts })))
            .status,
        ).toBe(403);
        expect(queries).toBe(0);
        const record = await mockComponents.apiHistoryRepository.findOneBy({
          governanceBindingId: delivery.bindingId,
          governanceKey: key,
        });
        expect(record.governanceState).toBe('FAILED');
      } finally {
        await database('model').where({ id: model.id }).delete();
      }
    },
  );

  it.each(['before SQL', 'after SQL'])(
    'rechecks exact target facts %s before returning native results',
    async (at) => {
      const { view: model, key, execute } = await humanReference('model');
      onPep = async () => {
        if (
          (at === 'before SQL' && peps >= 2) ||
          (at === 'after SQL' && queries === 1)
        )
          authorizedTarget = {
            ...authorizedTarget,
            nativeRef: 'different-model',
          };
      };
      try {
        const response = await execute(key);
        if (at === 'before SQL') {
          expect(response.status).toBe(200);
          expect((await response.json()).execution.platformStatus).toBe(
            'FAILED',
          );
          expect(queries).toBe(0);
        } else {
          expect(response.status).toBe(403);
          expect(queries).toBe(1);
          const record = await mockComponents.apiHistoryRepository.findOneBy({
            governanceBindingId: delivery.bindingId,
            governanceKey: key,
          });
          expect(record.governanceState).toBe('SUCCEEDED');
        }
      } finally {
        await database('model').where({ id: model.id }).delete();
      }
    },
  );

  it('executes a HUMAN view reference through the real handler once, binds its key and refuses changed native content', async () => {
    const { view, ae, operation, key, execute } = await humanReference();
    try {
      expect((await execute(randomUUID())).status).toBe(403);
      expect(queries).toBe(0);
      const first = await execute(key);
      expect(first.status).toBe(200);
      const result = await first.json();
      expect(result.execution.platformStatus).toBe('SUCCEEDED');
      expect(JSON.parse(result.resultJson).data).toEqual([[1]]);
      expect(queries).toBe(1);
      expect((await execute(key)).status).toBe(200);
      expect(queries).toBe(1);
      await database('view')
        .where({ id: view.id })
        .update({ statement: 'SELECT 2' });
      expect((await execute(key)).status).toBe(412);
      expect(queries).toBe(1);
      const stored = await mockComponents.apiHistoryRepository.findOneBy({
        governanceBindingId: delivery.bindingId,
        governanceKey: key,
      });
      expect(stored.governanceActionExecutionId).toBe(ae);
      expect(stored.governanceOperationId).toBe(operation);
      expect(stored.requestPayload.sql).toBe(input.sql);
      expect(stored.governanceState).toBe('SUCCEEDED');
    } finally {
      await database('view').where({ id: view.id }).delete();
    }
  });

  it('uses the same frozen view and dependency IDs for execution and the actual HUMAN result provenance consumer', async () => {
    const { view, service, reference, key, execute } = await humanReference();
    try {
      expect((await execute(key)).status).toBe(200);
      const stored = await mockComponents.apiHistoryRepository.findOneBy({
        governanceBindingId: delivery.bindingId,
        governanceKey: key,
      });
      const expected = [
        { nativeType: 'model', nativeId: rawModel.id, nativeName: rawName },
        { nativeType: 'view', nativeId: view.id, nativeName: view.name },
      ];
      expect(stored.requestPayload.nativeSources).toEqual(expected);
      expect(await service.completedQuerySources(stored, reference)).toEqual(
        expected,
      );
      sourceEvidence = [];
      await expect(
        service.completedQuerySources(stored, reference),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(queries).toBe(1);
      await expect(
        service.completedQuerySources(
          {
            ...stored,
            requestPayload: {
              ...stored.requestPayload,
              nativeSources: undefined,
            },
          },
          reference,
        ),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    } finally {
      await database('view').where({ id: view.id }).delete();
    }
  });

  it.each(['view', 'connection', 'deployment'])(
    'records a proven unsent HUMAN %s refusal in original native history',
    async (changed) => {
      const { view, service, key, signHuman, execute } = await humanReference();
      const originalProject = await database('project')
        .where({ id: 1 })
        .first();
      try {
        if (changed === 'view') {
          await database('view')
            .where({ id: view.id })
            .update({ statement: 'SELECT 2' });
        }
        if (changed === 'connection') {
          await database('project')
            .where({ id: 1 })
            .update({ connection_info: '{"changed":true}' });
        } else if (changed === 'deployment') {
          await database('deploy_log')
            .where({ id: input.deploymentId })
            .update({ status: 'FAILED' });
        }
        const external = randomUUID();
        const claims = {
          idempotency_key: key,
          external_execution_id: external,
        };
        expect((await execute(key, await signHuman(claims))).status).toBe(412);
        expect(queries).toBe(0);
        const ref = {
          externalExecutionId: external,
          idempotencyKey: key,
          nativeType: 'wren.api_history',
        };
        const observed = await service.observe(
          await signHuman({
            ...claims,
            normalized_parameter_hash: digest({
              operation: 'observe',
              arguments: ref,
            }),
          }),
          ref,
        );
        expect(observed).toMatchObject({
          execution: {
            platformStatus: 'FAILED',
            nativeId: expect.any(String),
            terminalAt: expect.any(Date),
          },
        });
      } finally {
        await database('project')
          .where({ id: 1 })
          .update({ connection_info: originalProject.connection_info });
        await database('deploy_log')
          .where({ id: input.deploymentId })
          .update({ status: 'SUCCESS' });
        await database('view').where({ id: view.id }).delete();
      }
    },
  );
});

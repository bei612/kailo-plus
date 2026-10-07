import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
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
import { ApiHistoryRepository } from './apollo/server/repositories/apiHistoryRepository';
import { QueryService } from './apollo/server/services/queryService';
import { NativeQueryService } from './apollo/server/services/nativeQueryService';
import { WrenEngineAdaptor } from './apollo/server/adaptors/wrenEngineAdaptor';
import { IbisAdaptor } from './apollo/server/adaptors/ibisAdaptor';
import { encryptConnectionInfo } from './apollo/server/dataSource';
import { DataSourceName } from './apollo/server/types';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import {
  digest,
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
  const serviceSecret = randomUUID();
  const serviceToken = randomUUID();
  const resource = randomUUID();
  const actor = randomUUID();
  const input = {
    sql: 'SELECT 1',
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
    await database('deploy_log')
      .insert({
        id: 1,
        project_id: 1,
        hash: input.deploymentHash,
        status: 'SUCCESS',
        manifest: JSON.stringify({
          catalog: 'wrenai',
          schema: 'public',
          models: [],
        }),
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
        response.end(
          JSON.stringify({ token_type: 'Bearer', access_token: serviceToken }),
        );
      } else if (request.url === '/service/v1/adapter/pep_check') {
        peps++;
        if (changeTargetAt && peps >= changeTargetAt && authorizedTarget)
          authorizedTarget = { ...authorizedTarget, nativeRef: 'different-model' };
        const body = JSON.parse(text);
        expect(request.headers.authorization).toBe(`Bearer ${serviceToken}`);
        expect(body.bindingId).toBe(delivery.bindingId);
        const claims = JSON.parse(
          Buffer.from(body.actionToken.split('.')[1], 'base64url').toString(),
        );
        const argumentsValue = JSON.parse(body.argumentsJson);
        expect(claims.normalized_parameter_hash).toBe(
          digest(
            body.operation === 'execute'
              ? argumentsValue
              : { operation: body.operation, arguments: argumentsValue },
          ),
        );
        if (denyAt && peps >= denyAt) response.writeHead(403).end('{}');
        else
          response.end(
            JSON.stringify({
              actionExecutionId: claims.action_execution_id,
              operationId: claims.operation_id,
              authorizationMinZedToken: 'actual-fixture-pep-revision',
              ...(body.operation === 'execute' && authorizedTarget ? { targetResource: authorizedTarget } : {}),
            }),
          );
      } else if (request.url === '/v1/mdl/preview') {
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

  beforeEach(() => {
    queries = 0;
    peps = 0;
    denyAt = 0;
    engineFails = false;
    authorizedTarget = undefined;
    changeTargetAt = 0;
  });

  afterAll(async () => {
    for (const server of [native, upstream])
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    if (database) await database.destroy();
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
  ) =>
    new SignJWT({
      tenant_id: delivery.tenantId,
      workspace_id: delivery.workspaceId,
      action_execution_id: ae,
      operation_id: operation,
      actor_principal_id: actor,
      agent_principal_id: actor,
      initiating_human_principal_id: randomUUID(),
      action_key: action,
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
    const requestId = randomUUID();
    const reference = {
      secretKey: 'connection',
      locator: 'kv/data/reader',
      version: 7,
      audience: 'wren-binding-reader',
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
      secretRefs: [reference],
    };
    const metadata = {
      binding,
      componentTypeKey: 'fixture-data-query',
      protocolRange: { min: 1, max: 1 },
      artifactDigest: `sha256:${'a'.repeat(64)}`,
      secretSocket: join(directory, 'bao.sock'),
      secretNamespace: `tenants/${delivery.tenantId}`,
      connectionSecretPath: 'kv/data/reader',
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
        expect(request.url).toBe('/v1/kv/data/reader?version=7');
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            request_id: requestId,
            data: {
              metadata: { version: 7, destroyed: false, deletion_time: '' },
              data: {
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
        ],
        executionMappings: [
          { actionKey: 'data_query.query', cancelCapability: 'UNSUPPORTED' },
          { actionKey: 'data_query.dry_run' },
          { actionKey: 'data_query.describe' },
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
      const currentProject = jest.spyOn(mockComponents.projectRepository, 'getCurrentProject');
      currentProject.mockImplementationOnce(async () => ({
        ...(await mockComponents.projectRepository.findOneBy({ id: 1 })),
        id: 2,
      }));
      expect((await manage('validate_binding', args)).status).toBe(403);
      currentProject.mockRestore();
      wrongCredential = true;
      expect((await manage('validate_binding', args)).status).toBe(403);
      wrongCredential = false;
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

  it('runs the frozen deployment through the original native QueryService once and reuses native history', async () => {
    const key = randomUUID();
    const token = await signed('data_query.query', input);
    const first = await call(token, key);
    const result = first.structuredContent as any;
    expect(result.execution.platformStatus).toBe('SUCCEEDED');
    expect(JSON.parse(result.resultJson).data).toEqual([[1]]);
    expect(observedManifest).toEqual({
      catalog: 'wrenai',
      schema: 'public',
      models: [],
    });
    expect((await call(token, key)).structuredContent).toMatchObject({
      execution: {
        nativeId: result.execution.nativeId,
        platformStatus: 'SUCCEEDED',
      },
    });
    expect(queries).toBe(1);
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
    expect(await response.json()).toMatchObject({
      platformStatus: 'UNKNOWN',
      nativeId: first.execution.nativeId,
    });
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
    denyAt = 3;
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

  it('describes only scoped metadata and preserves the native dry-run path', async () => {
    const result = (
      await call(
        await signed('data_query.describe', {}),
        randomUUID(),
        'data_query.describe',
        {},
      )
    ).structuredContent as any;
    expect(JSON.parse(result.resultJson)).toEqual({
      deploymentId: 1,
      deploymentHash: input.deploymentHash,
      models: [],
    });
    expect(queries).toBe(0);
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
    const view = kind === 'view'
      ? await mockComponents.viewRepository.createOne({ projectId: 1, name: `reference_${randomUUID()}`,
        statement: 'SELECT 1', cached: false })
      : await mockComponents.modelRepository.createOne({ projectId: 1, displayName: 'governed model',
        referenceName: `model_${randomUUID().replaceAll('-', '')}`, sourceTableName: 'source', refSql: 'SELECT 1', cached: false });
    const service = new NativeQueryService(delivery, mockComponents.projectRepository,
      mockComponents.deployLogRepository, mockComponents.apiHistoryRepository, mockComponents.queryService,
      mockComponents.viewRepository, mockComponents.modelRepository, mockComponents.modelColumnRepository);
    const reference = kind === 'view' ? await service.reference(resource, view.id, 5)
      : await service.modelReference(resource, view.id, 5);
    authorizedTarget = { resourceId: resource, nativeType: kind, nativeRef: String(view.id),
      nativeInstanceRef: delivery.nativeInstanceRef, nativeScopeRef: delivery.nativeScopeRef };
    expect(JSON.stringify(reference)).not.toContain('SELECT');
    const ae = randomUUID(), operation = randomUUID(), key = randomUUID();
    const humanClaims = {
      tenant_id: delivery.tenantId, workspace_id: delivery.workspaceId,
      action_execution_id: ae, operation_id: operation, actor_principal_id: actor,
      initiating_human_principal_id: actor, action_key: 'data_query.query', action_definition_version: 1,
      target_type: 'RESOURCE', target_id: resource, normalized_parameter_hash: digest({ target: { resourceId: resource }, input: reference }),
      authorization_min_zed_token: 'fixture-original', external_execution_id: randomUUID(), idempotency_key: key,
      result_exposure_policy_id: randomUUID(), result_exposure_policy_version: 1,
    };
    const signHuman = (changed = {}) => new SignJWT({ ...humanClaims, ...changed })
      .setProtectedHeader({ alg: 'ES256', kid: 'action' }).setIssuer(delivery.actionTokenIssuer)
      .setAudience(delivery.actionTokenAudience).setJti(randomUUID()).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const token = await signHuman();
    const execute = (requestKey: string, ticket = token) => fetch(`${endpoint}/execute`, { method: 'POST',
      headers: { authorization: `Bearer ${ticket}`, 'content-type': 'application/json', 'idempotency-key': requestKey },
      body: JSON.stringify({ actionKey: 'data_query.query', idempotencyKey: requestKey,
        arguments: { target: { resourceId: resource }, input: reference } }),
    });
    return { view, service, reference, ae, operation, key, signHuman, execute };
  };

  it('executes the HUMAN model selection once through the actual adapter and rejects changed columns before SQL', async () => {
    const { view: model, service, reference, key, execute } = await humanReference('model');
    try {
      expect(JSON.parse(reference.nativeObjectRef)).toMatchObject({ modelId: model.id, deploymentHash: input.deploymentHash });
      expect((await execute(key)).status).toBe(200);
      expect(queries).toBe(1);
      expect((await execute(key)).status).toBe(200);
      expect(queries).toBe(1);
      const record = await mockComponents.apiHistoryRepository.findOneBy({ governanceBindingId: delivery.bindingId, governanceKey: key });
      expect(record.requestPayload.sql).toBe(`select * from "${model.referenceName}"`);
      await mockComponents.modelColumnRepository.createOne({ modelId: model.id, displayName: 'Changed',
        referenceName: 'changed', sourceColumnName: 'changed', type: 'INTEGER', isCalculated: false, notNull: false, isPk: false });
      expect((await execute(key)).status).toBe(412);
      expect(queries).toBe(1);
      await database('model_column').where({ model_id: model.id }).delete();
      await database('model').where({ id: model.id }).delete();
      await expect(service.modelReference(resource, model.id, 5)).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    } finally {
      await database('model_column').where({ model_id: model.id }).delete();
      await database('model').where({ id: model.id }).delete();
    }
  });

  it.each(['missing', 'resourceId', 'nativeType', 'nativeRef', 'nativeInstanceRef', 'nativeScopeRef'])(
    'refuses HUMAN model execution with %s exact-target evidence and records a proven unsent outcome', async (field) => {
      const { view: model, key, signHuman, execute } = await humanReference('model');
      const forgedFacts = authorizedTarget;
      if (field === 'missing') authorizedTarget = undefined;
      else authorizedTarget = { ...authorizedTarget, [field]: 'another-native-target' };
      try {
        expect((await execute(key, await signHuman({ targetResource: forgedFacts }))).status).toBe(403);
        expect(queries).toBe(0);
        const record = await mockComponents.apiHistoryRepository.findOneBy({ governanceBindingId: delivery.bindingId, governanceKey: key });
        expect(record.governanceState).toBe('FAILED');
      } finally {
        await database('model').where({ id: model.id }).delete();
      }
    },
  );

  it.each([2, 3])('rechecks exact target facts at PEP %s before SQL or result disclosure', async (at) => {
    const { view: model, key, execute } = await humanReference('model');
    changeTargetAt = at;
    try {
      const response = await execute(key);
      if (at === 2) {
        expect(response.status).toBe(200);
        expect((await response.json()).execution.platformStatus).toBe('FAILED');
        expect(queries).toBe(0);
      } else {
        expect(response.status).toBe(403);
        expect(queries).toBe(1);
        const record = await mockComponents.apiHistoryRepository.findOneBy({ governanceBindingId: delivery.bindingId, governanceKey: key });
        expect(record.governanceState).toBe('SUCCEEDED');
      }
    } finally { await database('model').where({ id: model.id }).delete(); }
  });

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
      await database('view').where({ id: view.id }).update({ statement: 'SELECT 2' });
      expect((await execute(key)).status).toBe(412);
      expect(queries).toBe(1);
      const stored = await mockComponents.apiHistoryRepository.findOneBy({ governanceBindingId: delivery.bindingId, governanceKey: key });
      expect(stored.governanceActionExecutionId).toBe(ae);
      expect(stored.governanceOperationId).toBe(operation);
      expect(stored.requestPayload.sql).toBe('SELECT 1');
      expect(stored.governanceState).toBe('SUCCEEDED');
    } finally {
      await database('view').where({ id: view.id }).delete();
    }
  });

  it.each(['view', 'connection', 'deployment'])('records a proven unsent HUMAN %s refusal in original native history', async (changed) => {
    const { view, service, key, signHuman, execute } = await humanReference();
    const originalProject = await database('project').where({ id: 1 }).first();
    try {
      if (changed === 'view') {
        await database('view').where({ id: view.id }).update({ statement: 'SELECT 2' });
      }
      if (changed === 'connection') {
        await database('project').where({ id: 1 }).update({ connection_info: '{"changed":true}' });
      } else if (changed === 'deployment') {
        await database('deploy_log').where({ id: input.deploymentId }).update({ status: 'FAILED' });
      }
      const external = randomUUID();
      const claims = { idempotency_key: key, external_execution_id: external };
      expect((await execute(key, await signHuman(claims))).status).toBe(412);
      expect(queries).toBe(0);
      const ref = { externalExecutionId: external, idempotencyKey: key, nativeType: 'wren.api_history' };
      const observed = await service.observe(await signHuman({ ...claims,
        normalized_parameter_hash: digest({ operation: 'observe', arguments: ref }) }), ref);
      expect(observed).toMatchObject({ platformStatus: 'FAILED', nativeId: expect.any(String), terminalAt: expect.any(Date) });
    } finally {
      await database('project').where({ id: 1 }).update({ connection_info: originalProject.connection_info });
      await database('deploy_log').where({ id: input.deploymentId }).update({ status: 'SUCCESS' });
      await database('view').where({ id: view.id }).delete();
    }
  });
});

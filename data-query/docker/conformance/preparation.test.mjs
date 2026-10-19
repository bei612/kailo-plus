// Post-implementation refusal checks only. No fake GraphQL/AI response,
// SUCCESS row, SQL result or passing conformance vector is created here.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  prepareNativeFixture,
  openPreparationScope,
  openProvider,
  verifyNativeModelSource,
} from './provider.mjs';
import { Refused, canonical } from '../../../client-kit/adapter/protocol.mjs';

const require = createRequire(
  new URL('../../wren-ui/package.json', import.meta.url),
);
const knex = require('knex');
const digest = (value) =>
  createHash('sha256').update(canonical(value)).digest('hex');
let directory, owner, db, name, project, preparation, config, configurationFile;
let originalFetch,
  originalIdentity,
  requests = 0;
const writeJson = async (name, data) => {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(data), { mode: 0o600 });
  return path;
};
const denied = (error) => error instanceof Refused && error.status === 503;

before(async () => {
  assert.ok(process.env.WREN_QUERY_TEST_DATABASE_URL);
  assert.ok(process.env.WREN_CONFORMANCE_TEST_MIGRATIONS);
  owner = knex({
    client: 'pg',
    connection: process.env.WREN_QUERY_TEST_DATABASE_URL,
  });
  name = `wren_prepare_${randomUUID().replaceAll('-', '')}`;
  await owner.raw('CREATE DATABASE ??', [name]);
  const connection = new URL(process.env.WREN_QUERY_TEST_DATABASE_URL);
  connection.pathname = '/' + name;
  db = knex({ client: 'pg', connection: connection.toString() });
  await db.migrate.latest({
    directory: process.env.WREN_CONFORMANCE_TEST_MIGRATIONS,
  });
  directory = await mkdtemp(join(tmpdir(), 'wren-prepare-refusal-'));
  const databaseUrlFile = join(directory, 'database-url');
  await writeFile(databaseUrlFile, connection.toString(), { mode: 0o600 });
  const humanTokenFile = join(directory, 'human-token');
  // Never dispatched: all cases must refuse before the actual HTTP boundary.
  await writeFile(humanTokenFile, randomUUID(), { mode: 0o600 });
  [project] = await db('project')
    .insert({
      type: 'POSTGRES',
      display_name: 'isolated refusal check',
      catalog: 'fixture',
      schema: 'public',
      connection_info: '{}',
    })
    .returning('*');
  const [model] = await db('model')
    .insert({
      project_id: project.id,
      display_name: 'source',
      reference_name: 'source',
      source_table_name: 'source',
      ref_sql: 'SELECT 1 AS value',
      cached: false,
    })
    .returning('*');
  await db('model_column').insert({
    model_id: model.id,
    display_name: 'value',
    reference_name: 'value',
    source_column_name: 'value',
    type: 'INTEGER',
    is_calculated: false,
    not_null: false,
    is_pk: false,
  });
  const nativeOrigin = 'http://isolated.invalid';
  originalIdentity = process.env.WREN_NATIVE_IDENTITY_JSON;
  process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
    publicOrigin: nativeOrigin,
  });
  const query = {
    bindingId: randomUUID(),
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    nativeInstanceRef: 'refusal-only',
    nativeScopeRef: String(project.id),
    projectId: project.id,
    projectConnectionDigest: digest({
      type: project.type,
      connectionInfo: {},
      catalog: project.catalog,
      schema: project.schema,
    }),
    requestTimeoutMs: 1000,
    requestMaxBytes: 65536,
  };
  const artifactDigest = digest('refusal-only-not-an-artifact');
  preparation = {
    graphqlUrl: `${nativeOrigin}/api/graphql`,
    publicOrigin: nativeOrigin,
    humanTokenFile,
    projectId: project.id,
    modelId: model.id,
    manifest: {
      catalog: project.catalog,
      schema: project.schema,
      models: [
        {
          name: model.reference_name,
          refSql: model.ref_sql,
          columns: [{ name: 'value', type: 'INTEGER' }],
        },
      ],
    },
  };
  config = {
    mode: 'CONFORMANCE_ONLY',
    databaseUrlFile,
    nativeFixtureFile: join(directory, 'native-fixture.json'),
    preparationFile: await writeJson('preparation.json', preparation),
    queryFile: await writeJson('query.json', query),
    bindingFile: await writeJson('binding.json', {
      artifactDigest,
      binding: { ...query, isolationMode: 'DEDICATED_INSTANCE' },
    }),
    environmentFile: await writeJson('environment.json', {
      artifactDigest,
      adapterBaseUrl: nativeOrigin,
      maxResponseBytes: 65536,
    }),
  };
  configurationFile = await writeJson('provider.json', config);
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Unexpected HTTP dispatch');
  };
});

test(
  'query provider passes its frozen generation to the real native admission consumer',
  {
    skip: !process.env.WREN_CONFORMANCE_NATIVE_CONFIG,
  },
  async () => {
    // Read only the fixture deployed by original DeployService. The test creates
    // neither a SUCCESS row nor query results, and uses an ephemeral test signer,
    // not Core's conformance identity or a production authorization grant.
    const delivered = JSON.parse(
      await readFile(process.env.WREN_CONFORMANCE_NATIVE_CONFIG, 'utf8'),
    );
    const registration = JSON.parse(
      await readFile(
        new URL(
          '../../../contracts/adapter/data_query.v2/registration.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const selected = JSON.parse(registration.testVectorsJson).cases.find(
      (value) => value.steps[0].contractKey === 'data_query.describe@v2',
    );
    const { generateKeyPair, exportJWK, SignJWT } = require('jose');
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: randomUUID() };
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const environment = JSON.parse(
      await readFile(delivered.environmentFile, 'utf8'),
    );
    const query = {
      ...JSON.parse(await readFile(delivered.queryFile, 'utf8')),
      actionTokenIssuer: origin,
      actionTokenAudience: randomUUID(),
      actionTokenJwksFile: await writeJson('query-jwks.json', { keys: [jwk] }),
      serviceTokenUrl: `${origin}/token`,
      corePepUrl: `${origin}/service/v1/adapter/pep_check`,
    };
    const contexts = selected.steps.flatMap((step) =>
      [step.stepKey, `permission-denied:${step.stepKey}`].map((stepKey) => ({
        caseKey: `${registration.categoryKey}:${registration.contractVersion}:${selected.caseKey}`,
        stepKey,
        operation: 'execute',
        actionKey: step.contractKey,
        actorPrincipalId: randomUUID(),
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        targetType: 'RESOURCE',
        targetId: step.referenceResourceId,
        externalExecutionId: randomUUID(),
        actionDefinitionVersion: 1,
        resultExposurePolicyId: randomUUID(),
        resultExposurePolicyVersion: 1,
        authorizationMinZedToken: randomUUID(),
      })),
    );
    // Core freezes protocol probes separately and prefixes capability cases.
    // Repeated idempotency probes may legitimately share the same exact actor
    // and resource context; uniqueness is by case/step/operation, not claims.
    contexts.push({
      ...contexts[0],
      caseKey: 'protocol_execution_idempotency',
      stepKey: 'first',
    });
    const protocolContexts = [
      'observe',
      'reconcile',
      'map_native_status_error',
    ].map((operation) => {
      const { externalExecutionId, ...context } = contexts[0];
      return {
        ...context,
        caseKey: 'protocol_execution_idempotency',
        stepKey: operation,
        operation,
      };
    });
    const managementContexts = ['handshake', 'validate_binding'].map(
      (operation) => ({
        caseKey:
          operation === 'handshake' ? 'protocol_handshake' : 'protocol_binding',
        stepKey: operation,
        operation,
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        actorPrincipalId: randomUUID(),
        actionKey: 'application_binding.create',
        actionDefinitionVersion: 1,
        targetType: 'APPLICATION_BINDING',
        targetId: query.bindingId,
        authorizationMinZedToken: randomUUID(),
      }),
    );
    contexts.push(...protocolContexts, ...managementContexts);
    const identity = {
      issuer: query.actionTokenIssuer,
      audience: query.actionTokenAudience,
      artifactDigest: environment.artifactDigest,
      jwksFile: query.actionTokenJwksFile,
      tokenSeconds: 60,
      contexts,
    };
    const isolated = {
      ...delivered,
      listenHost: '127.0.0.1',
      listenPort: port,
      queryFile: await writeJson('query-consumer.json', query),
      identityFile: await writeJson('query-identity.json', identity),
      registrationFile: await writeJson(
        'query-registration.json',
        registration,
      ),
      databaseUrlFile: join(
        new URL('.', `file://${process.env.WREN_CONFORMANCE_NATIVE_CONFIG}`)
          .pathname,
        'database-url',
      ),
    };
    const path = await writeJson('query-provider.json', isolated);
    for (const generation of [
      undefined,
      null,
      0,
      -1,
      1.5,
      '1',
      Number.MAX_SAFE_INTEGER + 1,
      {},
    ]) {
      await writeFile(
        path,
        JSON.stringify({ ...isolated, preparationGeneration: generation }),
      );
      await assert.rejects(async () => {
        const unexpected = await openProvider(path);
        await unexpected.close();
      }, denied);
    }
    // data_query@1 writes Wren's generated deployment ID/hash as literals
    // (DD-124(3)); the provider refuses it instead of matching the fixture.
    const literal = JSON.parse(
      await readFile(
        new URL(
          '../../../contracts/adapter/data_query.v1/registration.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await writeFile(
      path,
      JSON.stringify({
        ...isolated,
        registrationFile: await writeJson(
          'query-registration-v1.json',
          literal,
        ),
      }),
    );
    await assert.rejects(async () => {
      const unexpected = await openProvider(path);
      await unexpected.close();
    }, denied);
    await writeFile(path, JSON.stringify(isolated));
    const provider = await openProvider(path);
    require('ts-node').register({
      transpileOnly: true,
      skipProject: true,
      compilerOptions: {
        module: 'CommonJS',
        target: 'ES2020',
        esModuleInterop: true,
      },
    });
    const { authorizeQuery } = require(
      new URL(
        '../../wren-ui/src/apollo/server/services/nativeQueryAdmission.ts',
        import.meta.url,
      ).pathname,
    );
    const signed = async (context, args) =>
      new SignJWT({
        tenant_id: context.tenantId,
        workspace_id: context.workspaceId,
        action_key: context.actionKey,
        actor_principal_id: context.actorPrincipalId,
        initiating_human_principal_id: context.actorPrincipalId,
        target_type: context.targetType,
        target_id: context.targetId,
        external_execution_id: context.externalExecutionId,
        action_definition_version: context.actionDefinitionVersion,
        result_exposure_policy_id: context.resultExposurePolicyId,
        result_exposure_policy_version: context.resultExposurePolicyVersion,
        authorization_min_zed_token: context.authorizationMinZedToken,
        action_execution_id: randomUUID(),
        operation_id: randomUUID(),
        normalized_parameter_hash: digest(
          context.operation === 'execute'
            ? args
            : { operation: context.operation, arguments: args },
        ),
      })
        .setProtectedHeader({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })
        .setIssuer(identity.issuer)
        .setAudience(identity.audience)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(`${identity.tokenSeconds}s`)
        .sign(privateKey);
    try {
      await new Promise((resolve) =>
        provider.server.listen(port, isolated.listenHost, resolve),
      );
      globalThis.fetch = originalFetch;
      for (const step of selected.steps) {
        const args = {
          target: { resourceId: step.referenceResourceId },
          input: JSON.parse(step.inputJson),
        };
        const allowed = contexts.find(
          (context) => context.stepKey === step.stepKey,
        );
        const admitted = await authorizeQuery(
          query,
          await signed(allowed, args),
          'execute',
          args,
        );
        assert.equal(
          admitted.bindingGeneration,
          isolated.preparationGeneration,
        );
        assert.equal(
          admitted.targetResource.nativeRef,
          String(
            JSON.parse(await readFile(isolated.nativeFixtureFile, 'utf8'))
              .modelId,
          ),
        );
        const forbidden = contexts.find(
          (context) => context.stepKey === `permission-denied:${step.stepKey}`,
        );
        await assert.rejects(
          authorizeQuery(query, await signed(forbidden, args), 'execute', args),
          (error) =>
            error.status === 403 && error.resourcePermissionDenied === true,
        );
      }
      for (const context of [...protocolContexts, ...managementContexts]) {
        const args = { idempotencyKey: randomUUID() };
        const admitted = await authorizeQuery(
          query,
          await signed(context, args),
          context.operation,
          args,
        );
        assert.equal(admitted.action_key, context.actionKey);
        assert.equal(admitted.bindingGeneration, undefined);
        assert.equal(admitted.targetResource, undefined);
      }
      const step = selected.steps[0];
      const args = {
        target: { resourceId: step.referenceResourceId },
        input: JSON.parse(step.inputJson),
      };
      const token = await signed(contexts[0], args);
      await writeFile(
        path,
        JSON.stringify({
          ...isolated,
          preparationGeneration: isolated.preparationGeneration + 1,
        }),
      );
      await assert.rejects(
        authorizeQuery(query, token, 'execute', args),
        (error) => error.status === 503,
      );
    } finally {
      globalThis.fetch = async () => {
        requests++;
        throw new Error('Unexpected HTTP dispatch');
      };
      await provider.close();
    }
  },
);

after(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (originalIdentity === undefined)
    delete process.env.WREN_NATIVE_IDENTITY_JSON;
  else process.env.WREN_NATIVE_IDENTITY_JSON = originalIdentity;
  if (db) await db.destroy();
  if (owner) {
    if (name) await owner.raw('DROP DATABASE ??', [name]);
    await owner.destroy();
  }
  if (directory) await rm(directory, { recursive: true });
});

test('original table-reference MDL omits null refSql but still pins its physical source', () => {
  const tableReference = {
    catalog: 'native',
    schema: 'public',
    table: 'source',
  };
  const model = { properties: JSON.stringify(tableReference), ref_sql: null };
  const manifestModel = { tableReference };
  assert.doesNotThrow(() => verifyNativeModelSource(model, manifestModel));
  assert.doesNotThrow(() =>
    verifyNativeModelSource(model, { ...manifestModel, refSql: null }),
  );
  for (const key of ['catalog', 'schema', 'table']) {
    assert.throws(
      () =>
        verifyNativeModelSource(model, {
          tableReference: { ...tableReference, [key]: 'changed' },
        }),
      denied,
    );
  }
  assert.throws(() => verifyNativeModelSource(model, {}), denied);
  assert.throws(
    () =>
      verifyNativeModelSource(model, {
        ...manifestModel,
        refSql: 'SELECT 1 AS value',
      }),
    denied,
  );
  assert.throws(() => verifyNativeModelSource({ ref_sql: null }, {}), denied);
  const sqlModel = { ref_sql: 'SELECT 1 AS value' };
  assert.doesNotThrow(() =>
    verifyNativeModelSource(sqlModel, { refSql: sqlModel.ref_sql }),
  );
  assert.throws(() => verifyNativeModelSource(sqlModel, manifestModel), denied);
  assert.throws(
    () =>
      verifyNativeModelSource(sqlModel, {
        refSql: 'SELECT 2 AS value',
      }),
    denied,
  );
});

test('ambiguous original current-project refuses before GraphQL can deploy another project', async () => {
  const [other] = await db('project')
    .insert({
      type: 'POSTGRES',
      display_name: 'other native project',
      catalog: project.catalog,
      schema: project.schema,
      connection_info: '{}',
    })
    .returning('*');
  try {
    await assert.rejects(
      prepareNativeFixture(configurationFile, 'prepare'),
      denied,
    );
  } finally {
    await db('project').where({ id: other.id }).delete();
  }
  assert.equal(requests, 0);
});

test('operator origin cannot replace the existing native CSRF origin', async () => {
  await writeJson('preparation.json', {
    ...preparation,
    publicOrigin: 'http://different.invalid',
  });
  try {
    await assert.rejects(
      prepareNativeFixture(configurationFile, 'prepare'),
      denied,
    );
  } finally {
    await writeJson('preparation.json', preparation);
  }
  assert.equal(requests, 0);
});

test('observe without a durable native intent neither dispatches nor publishes a fixture', async () => {
  await assert.rejects(
    prepareNativeFixture(configurationFile, 'observe'),
    denied,
  );
  assert.equal(requests, 0);
  assert.equal(
    Number((await db('deploy_log').count('* as count').first()).count),
    0,
  );
  await assert.rejects(access(config.nativeFixtureFile));
});

test('preparation serves only fresh isolated HUMAN scope, never query admission or a success fixture', async () => {
  const { generateKeyPair, exportJWK, SignJWT } = require('jose');
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: randomUUID() };
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const nativeIdentity = {
    issuer: origin,
    audience: randomUUID(),
    accessClaim: 'isolated_instance',
    accessValue: randomUUID(),
    jwksUrl: `${origin}/jwks`,
  };
  const tokenSeconds = 60;
  const token = await new SignJWT({
    [nativeIdentity.accessClaim]: nativeIdentity.accessValue,
  })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .setIssuer(origin)
    .setSubject(randomUUID())
    .setAudience(nativeIdentity.audience)
    .setIssuedAt()
    .setExpirationTime(`${tokenSeconds}s`)
    .sign(privateKey);
  const jwksFile = await writeJson('preparation-jwks.json', { keys: [jwk] });
  const secret = randomUUID();
  const secretFile = join(directory, 'preparation-service-secret');
  await writeFile(secretFile, secret, { mode: 0o600 });
  const isolated = {
    ...config,
    listenHost: '127.0.0.1',
    listenPort: port,
    productionActionAudience: randomUUID(),
    preparationGeneration: 1,
  };
  const frozen = JSON.stringify(isolated);
  const frozenFile = await writeJson('preparation-scope-config.json', isolated);
  const query = {
    ...JSON.parse(await readFile(config.queryFile, 'utf8')),
    serviceTokenUrl: `${origin}/token`,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`,
    serviceClientId: randomUUID(),
    serviceClientSecretFile: secretFile,
  };
  const binding = JSON.parse(
    await readFile(config.bindingFile, 'utf8'),
  ).binding;
  const close = await openPreparationScope({
    config: isolated,
    query,
    binding,
    token,
    nativeIdentity,
    identity: { audience: randomUUID(), tokenSeconds, jwksFile },
    unchanged: async () => {
      if ((await readFile(frozenFile, 'utf8')) !== frozen)
        throw new Refused(503);
    },
    nativeFacts: async () => {
      assert.equal(
        (await db('project').where({ id: project.id }).first()).type,
        'POSTGRES',
      );
      assert.equal(
        Number(
          (
            await db('model')
              .where({ project_id: project.id })
              .count('* as count')
              .first()
          ).count,
        ),
        1,
      );
    },
  });
  try {
    const keys = await originalFetch(nativeIdentity.jwksUrl);
    assert.equal(keys.status, 200);
    assert.deepEqual(await keys.json(), { keys: [jwk] });
    const grant = await originalFetch(query.serviceTokenUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${query.serviceClientId}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    assert.equal(grant.status, 200);
    const bearer = (await grant.json()).access_token;
    const scope = async (
      human,
      body,
      path = '/service/v1/adapter/human-action',
    ) =>
      originalFetch(origin + path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'x-kailo-native-human-token': human,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const command = {
      bindingId: query.bindingId,
      authorizeScope: { permission: 'manage' },
    };
    const allowed = await scope(token, command);
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).scope, {
      bindingId: query.bindingId,
      generation: 1,
      tenantId: query.tenantId,
      workspaceId: query.workspaceId,
      nativeInstanceRef: query.nativeInstanceRef,
      nativeScopeRef: query.nativeScopeRef,
      permission: 'manage',
      checkedRevision: `conformance:${digest({ binding, jwks: { keys: [jwk] } })}`,
    });
    const wrongHuman = await scope(randomUUID(), command);
    assert.equal(wrongHuman.status, 401);
    await wrongHuman.body.cancel();
    const action = await scope(token, {
      bindingId: query.bindingId,
      command: { actionKey: 'data_query.query@v2' },
    });
    assert.equal(action.status, 403);
    await action.body.cancel();
    const sql = await scope(token, command, '/service/v1/adapter/pep_check');
    assert.equal(sql.status, 404);
    await sql.body.cancel();
    await writeFile(
      frozenFile,
      JSON.stringify({ ...isolated, preparationGeneration: 2 }),
    );
    const drift = await scope(token, command);
    assert.equal(drift.status, 503);
    await drift.body.cancel();
    await assert.rejects(access(config.nativeFixtureFile));
    assert.equal(
      Number((await db('deploy_log').count('* as count').first()).count),
      0,
    );
  } finally {
    await close();
  }
});

// DD-76 / 07 §8A only. This process is an isolated environment provider,
// not a suite runner, Catalog writer, production PEP or native query engine.
import { constants } from 'node:fs';
import { open, realpath, stat, link, unlink } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Refused,
  canonical,
  exactKeys,
  nonempty,
  boundedBody,
  verifiedClaims,
} from '../../../client-kit/adapter/protocol.mjs';

const require = createRequire(
  new URL('../../wren-ui/package.json', import.meta.url),
);
const digest = (value) =>
  createHash('sha256').update(canonical(value)).digest('hex');
const parsed = (value) =>
  typeof value === 'string' ? JSON.parse(value) : value;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const refuse = () => {
  throw new Refused(503);
};

export function verifyNativeModelSource(model, manifestModel) {
  const properties = parsed(model.properties) ?? {};
  // MDLBuilder.buildTableReference uses native model properties; its Rust
  // post-processing removes the null refSql emitted for a physical table.
  if (properties.table) {
    if (
      manifestModel.refSql != null ||
      canonical(manifestModel.tableReference ?? null) !==
        canonical({
          catalog: properties.catalog || null,
          schema: properties.schema || null,
          table: properties.table,
        })
    )
      refuse();
  } else if (
    manifestModel.tableReference != null ||
    !nonempty(model.ref_sql) ||
    model.ref_sql !== manifestModel.refSql
  )
    refuse();
}

async function file(path, json = true) {
  if (!path?.startsWith('/') || (await realpath(path)) !== path) refuse();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.geteuid()
    )
      refuse();
    const text = await handle.readFile('utf8');
    if (json) return JSON.parse(text);
    if (!nonempty(text) || /[\x00-\x1f\x7f]/.test(text)) refuse();
    return text;
  } finally {
    await handle.close();
  }
}

const equalSecret = (left, right) => {
  const a = Buffer.from(left ?? ''),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

// The isolated preparation hop has no Action/SQL admission. It only answers
// the existing native HUMAN scope read while original DeployService creates
// or observes its native intent. No successful fixture is required here.
export async function openPreparationScope({
  config,
  query,
  binding,
  identity,
  token,
  nativeIdentity,
  unchanged,
  nativeFacts,
}) {
  const { jwtVerify, createLocalJWKSet } = require('jose');
  const tokenUrl = new URL(query.serviceTokenUrl);
  const pepUrl = new URL(query.corePepUrl);
  const jwksUrl = new URL(nativeIdentity.jwksUrl);
  if (
    config.mode !== 'CONFORMANCE_ONLY' ||
    !isIP(config.listenHost) ||
    !Number.isSafeInteger(config.listenPort) ||
    config.listenPort <= 0 ||
    tokenUrl.origin !== pepUrl.origin ||
    nativeIdentity.issuer !== tokenUrl.origin ||
    jwksUrl.origin !== tokenUrl.origin ||
    Number(tokenUrl.port) !== config.listenPort ||
    !nonempty(nativeIdentity.audience) ||
    nativeIdentity.audience === identity.audience ||
    nativeIdentity.audience === config.productionActionAudience ||
    identity.audience === config.productionActionAudience ||
    !Number.isSafeInteger(identity.tokenSeconds) ||
    identity.tokenSeconds <= 0 ||
    !nonempty(config.productionActionAudience) ||
    !Number.isSafeInteger(config.preparationGeneration) ||
    config.preparationGeneration <= 0 ||
    !nonempty(query.serviceClientId) ||
    [tokenUrl, pepUrl, jwksUrl].some(
      (url) =>
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash,
    )
  )
    refuse();
  const jwks = await file(identity.jwksFile);
  if (
    !Array.isArray(jwks.keys) ||
    !jwks.keys.length ||
    jwks.keys.some(
      (key) =>
        key.kty !== 'EC' ||
        key.crv !== 'P-256' ||
        !nonempty(key.kid) ||
        key.d !== undefined,
    )
  )
    refuse();
  const clientSecret = await file(query.serviceClientSecretFile, false);
  const frozenJwks = canonical(jwks);
  const verify = async () => {
    await unchanged();
    if (
      canonical(await file(identity.jwksFile)) !== frozenJwks ||
      !equalSecret(
        await file(query.serviceClientSecretFile, false),
        clientSecret,
      )
    )
      refuse();
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: nativeIdentity.issuer,
      audience: nativeIdentity.audience,
      algorithms: ['ES256'],
      requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp'],
    });
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (
      !nonempty(payload.sub) ||
      audiences.length !== 1 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.iat > now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > identity.tokenSeconds ||
      payload[nativeIdentity.accessClaim] !== nativeIdentity.accessValue
    )
      refuse();
    await nativeFacts();
  };
  await verify();
  const serviceToken = randomBytes(32).toString('base64url');
  let serviceTokenUntil = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    try {
      await verify();
      if (request.method === 'GET' && request.url === jwksUrl.pathname) {
        response.end(JSON.stringify(jwks));
        return;
      }
      if (
        request.method !== 'POST' ||
        request.headers.origin ||
        request.headers.cookie
      )
        throw new Refused(403);
      const text = await boundedBody(request, query.requestMaxBytes);
      if (request.url === tokenUrl.pathname) {
        const basic = Buffer.from(
          `${encodeURIComponent(query.serviceClientId)}:${encodeURIComponent(clientSecret)}`,
        ).toString('base64');
        if (
          !equalSecret(request.headers.authorization, `Basic ${basic}`) ||
          text !== 'grant_type=client_credentials'
        )
          throw new Refused(401);
        serviceTokenUntil = Date.now() + identity.tokenSeconds * 1000;
        response.end(
          JSON.stringify({
            token_type: 'Bearer',
            access_token: serviceToken,
            expires_in: identity.tokenSeconds,
          }),
        );
        return;
      }
      if (request.url !== '/service/v1/adapter/human-action')
        throw new Refused(404);
      if (
        !equalSecret(request.headers.authorization, `Bearer ${serviceToken}`) ||
        Date.now() >= serviceTokenUntil ||
        !equalSecret(request.headers['x-kailo-native-human-token'], token)
      )
        throw new Refused(401);
      const body = JSON.parse(text);
      if (
        !exactKeys(body, ['bindingId', 'authorizeScope']) ||
        body.bindingId !== query.bindingId ||
        !exactKeys(body.authorizeScope, ['permission']) ||
        !['discover', 'manage'].includes(body.authorizeScope.permission)
      )
        throw new Refused(403);
      await verify();
      response.end(
        JSON.stringify({
          scope: {
            bindingId: query.bindingId,
            generation: config.preparationGeneration,
            tenantId: query.tenantId,
            workspaceId: query.workspaceId,
            nativeInstanceRef: query.nativeInstanceRef,
            nativeScopeRef: query.nativeScopeRef,
            permission: body.authorizeScope.permission,
            checkedRevision: `conformance:${digest({ binding, jwks })}`,
          },
        }),
      );
    } catch (error) {
      response
        .writeHead(error instanceof Refused ? error.status : 503)
        .end('{}');
    }
  });
  server.requestTimeout = query.requestTimeoutMs;
  server.headersTimeout = query.requestTimeoutMs;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listenPort, config.listenHost, resolve);
  });
  return async () => {
    server.closeIdleConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}

// One explicit native operation, not a polling/suite runner. The original
// GraphQL resolver owns its identity checks, MDL generation, durable deploy
// intent and AI execution. This command never writes a native database row.
export async function prepareNativeFixture(path, operation) {
  if (!['prepare', 'observe'].includes(operation)) refuse();
  // Consume the same delivered verifier configuration as native middleware;
  // an operator URL alone cannot authorize a different CSRF origin.
  const identitySource = process.env.WREN_NATIVE_IDENTITY_JSON;
  if (!nonempty(identitySource)) refuse();
  const nativeIdentity = JSON.parse(identitySource);
  const config = await file(path);
  if (config.mode !== 'CONFORMANCE_ONLY' || !config.preparationFile) refuse();
  const paths = [
    path,
    config.preparationFile,
    config.queryFile,
    config.bindingFile,
    config.environmentFile,
  ];
  const documents = await Promise.all(paths.map((name) => file(name)));
  const [original, preparation, query, delivery, environment] = documents;
  if (
    canonical(config) !== canonical(original) ||
    !exactKeys(preparation, [
      'graphqlUrl',
      'publicOrigin',
      'humanTokenFile',
      'projectId',
      'modelId',
      'manifest',
    ]) ||
    !Number.isSafeInteger(preparation.projectId) ||
    preparation.projectId <= 0 ||
    !Number.isSafeInteger(preparation.modelId) ||
    preparation.modelId <= 0 ||
    preparation.projectId !== query.projectId ||
    query.nativeScopeRef !== String(query.projectId) ||
    !Number.isSafeInteger(query.requestTimeoutMs) ||
    query.requestTimeoutMs <= 0 ||
    !Number.isSafeInteger(query.requestMaxBytes) ||
    query.requestMaxBytes <= 0 ||
    !Number.isSafeInteger(environment.maxResponseBytes) ||
    environment.maxResponseBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(environment.artifactDigest) ||
    delivery.artifactDigest !== environment.artifactDigest ||
    delivery.binding?.isolationMode !== 'DEDICATED_INSTANCE' ||
    [
      'bindingId',
      'tenantId',
      'workspaceId',
      'nativeInstanceRef',
      'nativeScopeRef',
    ].some((key) => query[key] !== delivery.binding[key])
  )
    refuse();
  const endpoint = new URL(preparation.graphqlUrl);
  const origin = new URL(preparation.publicOrigin);
  const adapter = new URL(environment.adapterBaseUrl);
  if (
    endpoint.origin !== adapter.origin ||
    origin.href !== `${origin.origin}/` ||
    preparation.publicOrigin !== nativeIdentity.publicOrigin ||
    endpoint.pathname !== '/api/graphql' ||
    [endpoint, origin, adapter].some(
      (url) =>
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash,
    )
  )
    refuse();
  const token = await file(preparation.humanTokenFile, false);
  const databaseUrl = await file(config.databaseUrlFile, false);
  const frozen = digest(documents);
  const unchanged = async () => {
    if (
      process.env.WREN_NATIVE_IDENTITY_JSON !== identitySource ||
      digest(await Promise.all(paths.map((name) => file(name)))) !== frozen ||
      !equalSecret(await file(preparation.humanTokenFile, false), token) ||
      !equalSecret(await file(config.databaseUrlFile, false), databaseUrl)
    )
      refuse();
  };
  const output = config.nativeFixtureFile;
  if (
    !output?.startsWith('/') ||
    paths.includes(output) ||
    [preparation.humanTokenFile, config.databaseUrlFile].includes(output)
  )
    refuse();
  const directory = dirname(output);
  const info = await stat(directory);
  if (
    (await realpath(directory)) !== directory ||
    !info.isDirectory() ||
    info.uid !== process.geteuid() ||
    (info.mode & 0o077) !== 0
  )
    refuse();
  const database = require('knex')({
    client: 'pg',
    connection: {
      connectionString: databaseUrl,
      connectionTimeoutMillis: query.requestTimeoutMs,
      statement_timeout: query.requestTimeoutMs,
      query_timeout: query.requestTimeoutMs,
    },
  });
  const expectedHash = createHash('sha1')
    .update(`${preparation.projectId} ${JSON.stringify(preparation.manifest)}`)
    .digest('hex');
  const readNative = async () =>
    database.transaction(async (tx) => {
      await tx.raw(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
      );
      // The original unbound repository selects the first project ordered by
      // id; the bound repository selects the delivered projectId. This dedicated
      // fixture permits exactly one project so neither path can select another.
      const projects = await tx('project').orderBy('id');
      if (projects.length !== 1 || projects[0].id !== preparation.projectId)
        refuse();
      const project = projects[0];
      const models = await tx('model')
        .where({ project_id: preparation.projectId })
        .orderBy('id');
      const manifest = preparation.manifest;
      if (
        !project ||
        project.type !== 'POSTGRES' ||
        digest({
          type: project.type,
          connectionInfo: parsed(project.connection_info),
          catalog: project.catalog,
          schema: project.schema,
        }) !== query.projectConnectionDigest ||
        manifest.catalog !== project.catalog ||
        manifest.schema !== project.schema ||
        manifest.models?.length !== 1 ||
        models.length !== 1 ||
        models[0].id !== preparation.modelId ||
        models[0].reference_name !== manifest.models[0].name
      )
        refuse();
      verifyNativeModelSource(models[0], manifest.models[0]);
      const columns = await tx('model_column')
        .where({ model_id: preparation.modelId })
        .orderBy('id');
      if (
        canonical(
          columns.map((column) => ({
            name: column.reference_name,
            type: column.type,
          })),
        ) !==
        canonical(
          manifest.models[0].columns.map(({ name, type }) => ({ name, type })),
        )
      )
        refuse();
      const deployment = await tx('deploy_log')
        .where({ project_id: preparation.projectId })
        .orderBy('id', 'desc')
        .first();
      return deployment;
    });
  const graphql = async (document) => {
    const body = JSON.stringify({ query: document });
    if (Buffer.byteLength(body) > query.requestMaxBytes) refuse();
    await unchanged();
    await readNative();
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        origin: preparation.publicOrigin,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(query.requestTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      refuse();
    }
    const result = JSON.parse(
      await boundedBody(response.body, environment.maxResponseBytes),
    );
    if (result.errors?.length || !result.data) refuse();
    return result.data;
  };
  let closePreparationScope;
  try {
    await unchanged();
    const prior = await readNative();
    if (
      prior &&
      (prior.hash !== expectedHash ||
        canonical(parsed(prior.manifest)) !== canonical(preparation.manifest))
    )
      refuse();
    if (operation === 'observe' && !prior) refuse();
    const identity = await file(config.identityFile);
    const identityDigest = digest(identity);
    closePreparationScope = await openPreparationScope({
      config,
      query,
      binding: delivery.binding,
      identity,
      token,
      nativeIdentity,
      nativeFacts: readNative,
      unchanged: async () => {
        await unchanged();
        if (digest(await file(config.identityFile)) !== identityDigest)
          refuse();
      },
    });
    // A retry with an existing intent observes it. In particular, an HTTP ACK
    // loss never turns into a new forced deployment or a fabricated failure.
    if (operation === 'prepare' && !prior) {
      const result = await graphql('mutation { deploy(force: false) }');
      if (!['IN_PROGRESS', 'SUCCESS', 'FAILED'].includes(result.deploy?.status))
        refuse();
    } else {
      if (!prior) refuse();
      const result = await graphql('query { modelSync { status } }');
      if (
        !['IN_PROGRESS', 'SYNCRONIZED', 'UNSYNCRONIZED'].includes(
          result.modelSync?.status,
        )
      )
        refuse();
    }
    const deployment = await readNative();
    await unchanged();
    if (
      !deployment ||
      deployment.hash !== expectedHash ||
      canonical(parsed(deployment.manifest)) !==
        canonical(preparation.manifest) ||
      canonical(parsed(deployment.native_object_refs)) !==
        canonical([
          {
            nativeType: 'model',
            nativeId: preparation.modelId,
            nativeName: preparation.manifest.models[0].name,
          },
        ])
    )
      refuse();
    if (deployment.status === 'IN_PROGRESS') return { status: 'IN_PROGRESS' };
    if (deployment.status === 'FAILED') return { status: 'FAILED' };
    if (deployment.status !== 'SUCCESS') refuse();
    const fixture = {
      projectId: preparation.projectId,
      deploymentId: deployment.id,
      modelId: preparation.modelId,
      manifest: preparation.manifest,
    };
    // Create-only publication: a stale process must not overwrite another
    // deployment's fixture. Same-byte retries are idempotent. Nothing removes
    // an old operator-owned file; a new fixture uses a new controlled path.
    const temporary = join(
      directory,
      `.${basename(output)}.${randomBytes(16).toString('hex')}`,
    );
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(fixture));
      await handle.sync();
      await unchanged();
      try {
        await link(temporary, output);
      } catch (error) {
        if (
          error.code !== 'EEXIST' ||
          canonical(await file(output)) !== canonical(fixture)
        )
          throw error;
      }
    } finally {
      await handle.close();
      await unlink(temporary);
    }
    return { status: 'SUCCESS', deploymentId: deployment.id };
  } finally {
    try {
      if (closePreparationScope) await closePreparationScope();
    } finally {
      await database.destroy();
    }
  }
}

// All values are delivered. Neither an upstream artifact tag nor a caller's
// resource ID determines the candidate, native database or isolated identity.
export async function openProvider(path) {
  const config = await file(path);
  const configKeys = [
    'mode',
    'listenHost',
    'listenPort',
    'productionActionAudience',
    'environmentFile',
    'identityFile',
    'queryFile',
    'bindingFile',
    'registrationFile',
    'databaseUrlFile',
    'nativeFixtureFile',
    'preparationGeneration',
  ];
  if (config.preparationFile !== undefined) configKeys.push('preparationFile');
  if (
    !exactKeys(config, configKeys) ||
    config.mode !== 'CONFORMANCE_ONLY' ||
    !isIP(config.listenHost) ||
    !Number.isSafeInteger(config.listenPort) ||
    config.listenPort <= 0 ||
    !Number.isSafeInteger(config.preparationGeneration) ||
    config.preparationGeneration <= 0 ||
    !nonempty(config.productionActionAudience)
  )
    refuse();
  const paths = [
    path,
    config.environmentFile,
    config.identityFile,
    config.queryFile,
    config.bindingFile,
    config.registrationFile,
    config.nativeFixtureFile,
  ];
  const documents = await Promise.all(paths.map((name) => file(name)));
  const [
    original,
    environment,
    identity,
    query,
    binding,
    registration,
    fixture,
  ] = documents;
  if (
    canonical(original) !== canonical(config) ||
    !/^[a-f0-9]{64}$/.test(environment.artifactDigest) ||
    environment.artifactDigest !== identity.artifactDigest ||
    environment.artifactDigest !== binding.artifactDigest ||
    identity.audience === config.productionActionAudience ||
    query.actionTokenIssuer !== identity.issuer ||
    query.actionTokenAudience !== identity.audience ||
    query.actionTokenJwksFile !== identity.jwksFile ||
    !Number.isSafeInteger(identity.tokenSeconds) ||
    identity.tokenSeconds <= 0 ||
    !Array.isArray(identity.contexts) ||
    !identity.contexts.length ||
    !['bindingId', 'tenantId', 'workspaceId'].every((key) =>
      uuid.test(query[key]),
    ) ||
    !Number.isSafeInteger(query.projectId) ||
    query.projectId <= 0 ||
    query.nativeScopeRef !== String(query.projectId) ||
    !nonempty(query.nativeInstanceRef) ||
    !/^[a-f0-9]{64}$/.test(query.projectConnectionDigest) ||
    !['requestTimeoutMs', 'requestMaxBytes'].every(
      (key) => Number.isSafeInteger(query[key]) && query[key] > 0,
    ) ||
    !nonempty(query.serviceClientId)
  )
    refuse();
  const bindingValue = binding.binding;
  if (
    !bindingValue ||
    [
      'bindingId',
      'tenantId',
      'workspaceId',
      'nativeInstanceRef',
      'nativeScopeRef',
    ].some((key) => bindingValue[key] !== query[key])
  )
    refuse();
  const jwks = await file(identity.jwksFile);
  if (
    !Array.isArray(jwks.keys) ||
    !jwks.keys.length ||
    jwks.keys.some(
      (key) =>
        key.kty !== 'EC' ||
        key.crv !== 'P-256' ||
        !nonempty(key.kid) ||
        key.d !== undefined,
    )
  )
    refuse();
  paths.push(identity.jwksFile);
  documents.push(jwks);
  const baseUrl = new URL(query.serviceTokenUrl);
  const pepUrl = new URL(query.corePepUrl);
  if (
    baseUrl.origin !== pepUrl.origin ||
    pepUrl.pathname !== '/service/v1/adapter/pep_check' ||
    baseUrl.pathname === pepUrl.pathname ||
    [baseUrl, pepUrl].some(
      (url) =>
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash,
    )
  )
    refuse();
  const vectors = JSON.parse(registration.testVectorsJson);
  if (
    registration.categoryKey !== 'data_query' ||
    registration.contractVersion !== 1 ||
    vectors.formatVersion !== 'V1' ||
    !Array.isArray(vectors.cases)
  )
    refuse();
  const cases = vectors.cases.filter((value) =>
    value.steps.some((step) => step.contractKey === 'data_query.describe@v1'),
  );
  if (cases.length !== 1) refuse();
  const selected = cases[0];
  const steps = selected.steps;
  if (
    steps.length !== 3 ||
    steps.map((step) => step.contractKey).join(',') !==
      'data_query.describe@v1,data_query.dry_run@v1,data_query.query@v1'
  )
    refuse();
  const resourceId = steps[0].referenceResourceId;
  const described = JSON.parse(steps[0].expectedOutputJson);
  if (
    !uuid.test(resourceId) ||
    !Number.isSafeInteger(described.deploymentId) ||
    described.deploymentId <= 0 ||
    !/^[a-f0-9]{40}$/.test(described.deploymentHash) ||
    described.models?.length !== 1 ||
    steps
      .slice(1)
      .some(
        (step) =>
          step.referenceFromStepKey !== steps[0].stepKey ||
          step.referenceResourceId !== resourceId,
      )
  )
    refuse();
  if (
    !exactKeys(fixture, ['projectId', 'deploymentId', 'modelId', 'manifest']) ||
    fixture.projectId !== query.projectId ||
    fixture.deploymentId !== described.deploymentId ||
    !Number.isSafeInteger(fixture.modelId) ||
    fixture.modelId <= 0 ||
    steps.some((step) => {
      const output = JSON.parse(step.expectedOutputJson);
      return (
        output.deploymentId !== fixture.deploymentId ||
        output.deploymentHash !== described.deploymentHash
      );
    })
  )
    refuse();
  // Core signs only an independently delivered context. The provider consumes
  // that same context; it never treats any valid signature as unrestricted read.
  const contexts = identity.contexts;
  const caseKey = `${registration.categoryKey}:${registration.contractVersion}:${selected.caseKey}`;
  const capabilityContexts = contexts.filter(
    (context) => context.caseKey === caseKey,
  );
  for (const step of steps) {
    const allowed = capabilityContexts.filter(
      (context) =>
        context.operation === 'execute' && context.stepKey === step.stepKey,
    );
    const denied = capabilityContexts.filter(
      (context) =>
        context.operation === 'execute' &&
        context.stepKey === `permission-denied:${step.stepKey}`,
    );
    if (
      allowed.length !== 1 ||
      denied.length !== 1 ||
      allowed[0].actorPrincipalId === denied[0].actorPrincipalId ||
      [...allowed, ...denied].some(
        (context) => context.actionKey !== step.contractKey,
      )
    )
      refuse();
  }
  const contextKeys = new Set();
  for (const context of contexts) {
    const contextKey = canonical([
      context.caseKey,
      context.stepKey,
      context.operation,
    ]);
    if (
      !nonempty(context.caseKey) ||
      !nonempty(context.stepKey) ||
      contextKeys.has(contextKey)
    )
      refuse();
    contextKeys.add(contextKey);
    const management = ['handshake', 'validate_binding'].includes(
      context.operation,
    );
    if (management) {
      if (
        context.actionKey !== 'application_binding.create' ||
        context.targetType !== 'APPLICATION_BINDING' ||
        context.targetId !== query.bindingId ||
        [
          'externalExecutionId',
          'resultExposurePolicyId',
          'resultExposurePolicyVersion',
        ].some((key) => Object.hasOwn(context, key))
      )
        refuse();
    } else {
      if (
        ![
          'execute',
          'observe',
          'reconcile',
          'map_native_status_error',
        ].includes(context.operation) ||
        !steps.some((step) => step.contractKey === context.actionKey) ||
        context.targetType !== 'RESOURCE' ||
        context.targetId !== resourceId ||
        !uuid.test(context.resultExposurePolicyId) ||
        !Number.isSafeInteger(context.resultExposurePolicyVersion) ||
        context.resultExposurePolicyVersion <= 0 ||
        (context.operation === 'execute' &&
          !uuid.test(context.externalExecutionId))
      )
        refuse();
    }
    if (
      context.tenantId !== query.tenantId ||
      context.workspaceId !== query.workspaceId ||
      !uuid.test(context.actorPrincipalId) ||
      !nonempty(context.authorizationMinZedToken) ||
      !Number.isSafeInteger(context.actionDefinitionVersion) ||
      context.actionDefinitionVersion <= 0
    )
      refuse();
  }
  const clientSecret = await file(query.serviceClientSecretFile, false);
  const databaseUrl = await file(config.databaseUrlFile, false);
  const database = require('knex')({
    client: 'pg',
    connection: {
      connectionString: databaseUrl,
      connectionTimeoutMillis: query.requestTimeoutMs,
      statement_timeout: query.requestTimeoutMs,
      query_timeout: query.requestTimeoutMs,
    },
  });
  const configurationDigest = digest(documents);
  const unchanged = async () => {
    if (
      digest(await Promise.all(paths.map((name) => file(name)))) !==
        configurationDigest ||
      !equalSecret(
        await file(query.serviceClientSecretFile, false),
        clientSecret,
      ) ||
      !equalSecret(await file(config.databaseUrlFile, false), databaseUrl)
    )
      refuse();
  };
  const nativeFixture = async () =>
    database.transaction(async (tx) => {
      await tx.raw(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
      );
      const project = await tx('project')
        .where({ id: query.projectId })
        .first();
      const deployment = await tx('deploy_log')
        .where({ id: described.deploymentId, project_id: query.projectId })
        .first();
      if (
        !project ||
        project.type !== 'POSTGRES' ||
        !deployment ||
        deployment.status !== 'SUCCESS' ||
        deployment.hash !== described.deploymentHash
      )
        refuse();
      const manifest = parsed(deployment.manifest);
      // Same exact byte algorithm as original DeployService.createMDLHash.
      // This checks consistency, not provenance: the isolated database must be
      // populated by the original deployment consumer, never by this provider.
      // PostgreSQL JSONB may reorder keys. Hash the retained original deployment
      // input, and separately compare its structure to the stored manifest.
      if (
        createHash('sha1')
          .update(`${project.id} ${JSON.stringify(fixture.manifest)}`)
          .digest('hex') !== deployment.hash ||
        canonical(fixture.manifest) !== canonical(manifest) ||
        digest({
          type: project.type,
          connectionInfo: parsed(project.connection_info),
          catalog: project.catalog,
          schema: project.schema,
        }) !== query.projectConnectionDigest ||
        manifest.catalog !== project.catalog ||
        manifest.schema !== project.schema ||
        manifest.models?.length !== 1
      )
        refuse();
      const expected = described.models[0];
      const model = await tx('model')
        .where({
          id: fixture.modelId,
          project_id: project.id,
          reference_name: expected.name,
        })
        .first();
      const capture = parsed(deployment.native_object_refs);
      const metadata = manifest.models[0];
      if (
        !model ||
        capture?.length !== 1 ||
        capture[0].nativeType !== 'model' ||
        capture[0].nativeId !== model.id ||
        capture[0].nativeName !== model.reference_name ||
        metadata.name !== model.reference_name ||
        canonical(
          metadata.columns.map(({ name, type }) => ({ name, type })),
        ) !== canonical(expected.columns)
      )
        refuse();
      verifyNativeModelSource(model, metadata);
      const columns = await tx('model_column')
        .where({ model_id: model.id })
        .orderBy('id');
      if (
        canonical(
          columns.map((column) => ({
            name: column.reference_name,
            type: column.type,
          })),
        ) !== canonical(expected.columns)
      )
        refuse();
      return {
        resourceId,
        nativeType: 'model',
        nativeRef: String(model.id),
        nativeInstanceRef: query.nativeInstanceRef,
        nativeScopeRef: query.nativeScopeRef,
      };
    });
  let server;
  try {
    await unchanged();
    await nativeFixture();
    await unchanged();
    const serviceToken = randomBytes(32).toString('base64url');
    let serviceTokenUntil = 0;
    server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      try {
        if (
          request.method !== 'POST' ||
          request.headers.origin ||
          request.headers.cookie
        )
          throw new Refused(403);
        await unchanged();
        const text = await boundedBody(request, query.requestMaxBytes);
        if (request.url === baseUrl.pathname) {
          const expected = `Basic ${Buffer.from(`${query.serviceClientId}:${clientSecret}`).toString('base64')}`;
          if (
            !equalSecret(request.headers.authorization, expected) ||
            text !== 'grant_type=client_credentials'
          )
            throw new Refused(401);
          serviceTokenUntil = Date.now() + identity.tokenSeconds * 1000;
          response.end(
            JSON.stringify({
              token_type: 'Bearer',
              access_token: serviceToken,
              expires_in: identity.tokenSeconds,
            }),
          );
          return;
        }
        if (request.url !== pepUrl.pathname) throw new Refused(404);
        if (
          !equalSecret(
            request.headers.authorization,
            `Bearer ${serviceToken}`,
          ) ||
          Date.now() >= serviceTokenUntil
        )
          throw new Refused(401);
        const body = JSON.parse(text);
        const keys = ['bindingId', 'operation', 'actionToken', 'argumentsJson'];
        if (body.sourceResources !== undefined) keys.push('sourceResources');
        if (
          !exactKeys(body, keys) ||
          body.bindingId !== query.bindingId ||
          ![
            'execute',
            'observe',
            'reconcile',
            'handshake',
            'validate_binding',
            'map_native_status_error',
          ].includes(body.operation)
        )
          throw new Refused(403);
        const claims = await verifiedClaims(body.actionToken, query);
        if (
          claims.exp - claims.iat > identity.tokenSeconds ||
          !['jti', 'action_execution_id', 'operation_id'].every((key) =>
            uuid.test(claims[key]),
          ) ||
          ['agent_principal_id', 'delegation_id', 'delegation_version'].some(
            (key) => Object.hasOwn(claims, key),
          )
        )
          throw new Refused(403);
        const matching = contexts.filter(
          (context) =>
            context.operation === body.operation &&
            context.actionKey === claims.action_key &&
            context.actorPrincipalId === claims.actor_principal_id &&
            context.tenantId === claims.tenant_id &&
            context.workspaceId === claims.workspace_id &&
            context.targetType === claims.target_type &&
            context.targetId === claims.target_id &&
            (body.operation !== 'execute' ||
              context.externalExecutionId === claims.external_execution_id) &&
            context.actionDefinitionVersion ===
              claims.action_definition_version &&
            context.resultExposurePolicyId ===
              claims.result_exposure_policy_id &&
            context.resultExposurePolicyVersion ===
              claims.result_exposure_policy_version &&
            context.authorizationMinZedToken ===
              claims.authorization_min_zed_token,
        );
        if (
          matching.length === 0 ||
          claims.initiating_human_principal_id !== claims.actor_principal_id
        )
          throw new Refused(403);
        const args = JSON.parse(body.argumentsJson);
        if (
          (body.operation === 'execute' &&
            (!exactKeys(args, ['target', 'input']) ||
              !exactKeys(args.target, ['resourceId']) ||
              args.target.resourceId !== resourceId)) ||
          digest(
            body.operation === 'execute'
              ? args
              : { operation: body.operation, arguments: args },
          ) !== claims.normalized_parameter_hash
        )
          throw new Refused(403);
        const target = await nativeFixture();
        if (
          body.sourceResources !== undefined &&
          (!Array.isArray(body.sourceResources) ||
            !body.sourceResources.length ||
            body.sourceResources.some(
              (source) =>
                !exactKeys(source, ['nativeType', 'nativeRef']) ||
                source.nativeType !== target.nativeType ||
                source.nativeRef !== target.nativeRef,
            ))
        )
          throw new Refused(403);
        await unchanged();
        if (
          matching.some((context) =>
            context.stepKey.startsWith('permission-denied:'),
          )
        ) {
          response
            .writeHead(403)
            .end(
              JSON.stringify({ class: 'DENIED', reason: 'PERMISSION_DENIED' }),
            );
          return;
        }
        response.end(
          JSON.stringify({
            actionExecutionId: claims.action_execution_id,
            operationId: claims.operation_id,
            authorizationMinZedToken: matching[0].authorizationMinZedToken,
            ...(body.operation === 'execute'
              ? {
                  bindingGeneration: config.preparationGeneration,
                  targetResource: target,
                }
              : {}),
          }),
        );
      } catch (error) {
        response
          .writeHead(error instanceof Refused ? error.status : 503)
          .end('{}');
      }
    });
    server.requestTimeout = query.requestTimeoutMs;
    server.headersTimeout = query.requestTimeoutMs;
    return {
      server,
      config,
      close: async () => {
        if (server.listening) {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
        await database.destroy();
      },
    };
  } catch (error) {
    await database.destroy();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const operation = process.argv[2];
  if (operation !== undefined) {
    prepareNativeFixture(process.env.WREN_CONFORMANCE_CONFIG_FILE, operation)
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
      })
      .catch(() => {
        process.stderr.write(
          'WREN_CONFORMANCE_FIXTURE_UNAVAILABLE_OR_UNKNOWN\n',
        );
        process.exitCode = 1;
      });
  } else
    openProvider(process.env.WREN_CONFORMANCE_CONFIG_FILE)
      .then((provider) => {
        const shutdown = () => {
          void provider.close().finally(() => {
            process.exitCode = 0;
          });
        };
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
        provider.server.once('error', () => {
          void provider.close().finally(() => {
            process.exitCode = 1;
          });
        });
        provider.server.listen(
          provider.config.listenPort,
          provider.config.listenHost,
        );
      })
      .catch(() => {
        process.stderr.write('WREN_CONFORMANCE_ENVIRONMENT_UNAVAILABLE\n');
        process.exitCode = 1;
      });
}

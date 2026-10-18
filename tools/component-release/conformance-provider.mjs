#!/usr/bin/env node
// Isolated REMOTE_ADAPTER conformance PEP provider (.design/07 §8A, REQ-22,
// DD-76/102). Generalizes data-query/docker/conformance/provider.mjs so any
// adapter that uses client-kit/adapter/protocol.mjs (Cells, WeKnora) can be
// probed by Core's existing ComponentTaskWorkflow(kind=COMPONENT_RELEASE).
//
// Why a simulated PEP and not production Core: Core signs every suite probe
// with the isolated conformance identity whose Tenant, actors and result
// policies must NOT exist in production Core (component_release.rs
// authorize-probe refuses any collision), and production
// application_binding_pep.rs only admits real bindings/ActionExecutions. 07 §8A
// places this in the third-party "本地开发环境 … 应答 Adapter Protocol、模拟 binding"
// surface: it answers only the delivered identity contexts for one isolated
// candidate instance and grants nothing in any platform deployment.
//
// What it deliberately does NOT provide: request_read_grant, read_receipt,
// native task admissions or Protocol Session callbacks. 07 §8A requires the
// receiver/read-edge direction to run "与生产相同的 Core request_read_grant、
// receiver 准入、PEP 与 read_receipt 消费者" in an isolated Core deployment
// (core/verify/receiver-environment-bootstrap.rs); simulating them here would
// be the forbidden "预填的 SOURCE/receiver 执行引用当成真实准入". Those routes 404.
//
// Endpoints on one isolated listener (point the adapter's and native
// service's oidcTokenUrl / corePepUrl here, never into production):
//   POST /oidc/token                     client_credentials for the delivered
//                                        binding client only; opaque bearer
//   POST /service/v1/adapter/pep_check   the AdapterPepCheckRequest variant
//
// Each PEP decision: verify the ActionToken (signature/iss/aud/time) against
// the identity's public JWKS; require exactly one delivered context class for
// (operation, action, actor, tenant, workspace, target, policy, ZedToken,
// external execution); recompute Core's parameter hash; a
// `permission-denied:` context returns Core's closed 403 DENIED body; an
// allowed execute/receiver decision re-reads the native object (fixed kinds:
// Cells node, WeKnora knowledge base) and returns its observed native
// reference. Any change to a delivered file or secret fails closed.
//
// Usage: CONFORMANCE_PROVIDER_CONFIG_FILE=/abs/owner-only.json \
//          node tools/component-release/conformance-provider.mjs
// Config (owner-only regular file, exact keys):
// { "mode":"CONFORMANCE_ONLY", "listenHost":"<ip>", "listenPort":<int>,
//   "productionActionAudience":"kailo-adapter-…",
//   "identityFile":"/abs/identity.json",   ComponentConformanceIdentity (Core's file
//                                          or the observer's ephemeral one, same schema)
//   "bindingFile":"/abs/binding.json",     {bindingId, tenantId, workspaceId?,
//                                          bindingGeneration, nativeInstanceRef,
//                                          nativeScopeRef, serviceClientId,
//                                          serviceClientSecretFile, artifactDigest}
//   "targetsFile":"/abs/targets.json",     {"resources":{"<uuid>":{nativeType,nativeRef}}}
//                                          observed by the native seed, not chosen here
//   "nativeCheck":{"kind":"cells","restBaseUrl":"http://…/a/","bearerFile":"/abs"}
//               | {"kind":"weknora","apiBaseUrl":"http://…/","apiKeyFile":"/abs"},
//   "requestTimeoutMs":<int>, "requestMaxBytes":<int> }
// No secret, token or native body is logged.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Refused, exactKeys, nonempty, object, canonical, boundedBody, verifiedClaims } from '../../client-kit/adapter/protocol.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN_PATH = '/oidc/token';
const PEP_PATH = '/service/v1/adapter/pep_check';
const DENIED = JSON.stringify({ class: 'DENIED', reason: 'PERMISSION_DENIED' });
const MANAGEMENT = new Set(['handshake', 'validate_binding']);
const OPERATIONS = new Set(['handshake', 'validate_binding', 'execute', 'observe', 'cancel', 'reconcile',
  'extract_usage', 'query_revision', 'map_native_status_error', 'receiver_start', 'receiver_observe']);
const NATIVE_TARGET = new Set(['execute', 'receiver_start', 'receiver_observe']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const refuse = (status = 503) => { throw new Refused(status); };

async function ownerOnly(path, json = true) {
  if (typeof path !== 'string' || !isAbsolute(path)) refuse();
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o077) !== 0) refuse();
  const text = await readFile(path, 'utf8');
  return json ? JSON.parse(text) : text.trim();
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function bindingFacts(value) {
  const optional = Object.hasOwn(value ?? {}, 'workspaceId') ? ['workspaceId'] : [];
  if (!exactKeys(value, ['bindingId', 'tenantId', 'bindingGeneration', 'nativeInstanceRef', 'nativeScopeRef',
    'serviceClientId', 'serviceClientSecretFile', 'artifactDigest', ...optional])
    || !UUID.test(value.bindingId) || !UUID.test(value.tenantId)
    || (value.workspaceId !== undefined && !UUID.test(value.workspaceId))
    || !Number.isSafeInteger(value.bindingGeneration) || value.bindingGeneration <= 0
    || !['nativeInstanceRef', 'nativeScopeRef', 'serviceClientId'].every((key) => nonempty(value[key]))
    || !isAbsolute(value.serviceClientSecretFile ?? '') || !HEX64.test(value.artifactDigest)) refuse();
  return value;
}

function targetFacts(value) {
  if (!exactKeys(value, ['resources']) || !object(value.resources)) refuse();
  for (const [id, target] of Object.entries(value.resources)) {
    if (!UUID.test(id) || !exactKeys(target, ['nativeType', 'nativeRef'])
      || !nonempty(target.nativeType) || !nonempty(target.nativeRef)) refuse();
  }
  return value.resources;
}

// Fixed native read probes only; no configurable method, path or body.
function nativeCheckConfig(value) {
  const [urlKey, fileKey] = value?.kind === 'cells' ? ['restBaseUrl', 'bearerFile']
    : value?.kind === 'weknora' ? ['apiBaseUrl', 'apiKeyFile'] : refuse();
  if (!exactKeys(value, ['kind', urlKey, fileKey]) || !isAbsolute(value[fileKey] ?? '')) refuse();
  let url;
  try { url = new URL(value[urlKey]); } catch { refuse(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith('/')) refuse();
  return value;
}

// Same closed rules as component_conformance_identity.rs validate/result_policy_id,
// narrowed to the one delivered binding and observed targets.
function validateContexts(identity, binding, resources, productionAudience) {
  if (!object(identity) || identity.artifactDigest !== binding.artifactDigest
    || !nonempty(identity.issuer) || !nonempty(identity.audience) || identity.audience === productionAudience
    || !Number.isSafeInteger(identity.tokenSeconds) || identity.tokenSeconds <= 0
    || !isAbsolute(identity.jwksFile ?? '') || !Array.isArray(identity.contexts) || !identity.contexts.length) refuse();
  const seen = new Set();
  for (const c of identity.contexts) {
    const key = canonical([c.caseKey, c.stepKey, c.operation]);
    if (seen.has(key) || !nonempty(c.caseKey) || !nonempty(c.stepKey) || !OPERATIONS.has(c.operation)
      || c.tenantId !== binding.tenantId || c.workspaceId !== binding.workspaceId
      || !UUID.test(c.actorPrincipalId) || !nonempty(c.actionKey) || !nonempty(c.authorizationMinZedToken)
      || !Number.isSafeInteger(c.actionDefinitionVersion) || c.actionDefinitionVersion <= 0) refuse();
    seen.add(key);
    if (c.targetType === 'APPLICATION_BINDING') {
      if (!MANAGEMENT.has(c.operation) || c.actionKey !== 'application_binding.create' || c.targetId !== binding.bindingId
        || ['resultExposurePolicyId', 'resultExposurePolicyVersion', 'externalExecutionId'].some((k) => Object.hasOwn(c, k))) refuse();
      continue;
    }
    if (!['RESOURCE', 'ASSET'].includes(c.targetType) || !UUID.test(c.targetId)
      || !UUID.test(c.resultExposurePolicyId) || !Number.isSafeInteger(c.resultExposurePolicyVersion)
      || c.resultExposurePolicyVersion <= 0 || (c.operation === 'execute' && !UUID.test(c.externalExecutionId))
      || (c.targetType === 'RESOURCE' && NATIVE_TARGET.has(c.operation) && !Object.hasOwn(resources, c.targetId))) refuse();
  }
}

async function cellsNode(check, target, deadline) {
  // Same relative REST v2 lookup as the Cells adapter (n/node/{Uuid}) under the
  // same base the adapter's cellsRestBaseUrl uses; no presigned URLs.
  const base = new URL(check.restBaseUrl);
  const url = new URL(`n/node/${encodeURIComponent(target.nativeRef)}?Flags=WithMetaDefaults`, base);
  if (url.origin !== base.origin) refuse();
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    headers: { authorization: `Bearer ${await ownerOnly(check.bearerFile, false)}` } });
  if (response.status !== 200) { await response.body?.cancel(); refuse(); }
  const node = JSON.parse(await boundedBody(response.body, 1 << 20));
  if (!object(node) || node.Uuid !== target.nativeRef || !['COLLECTION', 'LEAF'].includes(node.Type)
    || node.IsRecycled === true || node.IsRecycleBin === true) refuse();
}

async function weknoraBase(check, target, deadline) {
  const url = new URL(`api/v1/knowledge-bases/${encodeURIComponent(target.nativeRef)}`, new URL(check.apiBaseUrl));
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    headers: { 'x-api-key': await ownerOnly(check.apiKeyFile, false) } });
  if (response.status !== 200) { await response.body?.cancel(); refuse(); }
  const value = JSON.parse(await boundedBody(response.body, 1 << 20));
  if (value?.success !== true || value.data?.id !== target.nativeRef) refuse();
}

export async function openProvider(path) {
  const config = await ownerOnly(path);
  if (!exactKeys(config, ['mode', 'listenHost', 'listenPort', 'productionActionAudience', 'identityFile', 'bindingFile',
    'targetsFile', 'nativeCheck', 'requestTimeoutMs', 'requestMaxBytes'])
    || config.mode !== 'CONFORMANCE_ONLY' || !isIP(config.listenHost)
    || !Number.isSafeInteger(config.listenPort) || config.listenPort <= 0 || config.listenPort > 65535
    || !nonempty(config.productionActionAudience)
    || !['requestTimeoutMs', 'requestMaxBytes'].every((key) => Number.isSafeInteger(config[key]) && config[key] > 0)) refuse();
  const check = nativeCheckConfig(config.nativeCheck);
  const load = async () => {
    const [current, identity, binding, targets] = await Promise.all(
      [path, config.identityFile, config.bindingFile, config.targetsFile].map((name) => ownerOnly(name)));
    const jwks = JSON.parse(await readFile(identity.jwksFile, 'utf8'));
    const secret = await ownerOnly(bindingFacts(binding).serviceClientSecretFile, false);
    return { current, identity, binding, targets, jwks, secret,
      digest: sha256(canonical([current, identity, binding, targets, jwks])) };
  };
  const loaded = await load();
  const { identity, binding, jwks } = loaded;
  const resources = targetFacts(loaded.targets);
  if (canonical(loaded.current) !== canonical(config) || !nonempty(loaded.secret)) refuse();
  if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.some((key) => key.kty !== 'EC' || key.crv !== 'P-256'
    || !nonempty(key.kid) || key.d !== undefined)) refuse();
  validateContexts(identity, binding, resources, config.productionActionAudience);
  const unchanged = async () => {
    const now = await load();
    if (now.digest !== loaded.digest || !equalSecret(now.secret, loaded.secret)) refuse();
  };
  const verifyConfig = { actionTokenIssuer: identity.issuer, actionTokenAudience: identity.audience,
    actionTokenJwksFile: identity.jwksFile };
  const serviceToken = randomBytes(32).toString('base64url');
  let serviceTokenUntil = 0;

  async function decide(text, deadline) {
    let body;
    try { body = JSON.parse(text); } catch { refuse(400); }
    const keys = ['bindingId', 'actionToken', 'operation', 'argumentsJson'];
    // Session callbacks, content references and SOURCE batches belong to real
    // Core consumers; they are never simulated here.
    if (!exactKeys(body, keys) || body.bindingId !== binding.bindingId || !OPERATIONS.has(body.operation)
      || !nonempty(body.actionToken) || typeof body.argumentsJson !== 'string') refuse(400);
    const claims = await verifiedClaims(body.actionToken, verifyConfig);
    if (claims.exp - claims.iat > identity.tokenSeconds
      || !['jti', 'action_execution_id', 'operation_id'].every((key) => UUID.test(claims[key]))
      || ['agent_principal_id', 'delegation_id', 'delegation_version'].some((key) => Object.hasOwn(claims, key))
      || claims.initiating_human_principal_id !== claims.actor_principal_id) refuse(403);
    let args;
    try { args = JSON.parse(body.argumentsJson); } catch { refuse(400); }
    if (body.argumentsJson !== canonical(args)) refuse(400);
    const execute = body.operation === 'execute';
    const hashed = sha256(canonical(execute ? args : { operation: body.operation, arguments: args }));
    if (hashed !== claims.normalized_parameter_hash) refuse(403);
    if (execute) {
      const field = claims.target_type === 'ASSET' ? 'assetId' : 'resourceId';
      if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, [field]) || args.target[field] !== claims.target_id) refuse(403);
    }
    const matching = identity.contexts.filter((c) => c.operation === body.operation
      && c.actionKey === claims.action_key && c.actorPrincipalId === claims.actor_principal_id
      && c.tenantId === claims.tenant_id && c.workspaceId === claims.workspace_id
      && c.targetType === claims.target_type && c.targetId === claims.target_id
      && c.actionDefinitionVersion === claims.action_definition_version
      && c.resultExposurePolicyId === claims.result_exposure_policy_id
      && c.resultExposurePolicyVersion === claims.result_exposure_policy_version
      && c.authorizationMinZedToken === claims.authorization_min_zed_token
      && (!execute || c.externalExecutionId === claims.external_execution_id));
    const denied = matching.filter((c) => c.stepKey.startsWith('permission-denied:'));
    if (!matching.length || (denied.length && denied.length !== matching.length)) refuse(403);
    if (denied.length) return { status: 403, text: DENIED };
    const answer = { actionExecutionId: claims.action_execution_id, operationId: claims.operation_id,
      authorizationMinZedToken: matching[0].authorizationMinZedToken };
    if (NATIVE_TARGET.has(body.operation) && claims.target_type === 'RESOURCE') {
      const target = resources[claims.target_id] ?? refuse(403);
      if (check.kind === 'cells') await cellsNode(check, target, deadline);
      else await weknoraBase(check, target, deadline);
      await unchanged();
      answer.bindingGeneration = binding.bindingGeneration;
      answer.targetResource = { resourceId: claims.target_id, nativeType: target.nativeType, nativeRef: target.nativeRef,
        nativeInstanceRef: binding.nativeInstanceRef, nativeScopeRef: binding.nativeScopeRef };
    }
    return { status: 200, text: JSON.stringify(answer) };
  }

  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    try {
      if (request.method !== 'POST' || request.headers.origin || request.headers.cookie) refuse(403);
      const deadline = Date.now() + config.requestTimeoutMs;
      await unchanged();
      const text = await boundedBody(request, config.requestMaxBytes);
      if (request.url === TOKEN_PATH) {
        const expected = `Basic ${Buffer.from(`${encodeURIComponent(binding.serviceClientId)}:${encodeURIComponent(loaded.secret)}`).toString('base64')}`;
        if (!equalSecret(request.headers.authorization, expected) || text !== 'grant_type=client_credentials') refuse(401);
        serviceTokenUntil = Date.now() + identity.tokenSeconds * 1000;
        response.end(JSON.stringify({ token_type: 'Bearer', access_token: serviceToken, expires_in: identity.tokenSeconds }));
        return;
      }
      if (request.url !== PEP_PATH) refuse(404);
      if (!equalSecret(request.headers.authorization, `Bearer ${serviceToken}`) || Date.now() >= serviceTokenUntil) refuse(401);
      const decision = await decide(text, deadline);
      response.writeHead(decision.status).end(decision.text);
    } catch (error) {
      response.writeHead(error instanceof Refused ? error.status : 503).end('{}');
    }
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.requestTimeoutMs;
  return {
    server,
    config,
    close: async () => {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  openProvider(process.env.CONFORMANCE_PROVIDER_CONFIG_FILE)
    .then((provider) => {
      const shutdown = () => { void provider.close().finally(() => { process.exitCode = 0; }); };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
      provider.server.once('error', () => { void provider.close().finally(() => { process.exitCode = 1; }); });
      provider.server.listen(provider.config.listenPort, provider.config.listenHost, () => {
        process.stdout.write('CONFORMANCE_PROVIDER_LISTENING\n');
      });
    })
    .catch(() => {
      process.stderr.write('CONFORMANCE_PROVIDER_ENVIRONMENT_UNAVAILABLE\n');
      process.exitCode = 1;
    });
}

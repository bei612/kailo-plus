import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// The only native implementation here is the fixed Cells REST v2 read seam.
// No execute, editor, release activation or tool registration is implied.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUERY_PATH = '/platform-adapter/v1/query_revision';
const HEADER_KEYS = ['alg', 'kid', 'typ'];

class Refused extends Error {
  constructor(status) {
    super('adapter request refused');
    this.status = status;
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function queryDigest(argumentsValue) {
  // The original collab_bridge::limits::canonical_json rule; query fields are
  // strings, so number / cross-language floating point conversion is absent.
  return createHash('sha256').update(canonical({ operation: 'query_revision', arguments: argumentsValue })).digest('hex');
}

function fixedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Refused(503); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash) throw new Refused(503);
  return url;
}

export function configuration(value) {
  const required = ['bindingId', 'tenantId', 'nativeWorkspaceId', 'nativeRootRef',
    'cellsRestBaseUrl', 'cellsBearerFile', 'actionTokenIssuer', 'actionTokenAudience',
    'actionTokenJwksFile', 'corePepUrl', 'oidcTokenUrl', 'oidcClientId',
    'oidcClientSecretFile', 'timeoutMs', 'maxBodyBytes', 'listenHost', 'listenPort'];
  if (!object(value) || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => ![...required, 'workspaceId'].includes(key))) throw new Refused(503);
  for (const key of ['bindingId', 'tenantId', 'nativeWorkspaceId', 'nativeRootRef']) {
    if (!UUID.test(value[key])) throw new Refused(503);
  }
  if (value.workspaceId !== undefined && !UUID.test(value.workspaceId)) throw new Refused(503);
  for (const key of required.filter((key) => !['timeoutMs', 'maxBodyBytes', 'listenPort'].includes(key))) {
    if (!nonempty(value[key])) throw new Refused(503);
  }
  for (const key of ['timeoutMs', 'maxBodyBytes', 'listenPort']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) throw new Refused(503);
  }
  if (value.listenPort > 65535) throw new Refused(503);
  for (const key of ['cellsRestBaseUrl', 'corePepUrl', 'oidcTokenUrl', 'actionTokenIssuer']) fixedUrl(value[key]);
  const pep = fixedUrl(value.corePepUrl);
  if (pep.pathname !== '/service/v1/adapter/pep_check') throw new Refused(503);
  for (const key of ['cellsBearerFile', 'actionTokenJwksFile', 'oidcClientSecretFile']) {
    if (!value[key].startsWith('/')) throw new Refused(503);
  }
  return Object.freeze({ ...value });
}

async function boundedBody(stream, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Refused(503);
    chunks.push(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function requestValue(raw, key) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(value, ['nativeObjectRef', 'idempotencyKey']) || !UUID.test(value.nativeObjectRef)
    || !nonempty(value.idempotencyKey) || /[\r\n]/.test(value.idempotencyKey)
    || value.idempotencyKey !== key) throw new Refused(400);
  // Core emits canonical JSON. Exact comparison also rejects duplicate keys,
  // which JSON.parse alone would silently resolve to their last value.
  if (raw !== canonical(value)) throw new Refused(400);
  return value;
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Refused(401);
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.toString('base64url') !== part) throw new Refused(401);
  return bytes;
}

async function verifyToken(token, config, args) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Refused(401);
    const header = JSON.parse(decodePart(parts[0]).toString('utf8'));
    const claims = JSON.parse(decodePart(parts[1]).toString('utf8'));
    if (!exactKeys(header, HEADER_KEYS) || header.alg !== 'ES256' || header.typ !== 'JWT' || !nonempty(header.kid)) throw new Refused(401);
    const jwks = JSON.parse(await readFile(config.actionTokenJwksFile, 'utf8'));
    if (!object(jwks) || !Array.isArray(jwks.keys)) throw new Refused(503);
    const matches = jwks.keys.filter((key) => object(key) && key.kid === header.kid);
    if (matches.length !== 1) throw new Refused(401);
    const key = matches[0];
    if (key.kty !== 'EC' || key.crv !== 'P-256' || key.d !== undefined
      || (key.alg !== undefined && key.alg !== 'ES256')
      || (key.use !== undefined && key.use !== 'sig')
      || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))) throw new Refused(401);
    const publicKey = createPublicKey({ key, format: 'jwk' });
    const signature = decodePart(parts[2]);
    if (signature.length !== 64 || !verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) throw new Refused(401);
    const now = Math.floor(Date.now() / 1000);
    if (!object(claims) || claims.iss !== config.actionTokenIssuer || claims.aud !== config.actionTokenAudience
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat > now || claims.exp <= now || claims.exp <= claims.iat
      || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))) throw new Refused(401);
    for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'agent_principal_id',
      'initiating_human_principal_id', 'operation_id', 'action_execution_id', 'target_id', 'delegation_id']) {
      if (!UUID.test(claims[key])) throw new Refused(401);
    }
    if (claims.tenant_id !== config.tenantId || claims.actor_principal_id !== claims.agent_principal_id
      || (config.workspaceId !== undefined && claims.workspace_id !== config.workspaceId)
      || (claims.workspace_id !== undefined && !UUID.test(claims.workspace_id))
      || !['RESOURCE', 'ASSET'].includes(claims.target_type)
      || !nonempty(claims.action_key) || !nonempty(claims.authorization_min_zed_token)
      || !UUID.test(claims.result_exposure_policy_id)
      || !Number.isSafeInteger(claims.result_exposure_policy_version) || claims.result_exposure_policy_version <= 0
      || !Number.isSafeInteger(claims.delegation_version) || claims.delegation_version <= 0
      || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
      || claims.normalized_parameter_hash !== queryDigest(args)) throw new Refused(401);
    return claims;
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused(401);
  }
}

async function secret(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    if (!value || /[\r\n]/.test(value)) throw new Refused(503);
    return value;
  } catch { throw new Refused(503); }
}

async function jsonFetch(config, deadline, url, options) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Refused(503);
  try {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(remaining) });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      await response.body?.cancel();
      throw new Refused(503);
    }
    return JSON.parse(await boundedBody(response.body, config.maxBodyBytes));
  } catch { throw new Refused(503); }
}

async function freshPep(config, deadline, token, args, claims) {
  const clientSecret = await secret(config.oidcClientSecretFile);
  const oidc = await jsonFetch(config, deadline, config.oidcTokenUrl, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.oidcClientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!object(oidc) || !nonempty(oidc.access_token) || /[\r\n]/.test(oidc.access_token)
    || oidc.token_type?.toLowerCase() !== 'bearer') throw new Refused(503);
  const answer = await jsonFetch(config, deadline, config.corePepUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${oidc.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bindingId: config.bindingId, actionToken: token,
      operation: 'query_revision', argumentsJson: canonical(args) }),
  });
  if (!exactKeys(answer, ['actionExecutionId', 'operationId', 'authorizationMinZedToken'])
    || answer.actionExecutionId !== claims.action_execution_id || answer.operationId !== claims.operation_id
    || !nonempty(answer.authorizationMinZedToken)) throw new Refused(503);
}

function nativePath(value) {
  if (!nonempty(value) || value.includes('\\') || /[\x00-\x1f]/.test(value)
    || value.split('/').some((part) => part === '.' || part === '..')) throw new Refused(503);
  return value.replace(/\/$/, '');
}

function nativeNode(value, id, workspaceId, type) {
  if (!object(value) || value.Uuid !== id || value.Type !== type
    || !object(value.ContextWorkspace) || value.ContextWorkspace.Uuid !== workspaceId
    || value.IsRecycled === true || value.IsRecycleBin === true) throw new Refused(503);
  for (const flag of ['IsRecycled', 'IsRecycleBin']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Refused(503);
  }
  return nativePath(value.Path);
}

async function currentRevision(config, deadline, args) {
  const bearer = await secret(config.cellsBearerFile);
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
  const nodeUrl = (id) => new URL(`n/node/${id}?Flags=WithVersionsAll`, base);
  // UUID lookup resolves the fixed binding root before reading its member.
  // WithVersionsAll does not request pre-signed URLs; no path comes from input.
  const root = await jsonFetch(config, deadline, nodeUrl(config.nativeRootRef), { headers });
  const rootPath = nativeNode(root, config.nativeRootRef, config.nativeWorkspaceId, 'COLLECTION');
  const target = await jsonFetch(config, deadline, nodeUrl(args.nativeObjectRef), { headers });
  const targetPath = nativeNode(target, args.nativeObjectRef, config.nativeWorkspaceId, 'LEAF');
  if (!targetPath.startsWith(`${rootPath}/`)) throw new Refused(403);
  const response = await jsonFetch(config, deadline, new URL(`n/node/${args.nativeObjectRef}/versions`, base), {
    method: 'POST', headers,
    // Fixed c57f02f... NodeVersions reads Query directly, not {Query: ...}.
    // Limit zero asks the native list for all entries. A bounded response must
    // contain exactly one declared head; neither MTime nor ETag fills a gap.
    body: JSON.stringify({ FilterBy: 'VersionsAll', Offset: 0, Limit: 0, Flags: ['WithMetaNone'] }),
  });
  if (!object(response) || !Array.isArray(response.Versions) || !response.Versions.length) throw new Refused(503);
  const ids = new Set();
  const heads = [];
  for (const version of response.Versions) {
    if (!object(version) || !nonempty(version.VersionId) || ids.has(version.VersionId)
      || (version.IsHead !== undefined && typeof version.IsHead !== 'boolean')) throw new Refused(503);
    ids.add(version.VersionId);
    if (version.IsHead === true) heads.push(version.VersionId);
  }
  if (heads.length !== 1) throw new Refused(503);
  return heads[0];
}

export function createAdapter(rawConfig) {
  const config = configuration(rawConfig);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== QUERY_PATH) throw new Refused(404);
      if (request.headers['content-type'] !== 'application/json' || typeof request.headers.authorization !== 'string'
        || !request.headers.authorization.startsWith('Bearer ')) throw new Refused(401);
      const deadline = Date.now() + config.timeoutMs;
      const raw = await boundedBody(request, config.maxBodyBytes);
      const args = requestValue(raw, request.headers['idempotency-key']);
      const token = request.headers.authorization.slice(7);
      const claims = await verifyToken(token, config, args);
      await freshPep(config, deadline, token, args, claims);
      const nativeRevision = await currentRevision(config, deadline, args);
      // A read can race revocation or token expiry. Never disclose a revision
      // on the strength of only the earlier PEP result.
      const currentClaims = await verifyToken(token, config, args);
      await freshPep(config, deadline, token, args, currentClaims);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ nativeObjectRef: args.nativeObjectRef, nativeRevision }));
    } catch (error) {
      if (!response.headersSent) response.writeHead(error instanceof Refused ? error.status : 503,
        { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"error":"adapter request refused"}');
    }
  });
  server.requestTimeout = config.timeoutMs;
  server.headersTimeout = config.timeoutMs;
  server.timeout = config.timeoutMs;
  return server;
}

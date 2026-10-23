// Shared wire machinery from the existing Cells adapter. Component-specific
// actions, targets and native scope policy remain in each actual consumer.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';

export class Refused extends Error {
  constructor(status) {
    super('adapter request refused');
    this.status = status;
  }
}

// A definite DENIED decision from the binding-authenticated Core PEP: its
// closed ErrorBody (governance.rs Refusal::respond, contracts ErrorBody) with
// HTTP 403. Only this answer may be reported to the caller as the wire DENIED
// class (Core's permission-denied conformance probe, component_release.rs
// prewrite). Every other PEP failure, including a bare 403, stays 503/UNKNOWN.
const PEP_DENIAL_REASONS = Object.freeze(['PERMISSION_DENIED', 'SCOPE_GUARD_FAILED', 'APPROVAL_DENIED']);
export class PepDenied extends Refused {
  constructor(reason) {
    super(403);
    this.body = Object.freeze({ class: 'DENIED', reason });
  }
}

export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nonempty(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

export function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Native errors are opaque input, never a source for response text or a
// terminal execution observation. An unrecognized transport/status cannot
// prove that an external effect failed, and must retain UNKNOWN semantics.
export function nativeStatusErrorArguments(raw, key) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  const keys = ['idempotencyKey', 'nativeStatus'];
  if (object(value) && Object.hasOwn(value, 'nativeError')) keys.push('nativeError');
  if (!exactKeys(value, keys)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.idempotencyKey)
    || value.idempotencyKey !== key || raw !== canonical(value)
    || !(Number.isSafeInteger(value.nativeStatus) || nonempty(value.nativeStatus))) throw new Refused(400);
  return value;
}

export function mapNativeStatusError(value) {
  switch (value.nativeStatus) {
    case 401:
    case 403: return { class: 'DENIED', reason: 'PERMISSION_DENIED' };
    case 501: return { class: 'BLOCKED', reason: 'CAPABILITY_BLOCKED' };
    case 404: return { class: 'PRECONDITION', reason: 'TARGET_NOT_FOUND' };
    case 400:
    case 405:
    case 412:
    case 422: return { class: 'PRECONDITION', reason: 'INVALID_PARAMETERS' };
    case 413: return { class: 'LIMIT', reason: 'PAYLOAD_TOO_LARGE' };
    case 429: return { class: 'LIMIT', reason: 'RATE_LIMITED' };
    case 409:
    case 423: return { class: 'CONFLICT', reason: 'TARGET_STATE_CONFLICT' };
    default: return { class: 'UNKNOWN', reason: 'EXTERNAL_RESULT_UNKNOWN' };
  }
}

// A JWT `iss` is a case-sensitive StringOrURI compared exactly, and a value
// containing ':' must be a URI (RFC 7519 §2, §4.1.1). Core takes
// GATEWAY_SERVICE_ISSUER as any non-blank string and checks it exactly
// (core service_auth.rs GatewayServiceAuth::from_env / set_issuer; its fixture
// is urn:test:gateway), and AgentGateway jwtSign signs it verbatim as `iss`
// (agentgateway http/auth/jwt_sign.rs claims). The live value is
// urn:kailo:agentgateway:service. It is never fetched, so only an http(s)
// issuer also has to be a fixed URL; whitespace or control characters refuse.
export function exactIssuer(value) {
  if (!nonempty(value) || /\s/.test(value)
    || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Refused(503);
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1].toLowerCase();
  if (value.includes(':') && scheme === undefined) throw new Refused(503);
  if (scheme === 'http' || scheme === 'https') fixedUrl(value);
  return value;
}

export function fixedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Refused(503); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash) throw new Refused(503);
  return url;
}

export async function boundedBody(stream, limit) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(stream, limit));
}

export async function boundedBytes(stream, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Refused(503);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Refused(401);
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.toString('base64url') !== part) throw new Refused(401);
  return bytes;
}

// This proves signature, issuer, audience and time only. It deliberately does
// not authorize any action or replace a component's scope checks or Core PEP.
export async function verifiedClaims(token, config) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Refused(401);
    const header = JSON.parse(decodePart(parts[0]).toString('utf8'));
    const claims = JSON.parse(decodePart(parts[1]).toString('utf8'));
    if (!exactKeys(header, ['alg', 'kid', 'typ']) || header.alg !== 'ES256'
      || header.typ !== 'JWT' || !nonempty(header.kid)) throw new Refused(401);
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
    return claims;
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused(401);
  }
}

// Existing binding-create management tokens carry no business Resource or
// ResultExposure authority. Both native adapters use the same signed shape.
export async function verifyBindingManagementToken(token, config, args, operation) {
  if (!['handshake', 'validate_binding', 'reconcile'].includes(operation)) throw new Refused(401);
  const claims = await verifiedClaims(token, config);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'initiating_human_principal_id',
    'operation_id', 'action_execution_id', 'target_id']) {
    if (!uuid.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId || claims.workspace_id !== config.workspaceId
    || claims.target_type !== 'APPLICATION_BINDING' || claims.target_id !== config.bindingId
    || !(operation === 'reconcile'
      ? ['application_binding.create', 'application_binding.disable'].includes(claims.action_key)
      : claims.action_key === 'application_binding.create')
    || claims.actor_principal_id !== claims.initiating_human_principal_id
    || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
    || !nonempty(claims.authorization_min_zed_token)
    || ['agent_principal_id', 'delegation_id', 'delegation_version', 'result_exposure_policy_id',
      'result_exposure_policy_version'].some(key => Object.hasOwn(claims, key))
    || claims.normalized_parameter_hash !== createHash('sha256')
      .update(canonical({ operation, arguments: args })).digest('hex')) throw new Refused(401);
  return claims;
}

// DD-138(5), .design/07 §4.8.4 / §5.2: Core's 60 s Search Token for the
// read-only `search` operation. It names the HUMAN actor and this exact binding
// and request body; it carries no Resource target, Delegation, Agent or result
// exposure authority, and is not an ActionExecution. Core has already done the
// per-Resource fresh `read` check: the adapter searches only `resources[]`.
export const SEARCH_TOKEN_USE = 'COMPONENT_SEARCH';
export const SEARCH_RESULT_KINDS = Object.freeze(['FILE', 'FOLDER', 'DOCUMENT', 'KNOWLEDGE_BASE', 'QUESTION', 'DASHBOARD']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function searchArguments(raw, key) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(value, ['idempotencyKey', 'query', 'limit', 'locale', 'resources'])
    || raw !== canonical(value) || value.idempotencyKey !== key || !UUID.test(value.idempotencyKey)
    || typeof value.query !== 'string' || value.query !== value.query.trim()
    || [...value.query].length < 1 || [...value.query].length > 200 || /\p{Cc}/u.test(value.query)
    || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 20
    || !['ZH_CN', 'EN'].includes(value.locale)
    || !Array.isArray(value.resources) || value.resources.length < 1 || value.resources.length > 50
    || value.resources.some((item) => !exactKeys(item, ['resourceId', 'nativeType', 'nativeId'])
      || !UUID.test(item.resourceId) || !nonempty(item.nativeType) || !nonempty(item.nativeId))
    || new Set(value.resources.map((item) => item.resourceId)).size !== value.resources.length) throw new Refused(400);
  return value;
}

export async function verifySearchToken(token, config, args) {
  const claims = await verifiedClaims(token, config);
  for (const key of ['jti', 'tenant_id', 'binding_id', 'actor_principal_id']) {
    if (!UUID.test(claims[key])) throw new Refused(401);
  }
  const workspace = config.workspaceId ?? undefined;
  if (claims.token_use !== SEARCH_TOKEN_USE || claims.tenant_id !== config.tenantId
    || claims.workspace_id !== workspace || claims.binding_id !== config.bindingId
    || !Number.isSafeInteger(claims.projection_generation) || claims.projection_generation <= 0
    || !nonempty(claims.authorization_min_zed_token) || claims.exp - claims.iat > 60
    || ['agent_principal_id', 'delegation_id', 'delegation_version', 'result_exposure_policy_id',
      'result_exposure_policy_version', 'action_execution_id', 'target_id', 'action_key']
      .some((key) => Object.hasOwn(claims, key))
    || claims.normalized_parameter_hash !== createHash('sha256').update(canonical(args)).digest('hex')) throw new Refused(401);
  return claims;
}

// The same relative-path rule Core applies (07 §4.8.3): one leading slash, no
// backslash, whitespace or control character, no credential-like query name.
const CREDENTIAL_QUERY = new Set(['token', 'access_token', 'id_token', 'refresh_token', 'code', 'secret',
  'password', 'api_key', 'key', 'signature', 'sig']);
export function componentPath(path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 1024 || !path.startsWith('/')
    || path.startsWith('//') || /[\\\s\p{Cc}]/u.test(path)) return false;
  let url;
  try { url = new URL(path, 'https://component.invalid'); } catch { return false; }
  if (url.origin !== 'https://component.invalid') return false;
  for (const name of url.searchParams.keys()) if (CREDENTIAL_QUERY.has(name.toLowerCase())) return false;
  return true;
}

// Adapters sanitize their own answer to the AdapterSearchResponse shape; Core
// still rejects the whole source if anything it receives is out of contract.
export function searchResponse(results, limit) {
  if (!Array.isArray(results)) throw new Refused(503);
  const valid = results.map((item) => {
    const out = { kind: item?.kind, path: item?.path, title: String(item?.title ?? '').replace(/\p{Cc}+/gu, ' ').trim().slice(0, 200) };
    const summary = typeof item?.summary === 'string' ? item.summary.replace(/\p{Cc}+/gu, ' ').trim().slice(0, 400) : '';
    if (summary) out.summary = summary;
    if (typeof item?.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))) out.updatedAt = new Date(item.updatedAt).toISOString();
    return out;
  }).filter((item) => SEARCH_RESULT_KINDS.includes(item.kind) && item.title && componentPath(item.path));
  return { results: valid.slice(0, limit) };
}

export async function secret(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    if (!value || /[\r\n]/.test(value)) throw new Refused(503);
    return value;
  } catch { throw new Refused(503); }
}

// Reuses Wren nativeBindingService.ts::connectionSecret's Agent Unix proxy.
// No adapter token, network Bao endpoint, cache or second secret authority.
// Core authenticates this actual read's audit pair, role and AE time window.
export async function readSecretDeliveryReceipt(entry, maximumBytes, deadline) {
  try {
    const remaining = deadline - Date.now();
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || remaining <= 0) throw new Refused(503);
    const locator = /^tenants\/([a-f0-9-]{36})\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)$/.exec(entry.locator);
    if (!locator || !entry.secretSocket?.startsWith('/') || !nonempty(entry.secretValueKey)) throw new Refused(503);
    const proof = await new Promise((resolve, reject) => {
      const pending = request({ socketPath: entry.secretSocket, method: 'GET',
        path: `/v1/${locator[2]}/data/${locator[3]}?version=${entry.version}`,
        headers: { 'X-Vault-Namespace': `tenants/${locator[1]}` }, timeout: remaining }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maximumBytes) { reject(new Refused(503)); response.destroy(); pending.destroy(); }
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new Refused(503)));
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw new Refused(503);
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch { reject(new Refused(503)); }
        });
      });
      const timer = setTimeout(() => { reject(new Refused(503)); pending.destroy(); }, remaining);
      pending.on('close', () => clearTimeout(timer));
      pending.on('timeout', () => { reject(new Refused(503)); pending.destroy(); });
      pending.on('error', () => reject(new Refused(503)));
      pending.end();
    });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(proof.request_id)
      || proof.data?.metadata?.version !== entry.version || proof.data.metadata.destroyed !== false
      || proof.data.metadata.deletion_time !== '' || !object(proof.data.data)
      || typeof proof.data.data[entry.secretValueKey] !== 'string'
      || proof.data.data[entry.secretValueKey] !== await secret(entry.secretFile)) throw new Refused(503);
    return { secretKey: entry.secretKey, requestId: proof.request_id, version: entry.version, audience: entry.audience };
  } catch { throw new Refused(503); }
}

export async function jsonFetch(config, deadline, url, options) {
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

export async function serviceBearer(config, deadline) {
  const clientSecret = await secret(config.oidcClientSecretFile);
  const oidc = await jsonFetch(config, deadline, config.oidcTokenUrl, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.oidcClientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!object(oidc) || !nonempty(oidc.access_token) || /[\r\n]/.test(oidc.access_token)
    || oidc.token_type?.toLowerCase() !== 'bearer') throw new Refused(503);
  return oidc.access_token;
}

// Registered meter keys are deployment inputs; the two native consumers supply
// only their actually observed count/byte facts, never a balance or price.
export function readMeasurements(mapping, bytes) {
  if (mapping === undefined) return [];
  if (!Array.isArray(mapping) || !Number.isSafeInteger(bytes) || bytes < 0) throw new Refused(503);
  const keys = new Set();
  return mapping.map(item => {
    if (!exactKeys(item, ['meterKey', 'quantitySource']) || !nonempty(item.meterKey)
      || keys.has(item.meterKey) || !['COUNT', 'CONTENT_BYTES'].includes(item.quantitySource)) throw new Refused(503);
    keys.add(item.meterKey);
    return {meterKey:item.meterKey,quantity:item.quantitySource==='COUNT' ? 1 : bytes};
  });
}

export async function recordReadReceipt(config, deadline, receipt) {
  const bearer = await serviceBearer(config, deadline);
  const digest = createHash('sha256').update(canonical(receipt)).digest('hex');
  const result = await jsonFetch(config, deadline,
    new URL('/service/v1/adapter/read_receipt', config.corePepUrl), {
      method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},
      body:canonical(receipt),
    });
  if (!exactKeys(result, ['operationId','receiptDigest']) || result.operationId!==receipt.operationId
    || result.receiptDigest!==digest) throw new Refused(503);
}

async function pepAnswer(config, deadline, bearer, body) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Refused(503);
  let response;
  try {
    response = await fetch(config.corePepUrl, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(remaining),
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body });
  } catch { throw new Refused(503); }
  let value;
  try {
    if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      await response.body?.cancel();
      throw new Refused(503);
    }
    value = JSON.parse(await boundedBody(response.body, config.maxBodyBytes));
  } catch { throw new Refused(503); }
  if (response.status === 403 && object(value) && value.class === 'DENIED' && PEP_DENIAL_REASONS.includes(value.reason)
    && (exactKeys(value, ['class', 'reason'])
      || (exactKeys(value, ['class', 'reason', 'operationId']) && nonempty(value.operationId)))) throw new PepDenied(value.reason);
  if (!response.ok) throw new Refused(503);
  return value;
}

export async function freshPep(config, deadline, token, args, claims, operation = 'query_revision') {
  const bearer = await serviceBearer(config, deadline);
  const answer = await pepAnswer(config, deadline, bearer, JSON.stringify({ bindingId: config.bindingId, actionToken: token,
    operation, argumentsJson: canonical(args) }));
  const keys = ['actionExecutionId', 'operationId', 'authorizationMinZedToken'];
  if (object(answer) && Object.hasOwn(answer, 'nativeTaskDeadline')) {
    keys.push('nativeTaskDeadline');
    const expiry = Date.parse(answer.nativeTaskDeadline);
    if (operation !== 'execute' || typeof answer.nativeTaskDeadline !== 'string'
      || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== answer.nativeTaskDeadline)
      throw new Refused(503);
  }
  if (object(answer) && Object.hasOwn(answer, 'bindingGeneration')) {
    keys.push('bindingGeneration');
    if (!Number.isSafeInteger(answer.bindingGeneration) || answer.bindingGeneration <= 0)
      throw new Refused(503);
  }
  if (object(answer) && Object.hasOwn(answer, 'targetResource')) {
    keys.push('targetResource');
    const resource = answer.targetResource;
    if (!exactKeys(resource, ['resourceId', 'nativeType', 'nativeRef', 'nativeInstanceRef', 'nativeScopeRef'])
      || !['execute', 'receiver_start', 'receiver_observe'].includes(operation)
      || claims.target_type !== 'RESOURCE' || resource.resourceId !== claims.target_id
      || typeof resource.resourceId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(resource.resourceId)
      || ['nativeType', 'nativeRef', 'nativeInstanceRef', 'nativeScopeRef'].some(key => !nonempty(resource[key]))) {
      throw new Refused(503);
    }
  }
  if (!exactKeys(answer, keys)
    || answer.actionExecutionId !== claims.action_execution_id || answer.operationId !== claims.operation_id
    || !nonempty(answer.authorizationMinZedToken)) throw new Refused(503);
  return answer;
}

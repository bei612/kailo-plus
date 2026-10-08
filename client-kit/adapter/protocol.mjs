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
  if (!['handshake', 'validate_binding'].includes(operation)) throw new Refused(401);
  const claims = await verifiedClaims(token, config);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'initiating_human_principal_id',
    'operation_id', 'action_execution_id', 'target_id']) {
    if (!uuid.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId || claims.workspace_id !== config.workspaceId
    || claims.target_type !== 'APPLICATION_BINDING' || claims.target_id !== config.bindingId
    || claims.action_key !== 'application_binding.create'
    || claims.actor_principal_id !== claims.initiating_human_principal_id
    || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
    || !nonempty(claims.authorization_min_zed_token)
    || ['agent_principal_id', 'delegation_id', 'delegation_version', 'result_exposure_policy_id',
      'result_exposure_policy_version'].some(key => Object.hasOwn(claims, key))
    || claims.normalized_parameter_hash !== createHash('sha256')
      .update(canonical({ operation, arguments: args })).digest('hex')) throw new Refused(401);
  return claims;
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

export async function freshPep(config, deadline, token, args, claims, operation = 'query_revision') {
  const bearer = await serviceBearer(config, deadline);
  const answer = await jsonFetch(config, deadline, config.corePepUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bindingId: config.bindingId, actionToken: token,
      operation, argumentsJson: canonical(args) }),
  });
  const keys = ['actionExecutionId', 'operationId', 'authorizationMinZedToken'];
  if (object(answer) && Object.hasOwn(answer, 'targetResource')) {
    keys.push('targetResource');
    const resource = answer.targetResource;
    if (!exactKeys(resource, ['resourceId', 'nativeType', 'nativeRef', 'nativeInstanceRef', 'nativeScopeRef'])
      || operation !== 'execute' || claims.target_type !== 'RESOURCE' || resource.resourceId !== claims.target_id
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

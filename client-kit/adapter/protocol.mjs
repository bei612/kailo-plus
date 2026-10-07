// Shared wire machinery from the existing Cells adapter. Component-specific
// actions, targets and native scope policy remain in each actual consumer.
import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

export async function secret(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    if (!value || /[\r\n]/.test(value)) throw new Refused(503);
    return value;
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

export async function freshPep(config, deadline, token, args, claims, operation = 'query_revision') {
  const bearer = await serviceBearer(config, deadline);
  const answer = await jsonFetch(config, deadline, config.corePepUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bindingId: config.bindingId, actionToken: token,
      operation, argumentsJson: canonical(args) }),
  });
  if (!exactKeys(answer, ['actionExecutionId', 'operationId', 'authorizationMinZedToken'])
    || answer.actionExecutionId !== claims.action_execution_id || answer.operationId !== claims.operation_id
    || !nonempty(answer.authorizationMinZedToken)) throw new Refused(503);
}

import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

// SS-WRN-IDENTITY: login is owned by the OIDC gateway. The native backend
// verifies its own audience and instance entitlement, including direct access.
let identity: {
  source: string;
  issuer: string;
  audience: string;
  accessClaim: string;
  accessValue: string;
  publicOrigin: string;
  keys: ReturnType<typeof createRemoteJWKSet>;
};

function nativeIdentity() {
  const source = process.env.WREN_NATIVE_IDENTITY_JSON;
  if (!source) throw new Error('Native identity configuration is required');
  if (identity?.source === source) return identity;
  const value = JSON.parse(source);
  const fields = [
    'issuer',
    'audience',
    'jwksUrl',
    'accessClaim',
    'accessValue',
    'publicOrigin',
  ];
  if (
    !value ||
    Array.isArray(value) ||
    fields.some(
      (field) =>
        typeof value[field] !== 'string' ||
        !value[field] ||
        value[field] !== value[field].trim(),
    )
  ) {
    throw new Error('Invalid native identity configuration');
  }
  for (const field of ['issuer', 'jwksUrl', 'publicOrigin']) {
    const url = new URL(value[field]);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (field === 'publicOrigin' && value[field] !== url.origin)
    ) {
      throw new Error('Invalid native identity URL');
    }
  }
  // Registered identity claims are not native access entitlements.
  if (
    ['iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti'].includes(
      value.accessClaim,
    )
  ) {
    throw new Error('A dedicated native access claim is required');
  }
  identity = {
    source,
    issuer: value.issuer,
    audience: value.audience,
    accessClaim: value.accessClaim,
    accessValue: value.accessValue,
    publicOrigin: value.publicOrigin,
    keys: createRemoteJWKSet(new URL(value.jwksUrl)),
  };
  return identity;
}

function denied(status: number, code: string) {
  return NextResponse.json(
    { error: code },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

// Runtime deployment input, not a build-time Next substitution or a browser
// supplied origin. Embedding never changes the native identity/CSRF policy.
export function nativeFrameAncestors(raw: string | undefined): string {
  const origins = raw?.trim().split(/\s+/).filter(Boolean) ?? [];
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:', 'tauri:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      origin !== `${parsed.protocol}//${parsed.host}` ||
      (parsed.port !== '' && Number(parsed.port) === 0) ||
      /[*;'"\\]/.test(origin)
    ) {
      throw new Error('Invalid native frame ancestor');
    }
  }
  return `frame-ancestors 'self'${origins.length ? ` ${origins.join(' ')}` : ''}`;
}

export async function middleware(request: NextRequest) {
  let ancestors: string;
  try {
    ancestors = nativeFrameAncestors(process.env.KAILO_FRAME_ANCESTORS);
  } catch {
    return denied(503, 'NATIVE_FRAME_CONFIGURATION_UNAVAILABLE');
  }
  // Exact machine routes authenticate in their original Node handler: Gateway
  // service JWT for MCP; ActionToken + fresh Core PEP for lifecycle/observation.
  // No other native page/API is exempt from the dedicated browser identity.
  if (
    [
      '/api/platform-adapter/mcp',
      '/api/platform-adapter/observe',
      '/api/platform-adapter/execute',
      '/platform-adapter/v1/execute',
      '/platform-adapter/v1/observe',
      '/api/platform-adapter/handshake',
      '/api/platform-adapter/validate_binding',
      '/platform-adapter/v1/handshake',
      '/platform-adapter/v1/validate_binding',
    ].includes(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }
  let configured: ReturnType<typeof nativeIdentity>;
  try {
    configured = nativeIdentity();
  } catch {
    return denied(503, 'NATIVE_IDENTITY_UNAVAILABLE');
  }

  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1];
  if (!token) return denied(401, 'NATIVE_AUTHENTICATION_REQUIRED');

  let identityScope: string;
  try {
    const { payload } = await jwtVerify(token, configured.keys, {
      issuer: configured.issuer,
      audience: configured.audience,
      requiredClaims: ['iss', 'sub', 'aud', 'exp'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      return denied(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    }
    const access = payload[configured.accessClaim];
    const permitted =
      access === configured.accessValue ||
      (Array.isArray(access) &&
        access.every((entry) => typeof entry === 'string') &&
        access.includes(configured.accessValue));
    if (!permitted) return denied(403, 'NATIVE_INSTANCE_ACCESS_DENIED');
    // A non-authorizing browser storage partition, derived only after signature
    // and native-instance verification. Never expose the token or raw subject.
    identityScope = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify([
              configured.issuer,
              payload.sub,
              configured.audience,
              configured.accessValue,
            ]),
          ),
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    if (
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWKSNoMatchingKey
    ) {
      return denied(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    }
    // A failed key lookup is unavailable, not permission to bypass verification.
    return denied(503, 'NATIVE_IDENTITY_UNAVAILABLE');
  }

  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    request.headers.get('origin') !== configured.publicOrigin
  ) {
    return denied(403, 'NATIVE_REQUEST_ORIGIN_DENIED');
  }

  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  headers.delete('x-kailo-native-human-token');
  headers.delete('x-kailo-native-identity-scope');
  const boundSql =
    ['/api/v1/run_sql', '/api/v1/generate_summary'].includes(
      request.nextUrl.pathname,
    ) && process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
  if (
    boundSql ||
    ['/api/graphql', '/api/config', '/api/ask_task/streaming_answer'].includes(
      request.nextUrl.pathname,
    )
  ) {
    headers.set('x-kailo-native-identity-scope', identityScope);
  }
  // Private Next hop only; Core independently verifies this original signed
  // token. Never synthesize a trusted subject/issuer from browser headers.
  if (
    boundSql ||
    [
      '/api/graphql',
      '/api/platform-query-reference',
      '/api/ask_task/streaming_answer',
    ].includes(request.nextUrl.pathname)
  )
    headers.set('x-kailo-native-human-token', token);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Content-Security-Policy', ancestors);
  return response;
}

// Protect native pages, API/GraphQL, streams, Next data and assets alike.
export const config = { matcher: '/:path*' };

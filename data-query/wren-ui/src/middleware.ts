import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { isGovernedQueryMode } from './apollo/server/services/nativeQueryMode';
import {
  encodeKailoUser,
  kailoUserFromClaims,
  KailoUserProfile,
  KAILO_SERVICE_HEADER,
  KAILO_USER_HEADER,
} from './utils/kailoUser';
import {
  adminSurfaceRoute,
  businessHomePath,
  nativeAdminRouteClosed,
} from './utils/kailoAdminSurface';

// DD-133(4): the Node consumer that answers the caller's own member directory
// entry (`src/pages/api/kailo/directory-access.ts`). It is reached only
// through this middleware, which sets the verified user from the token.
export const KAILO_DIRECTORY_ACCESS_PATH = '/api/kailo/directory-access';

// The member directory is configured for this deployment (Edge only reads the
// env; the Node side refuses to start on a partial configuration).
function directoryConfigured(): boolean {
  return Boolean(process.env.KAILO_DIRECTORY_BINDING_ID?.trim());
}

// SS-WRN-IDENTITY: login is owned by the OIDC gateway. The native backend
// verifies its own audience, including direct access. Bound HUMAN business
// access comes from the existing Core binding/membership/SpiceDB consumer.
let identity: {
  source: string;
  issuer: string;
  audience: string;
  serviceAudience?: string;
  accessClaim: string;
  accessValue: string;
  publicOrigin: string;
  keys: ReturnType<typeof createRemoteJWKSet>;
};

function entitled(claim: unknown, value: string): boolean {
  return (
    claim === value ||
    (Array.isArray(claim) &&
      claim.every((entry) => typeof entry === 'string') &&
      claim.includes(value))
  );
}

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
    ['iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti', 'azp'].includes(
      value.accessClaim,
    )
  ) {
    throw new Error('A dedicated native access claim is required');
  }
  if (
    value.serviceAudience !== undefined &&
    (typeof value.serviceAudience !== 'string' ||
      !value.serviceAudience ||
      value.serviceAudience !== value.serviceAudience.trim() ||
      value.serviceAudience === value.audience)
  ) {
    throw new Error('A separate native service audience is required');
  }
  identity = {
    source,
    issuer: value.issuer,
    audience: value.audience,
    serviceAudience: value.serviceAudience,
    accessClaim: value.accessClaim,
    accessValue: value.accessValue,
    publicOrigin: value.publicOrigin,
    keys: createRemoteJWKSet(new URL(value.jwksUrl)),
  };
  return identity;
}

// The private Node origin of this same instance (never the public origin).
function nodeOrigin(publicOrigin: string): URL | null {
  const endpoint = process.env.WREN_UI_ENDPOINT;
  if (!endpoint || endpoint !== endpoint.trim()) return null;
  let origin: URL;
  try {
    origin = new URL(endpoint);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.hash ||
    origin.search ||
    origin.pathname !== '/' ||
    origin.origin === publicOrigin
  )
    return null;
  return origin;
}

// DD-138(6) (`07` §4.8.5): a closed admin route goes to the business home
// before any page is served. Same-origin, so Next answers with a relative
// Location (and `x-nextjs-redirect` for client data requests).
function toBusinessHome(request: NextRequest) {
  const home = request.nextUrl.clone();
  home.pathname = businessHomePath(request.nextUrl.pathname);
  home.search = '';
  const response = NextResponse.redirect(home, 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
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
      '/api/platform-adapter/reconcile',
      '/api/platform-adapter/map_native_status_error',
      '/platform-adapter/v1/handshake',
      '/platform-adapter/v1/validate_binding',
      '/platform-adapter/v1/reconcile',
      '/platform-adapter/v1/map_native_status_error',
      // DD-138(5), `07` §4.8.4: authenticated by Core's Search Token.
      '/api/platform-adapter/search',
      '/platform-adapter/v1/search',
    ].includes(request.nextUrl.pathname)
  ) {
    const headers = new Headers(request.headers);
    headers.delete(KAILO_USER_HEADER);
    headers.delete(KAILO_SERVICE_HEADER);
    return NextResponse.next({ request: { headers } });
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

  const queryConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const bindingConfig = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  // The single deployment-mode source (DD-127(7)); never the request token.
  const bound = isGovernedQueryMode();
  if (
    bound &&
    (!queryConfig?.startsWith('/') || !bindingConfig?.startsWith('/'))
  )
    return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');

  let identityScope: string;
  let service: boolean;
  let user: KailoUserProfile | undefined;
  try {
    const { payload } = await jwtVerify(token, configured.keys, {
      issuer: configured.issuer,
      audience: configured.serviceAudience
        ? [configured.audience, configured.serviceAudience]
        : configured.audience,
      requiredClaims: ['iss', 'sub', 'aud', 'exp'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      return denied(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    service = Boolean(
      configured.serviceAudience &&
        audiences.includes(configured.serviceAudience),
    );
    if (
      service &&
      (audiences.includes(configured.audience) ||
        payload.azp !== configured.serviceAudience)
    ) {
      return denied(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    }
    const permitted = entitled(
      payload[configured.accessClaim],
      configured.accessValue,
    );
    if ((service || !bound) && !permitted)
      return denied(403, 'NATIVE_INSTANCE_ACCESS_DENIED');
    // DD-133 §3: the Kailo user behind a human page request (display claims
    // only). Roles come only from Core: a GOVERNED instance keeps the binding
    // permission; STANDALONE users are members until the platform member
    // directory (`07` §4.7.4) is delivered, never an IdP-derived admin.
    if (!service)
      user = await kailoUserFromClaims(
        configured.issuer,
        payload,
        bound ? null : false,
      );
    // A non-authorizing browser storage partition, derived only after signature
    // verification. This partition is not business authorization. Never expose
    // the token or raw subject.
    identityScope = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify([
              configured.issuer,
              payload.sub,
              service ? configured.serviceAudience : configured.audience,
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

  // DD-138(6), after authentication (anonymous requests stay 401): the
  // original modeling and onboarding console exists only as the declared
  // Kailo admin surfaces; an admin surface path is served only
  // with its own declared `kailo_admin_surface`. Not authorization: writes
  // keep the resolvers' Core `manage` / directory admin checks.
  if (
    nativeAdminRouteClosed(
      request.nextUrl.pathname,
      request.nextUrl.searchParams,
    )
  )
    return toBusinessHome(request);

  // Edge has no platform service credential or file access. The original
  // Node /api/config consumer owns the same-binding SERVICE transport and the
  // independently verified HUMAN fresh discover check. Its exact GET handles
  // this check itself; no other page/API/stream/Next data/asset skips it.
  const directoryLookup =
    request.method === 'GET' &&
    request.nextUrl.pathname === KAILO_DIRECTORY_ACCESS_PATH;
  if (
    bound &&
    !service &&
    !directoryLookup &&
    !(request.method === 'GET' && request.nextUrl.pathname === '/api/config')
  ) {
    try {
      const origin = nodeOrigin(configured.publicOrigin);
      if (!origin) return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
      const access = await fetch(new URL('/api/config', origin), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: request.signal,
      });
      if (!access.ok) {
        return denied(
          [401, 403, 409, 412].includes(access.status) ? access.status : 503,
          'NATIVE_INSTANCE_ACCESS_DENIED',
        );
      }
      const proof = await access.json();
      if (
        !proof ||
        typeof proof !== 'object' ||
        Array.isArray(proof) ||
        proof.nativeBindingConfigured !== true ||
        typeof proof.queryScope !== 'string' ||
        !/^[a-f0-9]{64}$/.test(proof.queryScope) ||
        !Number.isSafeInteger(proof.nativeBindingGeneration) ||
        proof.nativeBindingGeneration <= 0 ||
        access.headers.get('x-kailo-native-identity-scope') !== identityScope
      )
        return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
    } catch {
      return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
    }
  }

  // DD-133(4), `07` §4.7.4: once the Core member directory has been applied,
  // a person absent from it is refused here for every page, GraphQL and REST
  // request, and a STANDALONE role is the directory Tenant role. Edge has no
  // database: the Node consumer of this same instance answers for the user
  // this middleware verified (the lookup itself passes through here). Before
  // the first applied snapshot the answer keeps everyone a member, no admin.
  // A GOVERNED instance keeps Core `manage`/`discover` as the role authority.
  if (user && directoryConfigured() && !directoryLookup) {
    try {
      const origin = nodeOrigin(configured.publicOrigin);
      if (!origin) return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
      const access = await fetch(new URL(KAILO_DIRECTORY_ACCESS_PATH, origin), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: request.signal,
      });
      if (!access.ok) return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
      const entry = await access.json();
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        entry.userKey !== user.key ||
        typeof entry.delivered !== 'boolean' ||
        typeof entry.member !== 'boolean' ||
        typeof entry.admin !== 'boolean'
      )
        return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
      if (!entry.member) return denied(403, 'KAILO_NOT_MEMBER');
      if (!bound) user = { ...user, admin: entry.delivered && entry.admin };
    } catch {
      return denied(503, 'NATIVE_INSTANCE_UNAVAILABLE');
    }
  }

  // STANDALONE knows the directory Tenant admin here: nobody else is served
  // an admin surface page (GOVERNED admins are Core `manage` holders, known
  // only to the Node consumers, which refuse every write to the rest).
  if (
    !bound &&
    adminSurfaceRoute(request.nextUrl.pathname) &&
    user?.admin !== true
  )
    return toBusinessHome(request);

  const profile = user ? encodeKailoUser(user) : undefined;
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  headers.delete('cookie');
  headers.delete('x-kailo-native-human-token');
  headers.delete('x-kailo-native-identity-scope');
  headers.delete(KAILO_USER_HEADER);
  headers.delete(KAILO_SERVICE_HEADER);
  if (profile) headers.set(KAILO_USER_HEADER, profile);
  if (service) headers.set(KAILO_SERVICE_HEADER, '1');
  const boundSql =
    ([
      '/api/v1/run_sql',
      '/api/v1/generate_summary',
      '/api/v1/generate_vega_chart',
      '/api/v1/ask',
      '/api/v1/stream/ask',
      '/api/v1/models',
      '/api/v1/generate_sql',
      '/api/v1/stream/generate_sql',
      '/api/v1/stream_explanation',
      '/api/ask_task/streaming',
      '/api/v1/knowledge/sql_pairs',
    ].includes(request.nextUrl.pathname) ||
      /^\/api\/v1\/knowledge\/sql_pairs\/[1-9]\d*$/.test(
        request.nextUrl.pathname,
      ) ||
      (['GET', 'POST'].includes(request.method) &&
        request.nextUrl.pathname === '/api/v1/knowledge/instructions') ||
      (['PUT', 'DELETE'].includes(request.method) &&
        /^\/api\/v1\/knowledge\/instructions\/[1-9]\d*$/.test(
          request.nextUrl.pathname,
        ))) &&
    bound;
  // Only a bound instance hands the verified identity to its governed Node
  // consumers. An independent native instance (no query/binding delivery,
  // DD-127(7)) keeps the original native resolvers: forwarding the identity
  // there would select the governed path and refuse every native request.
  const governedIdentity =
    boundSql ||
    (bound &&
      [
        '/api/graphql',
        '/api/config',
        '/api/platform-query-reference',
        '/api/ask_task/streaming_answer',
      ].includes(request.nextUrl.pathname));
  if (governedIdentity) {
    headers.set('x-kailo-native-identity-scope', identityScope);
    // Private Next hop only; Core independently verifies this original signed
    // token. Never synthesize a trusted subject/issuer from browser headers.
    headers.set('x-kailo-native-human-token', token);
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Content-Security-Policy', ancestors);
  return response;
}

// Protect native pages, API/GraphQL, streams, Next data and assets alike.
export const config = { matcher: '/:path*' };

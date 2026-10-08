import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { exportJWK, generateKeyPair, JWTPayload, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware, nativeFrameAncestors } from './middleware';

describe('native instance identity boundary', () => {
  let server: Server;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let settings: Record<string, string>;
  const originalConfig = process.env.WREN_NATIVE_IDENTITY_JSON;
  const originalAncestors = process.env.KAILO_FRAME_ANCESTORS;
  const originalQueryConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    server = createServer((request, response) => {
      if (request.url === '/unavailable') {
        response.writeHead(503).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'native' }] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    settings = {
      issuer: `${origin}/issuer`,
      audience: randomUUID(),
      jwksUrl: `${origin}/jwks`,
      accessClaim: 'native_instances',
      accessValue: randomUUID(),
      publicOrigin: origin,
    };
  });

  beforeEach(() => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify(settings);
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    delete process.env.KAILO_FRAME_ANCESTORS;
  });

  afterAll(async () => {
    if (originalQueryConfig === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalQueryConfig;
    if (originalAncestors === undefined)
      delete process.env.KAILO_FRAME_ANCESTORS;
    else process.env.KAILO_FRAME_ANCESTORS = originalAncestors;
    if (originalConfig === undefined)
      delete process.env.WREN_NATIVE_IDENTITY_JSON;
    else process.env.WREN_NATIVE_IDENTITY_JSON = originalConfig;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const token = async (changes: JWTPayload = {}, omit: string[] = []) => {
    const claims: JWTPayload = {
      iss: settings.issuer,
      sub: randomUUID(),
      aud: settings.audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      [settings.accessClaim]: [settings.accessValue],
      ...changes,
    };
    for (const key of omit) delete claims[key];
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .sign(keys.privateKey);
  };

  const request = (
    path: string,
    authorization?: string,
    options: RequestInit = {},
  ) =>
    new NextRequest(`${settings.publicOrigin}${path}`, {
      ...options,
      headers: {
        ...(authorization ? { authorization } : {}),
        ...options.headers,
      },
    });

  it.each([
    '/',
    '/setup/connection',
    '/api/graphql',
    '/api/platform-query-reference',
    '/api/v1/run_sql',
    '/api/ask_task/streaming',
    '/api/ask_task/streaming_answer',
    '/_next/data/native/index.json',
    '/_next/static/native.js',
  ])('does not accept an anonymous native request to %s', async (path) => {
    const response = await middleware(request(path));
    expect(response.status).toBe(401);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it.each([
    '/api/graphql',
    '/api/platform-query-reference',
    '/api/ask_task/streaming_answer',
    '/api/v1/run_sql',
  ])(
    'verifies signed entitlement through a real JWKS endpoint and strips credentials for %s',
    async (path) => {
      const signed = await token();
      const response = await middleware(
        request(path, `Bearer ${signed}`, {
          method: 'POST',
          headers: {
            origin: settings.publicOrigin,
            cookie: 'native=synthetic',
            'x-kailo-native-human-token': 'forged',
          },
        }),
      );
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(
        response.headers.get('x-middleware-request-authorization'),
      ).toBeNull();
      expect(response.headers.get('x-middleware-request-cookie')).toBeNull();
      expect(
        response.headers.get('x-middleware-request-x-kailo-native-human-token'),
      ).toBe(signed);
      expect(response.headers.get('cache-control')).toContain('no-store');
      if (path === '/api/v1/run_sql') {
        expect(
          response.headers.get(
            'x-middleware-request-x-kailo-native-identity-scope',
          ),
        ).toMatch(/^[a-f0-9]{64}$/);
      }
    },
  );

  it('does not forward the HUMAN token to unrelated native routes', async () => {
    const response = await middleware(
      request('/', `Bearer ${await token()}`, {
        headers: { 'x-kailo-native-human-token': 'forged' },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(
      response.headers.get('x-middleware-request-x-kailo-native-human-token'),
    ).toBeNull();
  });

  it('does not forward private HUMAN credentials or caller-forged scope to independent run_sql', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const response = await middleware(
      request('/api/v1/run_sql', `Bearer ${await token()}`, {
        method: 'POST',
        headers: {
          origin: settings.publicOrigin,
          'x-kailo-native-human-token': 'forged',
          'x-kailo-native-identity-scope': 'f'.repeat(64),
        },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    for (const field of ['human-token', 'identity-scope'])
      expect(
        response.headers.get(`x-middleware-request-x-kailo-native-${field}`),
      ).toBeNull();
  });

  it('partitions browser intent only from verified subject and instance, never a supplied scope', async () => {
    const read = async (subject: string) => {
      const response = await middleware(
        request('/api/config', `Bearer ${await token({ sub: subject })}`, {
          headers: { 'x-kailo-native-identity-scope': 'f'.repeat(64) },
        }),
      );
      expect(response.status).toBe(200);
      const scope = response.headers.get(
        'x-middleware-request-x-kailo-native-identity-scope',
      );
      expect(scope).toMatch(/^[a-f0-9]{64}$/);
      expect(scope).not.toBe('f'.repeat(64));
      return scope;
    };
    const first = await read('person-one');
    expect(await read('person-one')).toBe(first);
    expect(await read('person-two')).not.toBe(first);
    expect(
      (
        await middleware(
          request('/api/config', undefined, {
            headers: { 'x-kailo-native-identity-scope': first },
          }),
        )
      ).status,
    ).toBe(401);
    const unrelated = await middleware(
      request('/', `Bearer ${await token()}`, {
        headers: { 'x-kailo-native-identity-scope': first },
      }),
    );
    expect(
      unrelated.headers.get(
        'x-middleware-request-x-kailo-native-identity-scope',
      ),
    ).toBeNull();
  });

  it('keeps the native identity guard and private propagation on an English Next route', async () => {
    const signed = await token();
    const localized = new NextRequest(
      `${settings.publicOrigin}/en/api/graphql`,
      {
        nextConfig: {
          i18n: { locales: ['zh-CN', 'en'], defaultLocale: 'zh-CN' },
        },
        headers: { authorization: `Bearer ${signed}` },
      },
    );
    expect(localized.nextUrl.locale).toBe('en');
    const response = await middleware(localized);
    expect(response.status).toBe(200);
    expect(
      response.headers.get('x-middleware-request-x-kailo-native-human-token'),
    ).toBe(signed);
  });

  it.each([
    { iss: 'other-issuer' },
    { aud: 'platform-audience' },
    { sub: '' },
    { sub: ' ' },
    { exp: 1 },
    { nbf: Number.MAX_SAFE_INTEGER },
  ])('rejects invalid signed identity claims %p', async (changes) => {
    expect(
      (await middleware(request('/', `Bearer ${await token(changes)}`))).status,
    ).toBe(401);
  });

  it.each(['iss', 'sub', 'aud', 'exp'])('requires signed %s', async (claim) => {
    expect(
      (await middleware(request('/', `Bearer ${await token({}, [claim])}`)))
        .status,
    ).toBe(401);
  });

  it.each([
    null,
    false,
    'other-instance',
    ['other-instance'],
    [{ grant: true }],
  ])(
    'does not turn authentication into instance authorization: %p',
    async (access) => {
      const bearer = await token({ [settings.accessClaim]: access });
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        403,
      );
    },
  );

  it('rejects a forged signature', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      [settings.accessClaim]: settings.accessValue,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .setIssuer(settings.issuer)
      .setSubject(randomUUID())
      .setAudience(settings.audience)
      .setExpirationTime('1m')
      .sign(other.privateKey);
    expect((await middleware(request('/', `Bearer ${forged}`))).status).toBe(
      401,
    );
  });

  it('allows only explicit embedding origins without changing native authentication or CSRF', async () => {
    expect(nativeFrameAncestors(undefined)).toBe("frame-ancestors 'self'");
    expect(nativeFrameAncestors('tauri://localhost')).toBe(
      "frame-ancestors 'self' tauri://localhost",
    );
    process.env.KAILO_FRAME_ANCESTORS = 'https://kailo.example.invalid';
    const bearer = `Bearer ${await token()}`;
    const admitted = await middleware(request('/', bearer));
    expect(admitted.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://kailo.example.invalid",
    );
    expect((await middleware(request('/'))).status).toBe(401);
    expect(
      (
        await middleware(
          request('/api/graphql', bearer, {
            method: 'POST',
            headers: { origin: 'https://kailo.example.invalid' },
          }),
        )
      ).status,
    ).toBe(403);
    process.env.KAILO_FRAME_ANCESTORS = '*';
    expect((await middleware(request('/', bearer))).status).toBe(503);
  });

  it.each([
    '*',
    'https://*.invalid',
    'https://host.invalid/path',
    'https://user@host.invalid',
    'https://host.invalid?query',
    'https://host.invalid#fragment',
    'data:text/html,test',
    'https://host.invalid;default-src *',
    'https://host.invalid:0',
    'https://host.invalid:65536',
    'tauri://localhost:',
    'tauri://',
  ])('rejects unsafe frame ancestor %s', (origin) => {
    expect(() => nativeFrameAncestors(origin)).toThrow();
  });

  it.each([undefined, 'https://untrusted.invalid', 'null'])(
    'rejects a native write with untrusted origin %p',
    async (origin) => {
      const response = await middleware(
        request('/api/graphql', `Bearer ${await token()}`, {
          method: 'POST',
          headers: origin === undefined ? {} : { origin },
        }),
      );
      expect(response.status).toBe(403);
    },
  );

  it.each([undefined, '', '{invalid', '{}', 'null'])(
    'never uses the previously cached policy for invalid config %p',
    async (value) => {
      const bearer = await token();
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        200,
      );
      if (value === undefined) delete process.env.WREN_NATIVE_IDENTITY_JSON;
      else process.env.WREN_NATIVE_IDENTITY_JSON = value;
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        503,
      );
    },
  );

  it('does not use an identity claim as the access policy', async () => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
      ...settings,
      accessClaim: 'aud',
    });
    expect(
      (await middleware(request('/', `Bearer ${await token()}`))).status,
    ).toBe(503);
  });

  it('fails closed when the configured key service is unavailable', async () => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
      ...settings,
      jwksUrl: `${settings.publicOrigin}/unavailable`,
    });
    expect(
      (await middleware(request('/', `Bearer ${await token()}`))).status,
    ).toBe(503);
  });
});

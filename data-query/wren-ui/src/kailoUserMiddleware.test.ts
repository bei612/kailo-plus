import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { createHash, randomUUID, webcrypto } from 'crypto';
import { exportJWK, generateKeyPair, JWTPayload, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import {
  decodeKailoUser,
  encodeKailoUser,
  KAILO_SERVICE_HEADER,
  KAILO_USER_HEADER,
  kailoUserFromClaims,
} from './utils/kailoUser';

// The Edge runtime provides Web Crypto as a global; Node 18 under Jest does
// not, so the same implementation is installed for these tests.
if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;

// DD-133 §3: the verified component token is the only source of the Kailo
// user (issuer+subject key, display claims). Roles never come from IdP claims.
describe('Kailo user forwarded by the native middleware', () => {
  let server: Server;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let settings: Record<string, string>;
  const original = {
    identity: process.env.WREN_NATIVE_IDENTITY_JSON,
    query: process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
    binding: process.env.WREN_PLATFORM_BINDING_CONFIG_FILE,
  };

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'native' }] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    settings = {
      issuer: `${origin}/realms/kailo`,
      audience: 'wren-browser',
      serviceAudience: 'wren-ai',
      jwksUrl: `${origin}/jwks`,
      accessClaim: 'native_instances',
      accessValue: 'wren-instance',
      publicOrigin: origin,
    };
  });

  beforeEach(() => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify(settings);
  });

  afterAll(async () => {
    for (const [name, value] of [
      ['WREN_NATIVE_IDENTITY_JSON', original.identity],
      ['WREN_PLATFORM_QUERY_CONFIG_FILE', original.query],
      ['WREN_PLATFORM_BINDING_CONFIG_FILE', original.binding],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const sign = (claims: JWTPayload) =>
    new SignJWT({
      iss: settings.issuer,
      aud: settings.audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .sign(keys.privateKey);

  const forwarded = async (token: string, headers: HeadersInit = {}) => {
    const response = await middleware(
      new NextRequest(`${settings.publicOrigin}/home`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    return {
      user: response.headers.get(`x-middleware-request-${KAILO_USER_HEADER}`),
      service: response.headers.get(
        `x-middleware-request-${KAILO_SERVICE_HEADER}`,
      ),
    };
  };

  test('a member gets the issuer+subject key and Kailo display claims, not admin', async () => {
    const sub = randomUUID();
    const { user, service } = await forwarded(
      await sign({
        sub,
        native_instances: ['wren-instance'],
        name: '王 小明',
        preferred_username: 'xiaoming',
        email: 'xm@example.test',
        email_verified: true,
        picture: 'https://kailo.example.test/avatar/xm.png',
        locale: 'zh_CN',
      }),
    );
    expect(service).toBeNull();
    expect(decodeKailoUser(user)).toEqual({
      key: createHash('sha256')
        .update(JSON.stringify([settings.issuer, sub]))
        .digest('hex'),
      name: '王 小明',
      username: 'xiaoming',
      email: 'xm@example.test',
      picture: 'https://kailo.example.test/avatar/xm.png',
      locale: 'zh-CN',
      admin: false,
      // DD-138(4): the verified pair that addresses Kailo notifications.
      issuer: settings.issuer,
      subject: sub,
    });
  });

  test('IdP groups, roles or entitlement-like values never make an admin', async () => {
    const { user } = await forwarded(
      await sign({
        sub: randomUUID(),
        native_instances: ['wren-instance', 'wren-instance#admin'],
        groups: ['/kailo/tenant-admins'],
        realm_access: { roles: ['admin'] },
        email: 'unverified@example.test',
        email_verified: false,
      }),
    );
    expect(decodeKailoUser(user)).toMatchObject({ admin: false, email: null });
  });

  test('browser-supplied user or service headers never pass through', async () => {
    const forged = encodeKailoUser({
      key: 'f'.repeat(64),
      name: 'forged',
      username: null,
      email: null,
      picture: null,
      locale: null,
      admin: true,
    });
    const { user, service } = await forwarded(
      await sign({ sub: 'member', native_instances: 'wren-instance' }),
      { [KAILO_USER_HEADER]: forged, [KAILO_SERVICE_HEADER]: '1' },
    );
    expect(user).not.toBe(forged);
    expect(decodeKailoUser(user)).toMatchObject({ admin: false, name: null });
    expect(service).toBeNull();
  });

  test('exempt machine routes also drop browser-supplied identity headers', async () => {
    const response = await middleware(
      new NextRequest(
        `${settings.publicOrigin}/api/platform-adapter/handshake`,
        { headers: { [KAILO_USER_HEADER]: 'x', [KAILO_SERVICE_HEADER]: '1' } },
      ),
    );
    expect(
      response.headers.get(`x-middleware-request-${KAILO_USER_HEADER}`),
    ).toBeNull();
    expect(
      response.headers.get(`x-middleware-request-${KAILO_SERVICE_HEADER}`),
    ).toBeNull();
  });

  test('a native service token is marked as service and carries no user', async () => {
    const { user, service } = await forwarded(
      await sign({
        sub: 'service-account',
        aud: settings.serviceAudience,
        azp: settings.serviceAudience,
        native_instances: ['wren-instance'],
      }),
    );
    expect(user).toBeNull();
    expect(service).toBe('1');
  });
});

describe('Kailo user claims', () => {
  test('unsafe display values are dropped, never stored', async () => {
    const user = await kailoUserFromClaims(
      'https://idp.example.test/realms/kailo',
      {
        sub: 'subject',
        name: 'bad\u0007name',
        email: 'x'.repeat(400),
        picture: 'javascript:alert(1)',
        locale: '../etc',
      },
      null,
    );
    expect(user).toMatchObject({
      name: null,
      email: null,
      picture: null,
      locale: null,
      admin: null,
    });
    expect(user.key).toMatch(/^[a-f0-9]{64}$/);
  });

  test('a malformed or tampered header is absent, not partial', () => {
    expect(decodeKailoUser(undefined)).toBeNull();
    expect(decodeKailoUser(['a', 'b'])).toBeNull();
    expect(decodeKailoUser('not base64!')).toBeNull();
    expect(
      decodeKailoUser(
        Buffer.from(JSON.stringify({ key: 'short', admin: true })).toString(
          'base64url',
        ),
      ),
    ).toBeNull();
    expect(
      decodeKailoUser(
        Buffer.from(
          JSON.stringify({ key: 'a'.repeat(64), admin: 'yes' }),
        ).toString('base64url'),
      ),
    ).toBeNull();
  });
});

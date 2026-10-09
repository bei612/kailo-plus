import { spawn, ChildProcess } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { createServer, request as httpRequest, Server } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { join } from 'path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

// Run against the already-built, pinned Gateway binary, never a test proxy.
// Ordinary unit runs do not claim this separate native integration acceptance.
const integration = process.env.WREN_TEST_GATEWAY_BINARY
  ? describe
  : describe.skip;

integration('native browser OIDC and original Next admission', () => {
  let provider: Server;
  let backend: Server;
  let gateway: ChildProcess;
  let directory: string;
  let issuer: string;
  let origin: string;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let granted = true;
  let wrongAudience = false;
  let observedSubject: string | undefined;
  let forwardedCookie: string | undefined;
  let tokenExchanges = 0;
  let backendRequests = 0;
  let startupError = '';
  const client = `wren-native-${randomUUID()}`;
  const clientSecret = randomUUID();
  const instance = randomUUID();
  const codes = new Map<string, URLSearchParams>();
  const originalConfig = process.env.WREN_NATIVE_IDENTITY_JSON;

  const listen = (server: Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      ),
    );

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    provider = createServer(async (request, response) => {
      const url = new URL(request.url!, issuer);
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/.well-known/openid-configuration') {
        response.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
          }),
        );
      } else if (url.pathname === '/jwks') {
        response.end(
          JSON.stringify({
            keys: [{ ...jwk, kid: 'native', use: 'sig', alg: 'RS256' }],
          }),
        );
      } else if (url.pathname === '/authorize') {
        if (
          url.searchParams.get('client_id') !== client ||
          url.searchParams.get('code_challenge_method') !== 'S256' ||
          !url.searchParams.get('nonce')
        ) {
          response.writeHead(400).end();
          return;
        }
        const code = randomUUID();
        codes.set(code, url.searchParams);
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', url.searchParams.get('state')!);
        response.writeHead(302, { Location: callback.href }).end();
      } else if (url.pathname === '/token') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const values = new URLSearchParams(body);
        const authorization = codes.get(values.get('code')!);
        codes.delete(values.get('code')!);
        const challenge = createHash('sha256')
          .update(values.get('code_verifier') || '')
          .digest('base64url');
        if (
          !authorization ||
          challenge !== authorization.get('code_challenge') ||
          values.get('redirect_uri') !== authorization.get('redirect_uri') ||
          request.headers.authorization !==
            `Basic ${Buffer.from(`${client}:${clientSecret}`).toString('base64')}`
        ) {
          response.writeHead(400).end();
          return;
        }
        tokenExchanges++;
        const token = await new SignJWT({
          native_instances: granted ? [instance] : [],
          nonce: authorization.get('nonce'),
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'native' })
          .setIssuer(issuer)
          .setSubject('native-human')
          .setAudience(wrongAudience ? 'platform-browser' : client)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey);
        response.end(
          JSON.stringify({
            token_type: 'Bearer',
            expires_in: 300,
            access_token: randomUUID(),
            id_token: token,
          }),
        );
      } else response.writeHead(404).end();
    });
    issuer = `http://127.0.0.1:${await listen(provider)}`;
    backend = createServer(async (request, response) => {
      backendRequests++;
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.set(name, value);
        }
        forwardedCookie = request.headers.cookie;
        const result = await middleware(
          new NextRequest(`${origin}${request.url}`, {
            method: request.method,
            headers,
          }),
        );
        if (result.headers.get('x-middleware-next') === '1') {
          const payload = JSON.parse(
            Buffer.from(
              request.headers.authorization!.split('.')[1],
              'base64url',
            ).toString(),
          );
          observedSubject = `${payload.iss}|${payload.sub}`;
          response
            .writeHead(200, { 'Content-Type': 'text/html' })
            .end('<main>Native Wren request admitted</main>');
        } else response.writeHead(result.status).end();
      } catch {
        response.writeHead(500).end();
      }
    });
    const backendPort = await listen(backend);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    origin = `http://127.0.0.1:${port}`;
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
      issuer,
      audience: client,
      jwksUrl: `${issuer}/jwks`,
      accessClaim: 'native_instances',
      accessValue: instance,
      publicOrigin: origin,
    });
    directory = mkdtempSync(join(tmpdir(), 'wren-native-browser-'));
    const source = readFileSync(
      join(__dirname, '../../docker/native-gateway.yaml'),
      'utf8',
    );
    // Production configuration is consumed verbatim, including port inputs.
    writeFileSync(join(directory, 'gateway.yaml'), source, { mode: 0o600 });
    gateway = spawn(
      process.env.WREN_TEST_GATEWAY_BINARY!,
      ['-f', join(directory, 'gateway.yaml')],
      {
        env: {
          ...process.env,
          WREN_OIDC_ISSUER: issuer,
          WREN_OIDC_CLIENT_ID: client,
          WREN_OIDC_CLIENT_SECRET: clientSecret,
          OIDC_COOKIE_SECRET: randomBytes(32).toString('hex'),
          WREN_OIDC_REDIRECT_URI: `${origin}/oauth/callback`,
          WREN_GATEWAY_HTTP_PORT: String(port),
          WREN_GATEWAY_ADMIN_PORT: '0',
          WREN_UI_UPSTREAM: `127.0.0.1:${backendPort}`,
          READY_FD: '3',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      },
    );
    // Same native READY_FD contract used by agentgateway's original oneshot
    // command; no guessed process-start delay or fixed polling retry count.
    gateway.stderr!.on('data', (value) => {
      startupError = (startupError + value.toString()).slice(-4000);
    });
    gateway.stdout!.on('data', (value) => {
      startupError = (startupError + value.toString()).slice(-4000);
    });
    await new Promise<void>((resolve, reject) => {
      gateway.once('exit', () =>
        reject(
          new Error(
            `Native Gateway exited before readiness: ${startupError.replaceAll(clientSecret, '[redacted]')}`,
          ),
        ),
      );
      const readiness = gateway.stdio[3] as Readable;
      readiness.once('data', () => resolve());
      readiness.once('end', () => resolve());
      readiness.resume();
    });
  }, 15000);

  afterAll(async () => {
    if (gateway && gateway.exitCode === null) {
      gateway.kill('SIGTERM');
      await new Promise<void>((resolve) =>
        gateway.once('exit', () => resolve()),
      );
    }
    for (const server of [provider, backend]) {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (directory) rmSync(directory, { recursive: true });
    if (originalConfig === undefined)
      delete process.env.WREN_NATIVE_IDENTITY_JSON;
    else process.env.WREN_NATIVE_IDENTITY_JSON = originalConfig;
  });

  const browser = () => {
    const cookies = new Map<string, string>();
    return async (path: string, options: RequestInit = {}) => {
      // Node fetch overwrites Sec-Fetch-Mode with cors. Send the real browser
      // navigation/fetch distinction without weakening Gateway's OIDC policy.
      const response = await new Promise<Response>((resolve, reject) => {
        const request = httpRequest(
          `${origin}${path}`,
          {
            method: options.method || 'GET',
            headers: {
              'sec-fetch-mode': 'navigate',
              accept: 'text/html',
              cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
              ...Object.fromEntries(new Headers(options.headers)),
            },
          },
          (incoming) => {
            const headers = new Headers();
            for (const [name, values] of Object.entries(incoming.headers)) {
              for (const value of Array.isArray(values) ? values : [values]) {
                if (value !== undefined) headers.append(name, value);
              }
            }
            const chunks: Buffer[] = [];
            incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            incoming.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: incoming.statusCode,
                  headers,
                }),
              ),
            );
            incoming.on('error', reject);
          },
        );
        request.on('error', (error) =>
          reject(
            new Error(
              `${error.message}; Gateway exit=${gateway.exitCode}; ${startupError.replaceAll(clientSecret, '[redacted]')}`,
            ),
          ),
        );
        request.end();
      });
      for (const value of (response.headers.get('set-cookie') || '').split(
        /,(?=\s*[^;,=]+=)/,
      )) {
        const pair = value.trim().split(';')[0];
        const position = pair.indexOf('=');
        if (position > 0)
          cookies.set(pair.slice(0, position), pair.slice(position + 1));
      }
      return response;
    };
  };

  const login = async (request: ReturnType<typeof browser>) => {
    const first = await request('/setup/connection');
    expect(first.status).toBe(302);
    expect(first.headers.get('set-cookie')).toContain('HttpOnly');
    const consent = await fetch(first.headers.get('location')!, {
      redirect: 'manual',
    });
    expect(consent.status).toBe(302);
    return request(
      new URL(consent.headers.get('location')!).pathname +
        new URL(consent.headers.get('location')!).search,
    );
  };

  it('completes code+PKCE, then admits cookie-only pages and fetches through original JOSE', async () => {
    const request = browser();
    const callback = await login(request);
    expect([302, 303]).toContain(callback.status);
    expect(callback.headers.get('set-cookie')).toContain('HttpOnly');
    for (const path of [
      '/setup/connection',
      '/api/graphql',
      '/_next/static/test.js',
    ]) {
      const result = await request(path, {
        headers: {
          'sec-fetch-mode': 'same-origin',
          authorization: 'Bearer attacker',
        },
      });
      expect(result.status).toBe(200);
      expect(observedSubject).toBe(`${issuer}|native-human`);
      expect(forwardedCookie).toBeUndefined();
    }
    expect(tokenExchanges).toBe(1);
    expect(
      (
        await request('/auth/logout', {
          method: 'POST',
          headers: { origin: 'https://attacker.invalid' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await request('/auth/logout', { method: 'POST', headers: { origin } }))
        .status,
    ).toBe(303);
    expect(
      (
        await request('/api/graphql', {
          headers: { 'sec-fetch-mode': 'same-origin' },
        })
      ).status,
    ).toBe(401);
  });

  it('rejects cross-site and sibling-site writes before the native backend, while retaining same-origin writes', async () => {
    const request = browser();
    expect([302, 303]).toContain((await login(request)).status);
    for (const path of ['/api/graphql', '/api/v1/run_sql']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const [site, source] of [
          ['cross-site', 'https://attacker.invalid'],
          ['same-site', 'http://sibling.localhost'],
        ]) {
          const before = backendRequests;
          expect(
            (
              await request(path, {
                method,
                headers: { 'sec-fetch-site': site, origin: source },
              })
            ).status,
          ).toBe(403);
          expect(backendRequests).toBe(before);
        }
        expect(
          (
            await request(path, {
              method,
              headers: { 'sec-fetch-site': 'same-origin', origin },
            })
          ).status,
        ).toBe(200);
      }
      // Older browsers without Fetch Metadata use the original Origin check.
      const before = backendRequests;
      expect(
        (
          await request(path, {
            method: 'POST',
            headers: { origin: 'https://attacker.invalid' },
          })
        ).status,
      ).toBe(403);
      expect(backendRequests).toBe(before);
      expect(
        (await request(path, { method: 'POST', headers: { origin } })).status,
      ).toBe(200);
      expect((await request(path)).status).toBe(200);
    }
  });

  it('a valid native session without its instance grant is denied by the real backend', async () => {
    granted = false;
    const request = browser();
    expect([302, 303]).toContain((await login(request)).status);
    expect((await request('/')).status).toBe(403);
    granted = true;
  });

  it('does not establish a native session from a platform-audience token', async () => {
    wrongAudience = true;
    const request = browser();
    const callback = await login(request);
    expect(callback.status).toBeGreaterThanOrEqual(400);
    expect(
      (
        await request('/api/graphql', {
          headers: { 'sec-fetch-mode': 'same-origin' },
        })
      ).status,
    ).toBe(401);
    wrongAudience = false;
  });
});

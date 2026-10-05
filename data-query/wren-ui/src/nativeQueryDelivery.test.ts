import { createServer, request as httpRequest } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  watch,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  authenticateQueryGateway,
  authorizeQuery,
  digest,
  loadQueryDelivery,
} from './apollo/server/services/nativeQueryAdmission';

const nativeAgent = process.env.WREN_TEST_BAO_BINARY ? describe : describe.skip;

nativeAgent(
  'original OpenBao Agent delivery into the real query admission consumer',
  () => {
    it('uses exact wrapped AppRole/versioned KV files, without sharing an auto-auth token sink', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'wren-agent-delivery-'));
      const bootstrap = join(directory, 'bootstrap');
      const output = join(directory, 'output');
      mkdirSync(bootstrap);
      mkdirSync(output);
      const role = randomUUID();
      const wrapped = randomUUID();
      const secretId = randomUUID();
      const autoAuth = randomUUID();
      const serviceSecret = randomUUID();
      const serviceToken = randomUUID();
      const binding = randomUUID();
      const tenant = randomUUID();
      const workspace = randomUUID();
      const execution = randomUUID();
      const operation = randomUUID();
      const namespace = `tenants/${tenant}`;
      const keys = await generateKeyPair('ES256');
      const jwks = JSON.stringify({
        keys: [
          {
            ...(await exportJWK(keys.publicKey)),
            alg: 'ES256',
            kid: 'fixture',
          },
        ],
      });
      const values = { action: jwks, gateway: jwks, service: serviceSecret };
      const reads = new Set<string>();
      const failures: string[] = [];
      const server = createServer(async (request, response) => {
        response.setHeader('content-type', 'application/json');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const path = new URL(request.url, 'http://fixture').pathname;
        try {
          if (path.startsWith('/v1/'))
            expect(
              String(request.headers['x-vault-namespace']).replace(/\/$/, ''),
            ).toBe(namespace);
          if (path === '/v1/sys/wrapping/lookup') {
            expect(request.headers['x-vault-token']).toBe(wrapped);
            response.end(
              JSON.stringify({
                data: { creation_path: `auth/approle/role/${role}/secret-id` },
              }),
            );
          } else if (path === '/v1/sys/wrapping/unwrap') {
            expect(request.headers['x-vault-token']).toBe(wrapped);
            response.end(JSON.stringify({ data: { secret_id: secretId } }));
          } else if (path === '/v1/auth/approle/login') {
            expect(JSON.parse(raw)).toEqual({
              role_id: role,
              secret_id: secretId,
            });
            response.end(
              JSON.stringify({
                auth: {
                  client_token: autoAuth,
                  lease_duration: 3600,
                  renewable: false,
                },
              }),
            );
          } else if (path.startsWith('/v1/sys/internal/ui/mounts/')) {
            expect(request.headers['x-vault-token']).toBe(autoAuth);
            response.end(
              JSON.stringify({
                data: {
                  path: 'secret/',
                  type: 'kv',
                  options: { version: '2' },
                },
              }),
            );
          } else if (path.startsWith('/v1/secret/data/')) {
            expect(request.headers['x-vault-token']).toBe(autoAuth);
            expect(
              new URL(request.url, 'http://fixture').searchParams.get(
                'version',
              ),
            ).toBe('7');
            const name = path.split('/').pop();
            expect(Object.keys(values)).toContain(name);
            reads.add(name);
            response.end(
              JSON.stringify({
                request_id: randomUUID(),
                data: {
                  data: { value: values[name] },
                  metadata: {
                    version: 7,
                    deletion_time: '',
                    destroyed: false,
                    created_time: new Date().toISOString(),
                  },
                },
              }),
            );
          } else if (path === '/token') {
            expect(request.headers.authorization).toBe(
              `Basic ${Buffer.from(`binding-client:${serviceSecret}`).toString('base64')}`,
            );
            response.end(
              JSON.stringify({
                token_type: 'Bearer',
                access_token: serviceToken,
              }),
            );
          } else if (path === '/service/v1/adapter/pep_check') {
            expect(request.headers.authorization).toBe(
              `Bearer ${serviceToken}`,
            );
            expect(JSON.parse(raw).bindingId).toBe(binding);
            response.end(
              JSON.stringify({
                actionExecutionId: execution,
                operationId: operation,
                authorizationMinZedToken: 'fixture-fresh',
              }),
            );
          } else response.writeHead(404).end('{}');
        } catch {
          failures.push(path);
          response.writeHead(500).end('{}');
        }
      });
      const previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      let child: ReturnType<typeof spawn>;
      try {
        await new Promise<void>((resolve) =>
          server.listen(0, '127.0.0.1', resolve),
        );
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const source =
          process.env.WREN_QUERY_DELIVERY_SOURCE ||
          join(process.cwd(), '../docker');
        const compose = readFileSync(
          join(source, 'query-governance.yaml'),
          'utf8',
        );
        const hcl = compose
          .split('    content: |\n')[1]
          .replace(/^      /gm, '')
          .replace(
            '${WREN_QUERY_APPROLE_NAME:?exact binding AppRole is required}',
            role,
          )
          .replaceAll('/run/kailo-query-bootstrap', bootstrap)
          .replaceAll('/run/kailo-query', output)
          .replaceAll('${WREN_QUERY_AGENT_UID}', String(process.getuid()))
          .replaceAll('${WREN_QUERY_AGENT_GID}', String(process.getgid()))
          .replaceAll(
            '/etc/kailo-query/templates',
            join(source, 'query-secrets'),
          );
        expect(hcl).not.toMatch(/\bsink\s+"/);
        writeFileSync(join(directory, 'agent.hcl'), hcl);
        writeFileSync(join(bootstrap, 'role-id'), role, { mode: 0o400 });
        writeFileSync(join(bootstrap, 'wrapped-secret-id'), wrapped, {
          mode: 0o400,
        });
        child = spawn(
          process.env.WREN_TEST_BAO_BINARY,
          [
            'agent',
            '-log-level=warn',
            `-config=${join(directory, 'agent.hcl')}`,
          ],
          {
            env: {
              NODE_ENV: 'test',
              PATH: process.env.PATH,
              HOME: directory,
              BAO_ADDR: origin,
              BAO_NAMESPACE: namespace,
              WREN_QUERY_ACTION_JWKS_PATH: 'secret/data/action',
              WREN_QUERY_ACTION_JWKS_VERSION: '7',
              WREN_QUERY_GATEWAY_JWKS_PATH: 'secret/data/gateway',
              WREN_QUERY_GATEWAY_JWKS_VERSION: '7',
              WREN_QUERY_SERVICE_SECRET_PATH: 'secret/data/service',
              WREN_QUERY_SERVICE_SECRET_VERSION: '7',
            },
          },
        );
        let log = '';
        child.stdout.on('data', (part) => {
          log += part;
        });
        child.stderr.on('data', (part) => {
          log += part;
        });
        let expired = false;
        await new Promise<void>((resolve, reject) => {
          const watcher = watch(output, () => ready());
          const ready = () => {
            if (
              [
                'action-jwks.json',
                'gateway-jwks.json',
                'service-secret',
                'bao.sock',
              ].every((file) => existsSync(join(output, file)))
            ) {
              clearTimeout(deadline);
              watcher.close();
              resolve();
            }
          };
          const deadline = setTimeout(() => {
            expired = true;
            watcher.close();
            child.kill('SIGTERM');
            reject(
              new Error(
                `Native Agent rendering deadline exceeded: ${[
                  wrapped,
                  secretId,
                  autoAuth,
                  serviceSecret,
                ].reduce(
                  (safe, value) => safe.replaceAll(value, '[redacted]'),
                  log,
                )}`,
              ),
            );
          }, 20000);
          child.on('error', reject);
          ready();
        });
        // Real Agent proxy injects its AppRole token in memory; Wren sends no
        // token. No cache stanza exists, so this is a fresh audit-producing read.
        const fresh: any = await new Promise((resolve, reject) => {
          const pending = httpRequest(
            {
              socketPath: join(output, 'bao.sock'),
              path: '/v1/secret/data/service?version=7',
              method: 'GET',
              headers: { 'X-Vault-Namespace': namespace },
              timeout: 5000,
            },
            (response) => {
              let text = '';
              response.on('data', (part) => {
                text += part;
              });
              response.on('end', () => {
                try {
                  expect(response.statusCode).toBe(200);
                  resolve(JSON.parse(text));
                } catch (error) {
                  reject(error);
                }
              });
            },
          );
          pending.on('timeout', () =>
            pending.destroy(new Error('Agent fixture read timeout')),
          );
          pending.on('error', reject);
          pending.end();
        });
        expect(fresh.data.data.value).toBe(serviceSecret);
        expect(fresh.request_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(statSync(join(output, 'bao.sock')).mode & 0o777).toBe(0o600);
        const exited = new Promise<number>((resolve) =>
          child.once('exit', resolve),
        );
        child.kill('SIGTERM');
        const exit = await exited;
        if (expired)
          throw new Error(
            `Native Agent did not finish rendering: ${[wrapped, secretId, autoAuth, serviceSecret].reduce((safe, value) => safe.replaceAll(value, '[redacted]'), log)}`,
          );
        expect(exit).toBe(0);
        expect(failures).toEqual([]);
        expect([...reads].sort()).toEqual(['action', 'gateway', 'service']);
        for (const value of [wrapped, secretId, autoAuth, serviceSecret])
          expect(log).not.toContain(value);
        for (const file of [
          'action-jwks.json',
          'gateway-jwks.json',
          'service-secret',
        ]) {
          expect(statSync(join(output, file)).mode & 0o777).toBe(0o400);
        }
        const config = {
          bindingId: binding,
          tenantId: tenant,
          workspaceId: workspace,
          nativeInstanceRef: 'fixture',
          nativeScopeRef: '1',
          projectId: 1,
          projectConnectionDigest: 'a'.repeat(64),
          actionTokenIssuer: `${origin}/action`,
          actionTokenAudience: 'binding-query',
          actionTokenJwksFile: join(output, 'action-jwks.json'),
          serviceTokenUrl: `${origin}/token`,
          serviceClientId: 'binding-client',
          serviceClientSecretFile: join(output, 'service-secret'),
          corePepUrl: `${origin}/service/v1/adapter/pep_check`,
          requestTimeoutMs: 5000,
          responseMaxBytes: 65536,
          requestMaxBytes: 65536,
          gatewayIssuer: `${origin}/gateway`,
          gatewayAudience: 'binding-machine',
          gatewayCallerId: 'fixture-gateway',
          gatewayJwksFile: join(output, 'gateway-jwks.json'),
          gatewayMaxTokenSeconds: 60,
          mcpAuthority: new URL(origin).host,
        };
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(
          directory,
          'query.json',
        );
        writeFileSync(
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
          JSON.stringify(config),
        );
        const actual = await loadQueryDelivery();
        const machine = await new SignJWT({ azp: config.gatewayCallerId })
          .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
          .setIssuer(config.gatewayIssuer)
          .setAudience(config.gatewayAudience)
          .setSubject(config.gatewayCallerId)
          .setJti(randomUUID())
          .setIssuedAt()
          .setExpirationTime('30s')
          .sign(keys.privateKey);
        await authenticateQueryGateway(actual, `Bearer ${machine}`);
        const input = { target: { resourceId: randomUUID() }, input: {} };
        const token = await new SignJWT({
          tenant_id: tenant,
          workspace_id: workspace,
          action_execution_id: execution,
          operation_id: operation,
          authorization_min_zed_token: 'fixture',
          normalized_parameter_hash: digest(input),
        })
          .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
          .setIssuer(config.actionTokenIssuer)
          .setAudience(config.actionTokenAudience)
          .setJti(randomUUID())
          .setIssuedAt()
          .setExpirationTime('1m')
          .sign(keys.privateKey);
        expect(
          (await authorizeQuery(actual, token, 'execute', input))
            .action_execution_id,
        ).toBe(execution);
      } finally {
        if (child && child.exitCode === null) child.kill('SIGTERM');
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (previous === undefined)
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
        rmSync(directory, { recursive: true, force: true });
      }
    }, 30000);
  },
);

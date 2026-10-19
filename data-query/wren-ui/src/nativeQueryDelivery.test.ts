import { createServer, request as httpRequest } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { execFile, spawn } from 'child_process';
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

// Production delivery bytes: deploy/components/adapter-delivery.py config
// --kind data-query and reader (apps root = WREN_QUERY_DELIVERY_SOURCE), the
// real OpenBao Agent on the reader's HCL, then the real consumers. The two
// platform public JWKS files stand for the platform namespace Agent output
// (start-core.sh --prepare-action-token, Gateway service delivery) that the
// overlay mounts read-only; the component Agent never reads them.
const python = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      process.env.WREN_TEST_PYTHON || 'python3',
      ['-I', ...args],
      { env: { PATH: process.env.PATH } },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr));
        else resolve(stdout);
      },
    );
  });

nativeAgent(
  'original OpenBao Agent deliveries into the real query admission consumer',
  () => {
    it('renders binding SecretRefs only in the Tenant namespace and consumes the platform public JWKS files', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'wren-agent-delivery-'));
      const bootstrap = join(directory, 'bootstrap');
      const output = join(directory, 'output');
      const platform = join(directory, 'platform');
      for (const path of [bootstrap, output, platform])
        mkdirSync(path, { mode: 0o700 });
      const role = 'wren-binding-reader';
      const admin = `/v1/auth/approle/role/${role}`;
      const policyPath = `/v1/sys/policies/acl/${role}`;
      const roleId = randomUUID();
      const rootToken = randomUUID();
      const wrapped = randomUUID();
      const secretId = randomUUID();
      const autoAuth = randomUUID();
      const serviceSecret = randomUUID();
      const connectionSecret = JSON.stringify({
        host: 'fixture',
        port: 5432,
        database: 'fixture',
        user: 'reader',
        password: randomUUID(),
        ssl: false,
      });
      const serviceToken = randomUUID();
      const binding = randomUUID();
      const tenant = randomUUID();
      const workspace = randomUUID();
      const execution = randomUUID();
      const operation = randomUUID();
      const namespace = `tenants/${tenant}`;
      const kv = `kv/data/application-binding/${binding}`;
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
      const values = {
        connection: connectionSecret,
        oidc_client_secret: serviceSecret,
      };
      const stored = new Map<string, unknown>();
      const reads = new Set<string>();
      const failures: string[] = [];
      const server = createServer(async (request, response) => {
        response.setHeader('content-type', 'application/json');
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const url = new URL(request.url, 'http://fixture');
        const path = url.pathname;
        const reply = (status: number, body?: unknown) => {
          response.writeHead(status);
          response.end(body === undefined ? '' : JSON.stringify(body));
        };
        try {
          if (path.startsWith('/v1/'))
            expect(
              String(request.headers['x-vault-namespace']).replace(/\/$/, ''),
            ).toBe(namespace);
          if (request.headers['x-vault-token'] === rootToken) {
            // adapter-delivery.py reader: Tenant mount/auth read-back, exact
            // policy and AppRole, response-wrapped one-use SecretID.
            if (path === '/v1/sys/mounts')
              reply(200, {
                data: { 'kv/': { type: 'kv', options: { version: '2' } } },
              });
            else if (path === '/v1/sys/auth')
              reply(200, { data: { 'approle/': { type: 'approle' } } });
            else if (path === policyPath || path === admin) {
              if (request.method === 'GET') {
                if (stored.has(path)) reply(200, { data: stored.get(path) });
                else reply(404, { errors: [] });
              } else {
                stored.set(path, JSON.parse(raw));
                reply(204);
              }
            } else if (path === `${admin}/role-id`)
              reply(200, { data: { role_id: roleId } });
            else if (path === `${admin}/secret-id`) {
              expect(request.headers['x-vault-wrap-ttl']).toBeTruthy();
              reply(200, { wrap_info: { token: wrapped } });
            } else reply(404, { errors: [] });
          } else if (path === '/v1/sys/wrapping/lookup') {
            expect(request.headers['x-vault-token']).toBe(wrapped);
            reply(200, {
              data: { creation_path: `auth/approle/role/${role}/secret-id` },
            });
          } else if (path === '/v1/sys/wrapping/unwrap') {
            expect(request.headers['x-vault-token']).toBe(wrapped);
            reply(200, { data: { secret_id: secretId } });
          } else if (path === '/v1/auth/approle/login') {
            expect(JSON.parse(raw)).toEqual({
              role_id: roleId,
              secret_id: secretId,
            });
            reply(200, {
              auth: {
                client_token: autoAuth,
                lease_duration: 3600,
                renewable: false,
              },
            });
          } else if (path.startsWith('/v1/sys/internal/ui/mounts/')) {
            expect(request.headers['x-vault-token']).toBe(autoAuth);
            reply(200, {
              data: { path: 'kv/', type: 'kv', options: { version: '2' } },
            });
          } else if (path.startsWith(`/v1/${kv}/`)) {
            expect(request.headers['x-vault-token']).toBe(autoAuth);
            expect(url.searchParams.get('version')).toBe('1');
            const name = path.split('/').pop();
            expect(Object.keys(values)).toContain(name);
            reads.add(name);
            reply(200, {
              request_id: randomUUID(),
              data: {
                data: { value: values[name] },
                metadata: {
                  version: 1,
                  deletion_time: '',
                  destroyed: false,
                  created_time: new Date().toISOString(),
                },
              },
            });
          } else if (path === '/protocol/openid-connect/token') {
            expect(request.headers.authorization).toBe(
              `Basic ${Buffer.from(`binding-client:${serviceSecret}`).toString('base64')}`,
            );
            reply(200, { token_type: 'Bearer', access_token: serviceToken });
          } else if (path === '/service/v1/adapter/pep_check') {
            expect(request.headers.authorization).toBe(
              `Bearer ${serviceToken}`,
            );
            expect(JSON.parse(raw).bindingId).toBe(binding);
            reply(200, {
              actionExecutionId: execution,
              operationId: operation,
              authorizationMinZedToken: 'fixture-fresh',
            });
          } else reply(404, {});
        } catch {
          failures.push(path);
          reply(500, {});
        }
      });
      const previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      let child: ReturnType<typeof spawn>;
      try {
        await new Promise<void>((resolve) =>
          server.listen(0, '127.0.0.1', resolve),
        );
        const port = (server.address() as AddressInfo).port;
        const origin = `http://127.0.0.1:${port}`;
        const source =
          process.env.WREN_QUERY_DELIVERY_SOURCE ||
          join(process.cwd(), '../..');
        const tool = join(source, 'deploy/components/adapter-delivery.py');
        const actionJwks = join(platform, 'action-jwks.json');
        const gatewayJwks = join(platform, 'gateway-jwks.json');
        for (const file of [actionJwks, gatewayJwks])
          writeFileSync(file, jwks, { mode: 0o444 });
        const normalizedConfig = { client_id: 'binding-client' };
        const actions = [
          'data_query.query@v2',
          'data_query.dry_run@v2',
          'data_query.describe@v2',
        ];
        const plan = {
          tenantId: tenant,
          workspaceId: workspace,
          componentReleaseId: randomUUID(),
          componentTypeKey: 'wren',
          artifactDigest: 'b'.repeat(64),
          bindingId: binding,
          bindingVersion: 1,
          servicePrincipalId: randomUUID(),
          adapterServiceRef: 'data-query-ui',
          nativeInstanceRef: 'fixture',
          nativeScopeRef: '1',
          isolationMode: 'DEDICATED_INSTANCE',
          normalizedConfig,
          configDigest: digest(normalizedConfig),
          clientId: 'binding-client',
          secretRefs: Object.keys(values).map((secretKey) => ({
            secretKey,
            locator: `${namespace}/kv/application-binding/${binding}/${secretKey}`,
            version: 1,
            audience: 'kailo-adapter-data-query',
          })),
          actionVersions: actions.map((actionKey) => ({
            actionKey,
            actionVersion: 1,
          })),
        };
        const planFile = join(directory, 'plan.json');
        const signingFile = join(directory, 'signing.json');
        const envFile = join(directory, 'platform.env');
        const rootFile = join(directory, 'openbao-init.json');
        const platformEnv = [
          'BFF_SERVICE_NAME=127.0.0.1',
          `SERVICE_CONTAINER_PORT=${port}`,
          `OIDC_ISSUER=${origin}`,
          `GATEWAY_SERVICE_ISSUER=${origin}/gateway`,
          'GATEWAY_SERVICE_CALLER_ID=fixture-gateway',
          `GATEWAY_SERVICE_JWKS_FILE=${gatewayJwks}`,
          'GATEWAY_SERVICE_MAX_TOKEN_SECONDS=60',
          '',
        ];
        writeFileSync(planFile, JSON.stringify(plan));
        writeFileSync(
          signingFile,
          JSON.stringify({ issuer: `${origin}/action`, jwksFile: actionJwks }),
        );
        writeFileSync(envFile, platformEnv.join('\n'));
        writeFileSync(rootFile, JSON.stringify({ root_token: rootToken }), {
          mode: 0o600,
        });
        await python([
          tool,
          'config',
          '--kind',
          'data-query',
          '--plan',
          planFile,
          '--template',
          join(source, 'deploy/components/data-query-adapter.template.json'),
          '--delivery-dir',
          output,
          '--env-file',
          envFile,
          '--action-token-signing-file',
          signingFile,
          '--set',
          `projectConnectionDigest=${'a'.repeat(64)}`,
          '--set',
          `mcpAuthority=${new URL(origin).host}`,
          '--set',
          'gatewayAudience=binding-machine',
          '--out',
          join(output, 'adapter.json'),
        ]);
        await python([
          tool,
          'reader',
          '--config',
          join(output, 'adapter.json'),
          '--role',
          role,
          '--bootstrap-dir',
          bootstrap,
          '--bao-url',
          origin,
          '--agent-bao-url',
          origin,
          '--root-token-file',
          rootFile,
        ]);
        let readable = '';
        for (const name of Object.keys(values))
          readable += `path "${kv}/${name}" { capabilities = ["read"] }\n`;
        expect(stored.get(policyPath)).toEqual({ policy: readable });
        const hcl = readFileSync(join(bootstrap, 'adapter-agent.hcl'), 'utf8');
        const namespaces = hcl.match(/namespace = "[^"]*"/g);
        expect(namespaces).toEqual([`namespace = "${namespace}"`]);
        expect(hcl).not.toMatch(/\bsink\s+"/);
        expect(hcl).not.toMatch(/^\s*cache\s*\{/m);
        child = spawn(
          process.env.WREN_TEST_BAO_BINARY,
          [
            'agent',
            '-log-level=warn',
            `-config=${join(bootstrap, 'adapter-agent.hcl')}`,
          ],
          {
            env: {
              NODE_ENV: 'test',
              PATH: process.env.PATH,
              HOME: directory,
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
        const secrets = [
          wrapped,
          secretId,
          autoAuth,
          rootToken,
          serviceSecret,
          connectionSecret,
        ];
        const redacted = () => {
          let safe = log;
          for (const value of secrets)
            safe = safe.replaceAll(value, '[redacted]');
          return safe;
        };
        const rendered = ['connection', 'oidc_client_secret', 'bao.sock'];
        let expired = false;
        await new Promise<void>((resolve, reject) => {
          const watcher = watch(output, () => ready());
          const ready = () => {
            if (rendered.every((file) => existsSync(join(output, file)))) {
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
                `Native Agent rendering deadline exceeded: ${redacted()}`,
              ),
            );
          }, 20000);
          child.on('error', reject);
          ready();
        });
        const delivery = JSON.parse(
          readFileSync(join(output, 'binding.json'), 'utf8'),
        );
        expect(delivery.secretSocket).toBe(join(output, 'bao.sock'));
        expect(delivery.secretNamespace).toBe(namespace);
        expect(delivery.serviceSecretPath).toBe(`${kv}/oidc_client_secret`);
        expect(delivery.connectionSecretPath).toBe(`${kv}/connection`);
        expect(delivery.binding.secretRefs).toEqual(plan.secretRefs);
        // Real Agent proxy injects its AppRole token in memory; Wren sends no
        // token. No cache stanza exists, so this is a fresh audit-producing read.
        const fresh: any = await new Promise((resolve, reject) => {
          const pending = httpRequest(
            {
              socketPath: delivery.secretSocket,
              path: `/v1/${delivery.serviceSecretPath}?version=1`,
              method: 'GET',
              headers: { 'X-Vault-Namespace': delivery.secretNamespace },
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
            `Native Agent did not finish rendering: ${redacted()}`,
          );
        expect(exit).toBe(0);
        expect(failures).toEqual([]);
        expect([...reads].sort()).toEqual(['connection', 'oidc_client_secret']);
        for (const value of secrets) expect(log).not.toContain(value);
        for (const file of ['connection', 'oidc_client_secret']) {
          expect(statSync(join(output, file)).mode & 0o777).toBe(0o600);
        }
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(
          output,
          'query.json',
        );
        const actual = await loadQueryDelivery();
        expect(actual.serviceClientSecretFile).toBe(
          join(output, 'oidc_client_secret'),
        );
        expect(actual.actionTokenJwksFile).toBe(actionJwks);
        expect(actual.gatewayJwksFile).toBe(gatewayJwks);
        const machine = await new SignJWT({ azp: actual.gatewayCallerId })
          .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
          .setIssuer(actual.gatewayIssuer)
          .setAudience(actual.gatewayAudience)
          .setSubject(actual.gatewayCallerId)
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
          .setIssuer(actual.actionTokenIssuer)
          .setAudience(actual.actionTokenAudience)
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

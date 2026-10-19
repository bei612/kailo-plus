import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  authenticateQueryGateway,
  authorizeQuery,
  loadQueryDelivery,
  NativeQueryDelivery,
} from './apollo/server/services/nativeQueryAdmission';

// ADR-12 §7 and Core application_binding_gateway.rs -> adapter_backend_auth:
// AgentGateway's native jwtSign signs the MCP transport for the binding's
// exact adapter (ServicePrincipal) audience, i.e. the release
// actionTokenAudience, with the independent GATEWAY_SERVICE_* issuer/key,
// sub/azp = caller, a ten-second backdated iat and no jti
// (agentgateway jwt_sign.rs). Transport and ActionToken stay apart by issuer,
// key and header, not by a second audience.
describe('Gateway MCP transport identity of the governed native UI', () => {
  let directory: string;
  let previous: string | undefined;
  let delivery: Record<string, unknown>;
  let gatewayKeys: Awaited<ReturnType<typeof generateKeyPair>>;
  let actionKeys: Awaited<ReturnType<typeof generateKeyPair>>;

  const write = (value: unknown) =>
    writeFileSync(
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
      JSON.stringify(value),
    );

  const transport = async (
    config: NativeQueryDelivery,
    changed: Record<string, unknown> = {},
  ) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: config.gatewayIssuer,
      aud: config.gatewayAudience,
      sub: config.gatewayCallerId,
      azp: config.gatewayCallerId,
      iat: now - 10,
      exp: now + 60,
      ...changed,
    };
    const token = new SignJWT(claims);
    token.setProtectedHeader({ alg: 'ES256', kid: 'gateway-v1', typ: 'JWT' });
    return token.sign(gatewayKeys.privateKey);
  };

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wren-gateway-transport-'));
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = join(directory, 'query.json');
    gatewayKeys = await generateKeyPair('ES256');
    actionKeys = await generateKeyPair('ES256');
    const published = [
      ['gateway-jwks.json', gatewayKeys, 'gateway-v1'],
      ['action-jwks.json', actionKeys, '1'],
    ] as const;
    for (const [name, keys, kid] of published) {
      const key = { ...(await exportJWK(keys.publicKey)), alg: 'ES256', kid };
      writeFileSync(join(directory, name), JSON.stringify({ keys: [key] }));
    }
    delivery = {
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: 'fixture',
      nativeScopeRef: '1',
      projectId: 1,
      projectConnectionDigest: 'a'.repeat(64),
      actionTokenIssuer: 'http://core-bff:8082/action-token',
      actionTokenAudience: 'kailo-adapter-data-query',
      actionTokenJwksFile: join(directory, 'action-jwks.json'),
      serviceTokenUrl: 'http://keycloak:8080/realms/kailo/token',
      serviceClientId: 'data-query-adapter-fixture',
      serviceClientSecretFile: join(directory, 'client-secret'),
      corePepUrl: 'http://core-bff:8082/service/v1/adapter/pep_check',
      gatewayIssuer: 'urn:kailo:agentgateway:service',
      gatewayAudience: 'kailo-adapter-data-query',
      gatewayCallerId: 'kailo-agentgateway-service',
      gatewayJwksFile: join(directory, 'gateway-jwks.json'),
      gatewayMaxTokenSeconds: 70,
      mcpAuthority: 'wren-ui:3000',
      requestTimeoutMs: 5000,
      responseMaxBytes: 65536,
      requestMaxBytes: 65536,
    };
  });

  afterAll(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  it('accepts the native jwtSign transport for the exact adapter audience', async () => {
    write(delivery);
    const config = await loadQueryDelivery();
    const gateway = await transport(config);
    const accepted = authenticateQueryGateway(config, `Bearer ${gateway}`);
    await expect(accepted).resolves.toBeUndefined();
  });

  it('refuses a second audience or a transport sharing the ActionToken issuer or key', async () => {
    for (const changed of [
      { gatewayAudience: 'wren-mcp-transport' },
      { gatewayIssuer: delivery.actionTokenIssuer },
      { gatewayJwksFile: delivery.actionTokenJwksFile },
    ]) {
      write({ ...delivery, ...changed });
      await expect(loadQueryDelivery()).rejects.toThrow(
        'QUERY_ADMISSION_UNAVAILABLE',
      );
    }
  });

  it('keeps the transport and the ActionToken mutually non-substitutable', async () => {
    write(delivery);
    const config = await loadQueryDelivery();
    const gateway = await transport(config);
    // A Gateway transport is never an ActionToken: wrong issuer and key.
    const misused = authorizeQuery(config, gateway, 'execute', {});
    await expect(misused).rejects.toThrow();
    // An ActionToken-shaped token for the same audience is not a transport.
    const action = await new SignJWT({
      azp: config.gatewayCallerId,
      jti: randomUUID(),
    })
      .setProtectedHeader({ alg: 'ES256', kid: '1' })
      .setIssuer(config.actionTokenIssuer)
      .setAudience(config.actionTokenAudience)
      .setSubject(config.gatewayCallerId)
      .setIssuedAt()
      .setExpirationTime('1m')
      .sign(actionKeys.privateKey);
    const substituted = authenticateQueryGateway(config, `Bearer ${action}`);
    await expect(substituted).rejects.toThrow();
    for (const changed of [
      { sub: 'another-caller' },
      { azp: 'another-caller' },
      { exp: Math.floor(Date.now() / 1000) + 600 },
    ]) {
      const token = await transport(config, changed);
      const refused = authenticateQueryGateway(config, `Bearer ${token}`);
      await expect(refused).rejects.toThrow('QUERY_GATEWAY_IDENTITY_REQUIRED');
    }
  });
});

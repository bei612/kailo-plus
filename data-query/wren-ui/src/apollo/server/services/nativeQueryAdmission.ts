import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { createLocalJWKSet, jwtVerify, JWTPayload } from 'jose';

export type NativeQueryDelivery = {
  bindingId: string;
  tenantId: string;
  workspaceId: string;
  nativeInstanceRef: string;
  nativeScopeRef: string;
  projectId: number;
  projectConnectionDigest: string;
  actionTokenIssuer: string;
  actionTokenAudience: string;
  actionTokenJwksFile: string;
  serviceTokenUrl: string;
  serviceClientId: string;
  serviceClientSecretFile: string;
  corePepUrl: string;
  gatewayIssuer: string;
  gatewayAudience: string;
  gatewayCallerId: string;
  gatewayJwksFile: string;
  gatewayMaxTokenSeconds: number;
  mcpAuthority: string;
  requestTimeoutMs: number;
  responseMaxBytes: number;
  requestMaxBytes: number;
  humanAction?: {
    resultExposurePolicyId: string;
    resultExposurePolicyVersion: number;
  };
};

export class NativeQueryRefusal extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export async function loadQueryDelivery(): Promise<NativeQueryDelivery> {
  const path = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  if (!path?.startsWith('/'))
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  const value = JSON.parse(await readFile(path, 'utf8'));
  const strings = [
    'bindingId',
    'tenantId',
    'workspaceId',
    'nativeInstanceRef',
    'nativeScopeRef',
    'projectConnectionDigest',
    'actionTokenIssuer',
    'actionTokenAudience',
    'actionTokenJwksFile',
    'serviceTokenUrl',
    'serviceClientId',
    'serviceClientSecretFile',
    'corePepUrl',
    'gatewayIssuer',
    'gatewayAudience',
    'gatewayCallerId',
    'gatewayJwksFile',
    'mcpAuthority',
  ];
  const numbers = [
    'projectId',
    'requestTimeoutMs',
    'responseMaxBytes',
    'requestMaxBytes',
    'gatewayMaxTokenSeconds',
  ];
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => ![...strings, ...numbers, 'humanAction'].includes(key),
    ) ||
    strings.some(
      (key) =>
        typeof value[key] !== 'string' ||
        !value[key] ||
        value[key].trim() !== value[key],
    ) ||
    numbers.some(
      (key) => !Number.isSafeInteger(value[key]) || value[key] <= 0,
    ) ||
    !value.actionTokenJwksFile.startsWith('/') ||
    !value.serviceClientSecretFile.startsWith('/') ||
    !value.gatewayJwksFile.startsWith('/') ||
    value.gatewayAudience === value.actionTokenAudience ||
    value.nativeScopeRef !== String(value.projectId) ||
    !/^[a-f0-9]{64}$/.test(value.projectConnectionDigest) ||
    new URL(`http://${value.mcpAuthority}`).host !== value.mcpAuthority
  ) {
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }
  if (value.humanAction !== undefined) {
    const human = value.humanAction;
    if (
      !human ||
      Object.keys(human).sort().join(',') !==
        'resultExposurePolicyId,resultExposurePolicyVersion' ||
      !['resultExposurePolicyId'].every(
        (key) =>
          typeof human[key] === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            human[key],
          ),
      ) ||
      !['resultExposurePolicyVersion'].every(
        (key) => Number.isSafeInteger(human[key]) && human[key] > 0,
      )
    ) {
      throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
    }
  }
  for (const key of [
    'serviceTokenUrl',
    'corePepUrl',
    'actionTokenIssuer',
    'gatewayIssuer',
  ]) {
    const url = new URL(value[key]);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
    }
  }
  if (new URL(value.corePepUrl).pathname !== '/service/v1/adapter/pep_check') {
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }
  return value;
}

export async function authenticateQueryGateway(
  config: NativeQueryDelivery,
  authorization: string | undefined,
) {
  const token = authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1];
  if (!token)
    throw new NativeQueryRefusal(401, 'QUERY_GATEWAY_IDENTITY_REQUIRED');
  const document = JSON.parse(await readFile(config.gatewayJwksFile, 'utf8'));
  if (
    !Array.isArray(document.keys) ||
    document.keys.some((key) => key.d !== undefined)
  ) {
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }
  const { payload } = await jwtVerify(token, createLocalJWKSet(document), {
    issuer: config.gatewayIssuer,
    audience: config.gatewayAudience,
    algorithms: ['ES256'],
    requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'jti'],
  });
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.sub !== config.gatewayCallerId ||
    payload.azp !== config.gatewayCallerId ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.iat > now ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > config.gatewayMaxTokenSeconds
  ) {
    throw new NativeQueryRefusal(401, 'QUERY_GATEWAY_IDENTITY_REQUIRED');
  }
}

async function jsonResponse(
  config: NativeQueryDelivery,
  url: string,
  init: RequestInit,
  allowMissing = false,
) {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (allowMissing && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) {
    throw new NativeQueryRefusal(
      response.status === 403 ? 403 : 503,
      'QUERY_ADMISSION_UNAVAILABLE',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > config.responseMaxBytes)
        throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function authorizeQuery(
  config: NativeQueryDelivery,
  token: string,
  operation: 'execute' | 'observe' | 'handshake' | 'validate_binding',
  argumentsValue: unknown,
): Promise<JWTPayload> {
  const keyDocument = JSON.parse(
    await readFile(config.actionTokenJwksFile, 'utf8'),
  );
  if (
    !Array.isArray(keyDocument.keys) ||
    keyDocument.keys.some((key) => key.d !== undefined)
  ) {
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }
  const keys = createLocalJWKSet(keyDocument);
  const options = {
    issuer: config.actionTokenIssuer,
    audience: config.actionTokenAudience,
    algorithms: ['ES256'],
    requiredClaims: ['iss', 'aud', 'iat', 'exp', 'jti'],
  };
  const { payload } = await jwtVerify(token, keys, options);
  const hash = digest(
    operation === 'execute'
      ? argumentsValue
      : { operation, arguments: argumentsValue },
  );
  if (
    payload.tenant_id !== config.tenantId ||
    payload.workspace_id !== config.workspaceId ||
    payload.normalized_parameter_hash !== hash ||
    typeof payload.action_execution_id !== 'string' ||
    typeof payload.operation_id !== 'string' ||
    typeof payload.authorization_min_zed_token !== 'string' ||
    !payload.authorization_min_zed_token
  ) {
    throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
  }
  const admitted = await bindingServiceCall(config, 'pep_check', {
    bindingId: config.bindingId,
    actionToken: token,
    operation,
    argumentsJson: canonical(argumentsValue),
  });
  if (
    admitted.actionExecutionId !== payload.action_execution_id ||
    admitted.operationId !== payload.operation_id ||
    typeof admitted.authorizationMinZedToken !== 'string' ||
    !admitted.authorizationMinZedToken
  ) {
    throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
  }
  await jwtVerify(token, keys, options);
  // Native target facts come from the current Core PEP, never a caller JWT
  // extension. Missing facts remain missing and native consumers fail closed.
  return { ...payload, targetResource: admitted.targetResource };
}

export async function bindingServiceCall(
  config: NativeQueryDelivery,
  operation: 'pep_check' | 'human-action',
  body: Record<string, unknown>,
  humanToken?: string,
) {
  // Use the already-defined binding service client, not a platform browser or
  // administrative credential. The secret and both tokens stay in memory.
  const secret = await readFile(config.serviceClientSecretFile, 'utf8');
  if (!secret || secret.trim() !== secret)
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  const service = await jsonResponse(config, config.serviceTokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.serviceClientId)}:${encodeURIComponent(secret)}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (
    service.token_type !== 'Bearer' ||
    typeof service.access_token !== 'string' ||
    !service.access_token
  ) {
    throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
  }
  const url = new URL(config.corePepUrl);
  url.pathname = `/service/v1/adapter/${operation}`;
  if (operation === 'human-action' && !humanToken) {
    throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
  }
  return jsonResponse(
    config,
    url.toString(),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${service.access_token}`,
        'content-type': 'application/json',
        ...(humanToken ? { 'x-kailo-native-human-token': humanToken } : {}),
      },
      body: JSON.stringify(body),
    },
    operation === 'human-action' &&
      body.idempotencyKey !== undefined &&
      body.command === undefined,
  );
}

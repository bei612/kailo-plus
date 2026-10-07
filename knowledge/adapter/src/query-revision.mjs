import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Refused, object, nonempty, exactKeys, canonical, fixedUrl, boundedBody,
  verifiedClaims, secret, freshPep } from '../../../client-kit/adapter/protocol.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUERY_PATH = '/platform-adapter/v1/query_revision';

export function configuration(value) {
  const required = ['bindingId', 'tenantId', 'nativeKnowledgeBaseId', 'nativeMcpUrl',
    'nativeMcpBearerFile', 'actionTokenIssuer', 'actionTokenAudience', 'actionTokenJwksFile',
    'corePepUrl', 'oidcTokenUrl', 'oidcClientId', 'oidcClientSecretFile',
    'timeoutMs', 'maxBodyBytes', 'listenHost', 'listenPort'];
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, 'workspaceId'].includes(key))) throw new Refused(503);
  for (const key of ['bindingId', 'tenantId', 'nativeKnowledgeBaseId']) {
    if (!UUID.test(value[key])) throw new Refused(503);
  }
  if (value.workspaceId !== undefined && !UUID.test(value.workspaceId)) throw new Refused(503);
  for (const key of required.filter(key => !['timeoutMs', 'maxBodyBytes', 'listenPort'].includes(key))) {
    if (!nonempty(value[key])) throw new Refused(503);
  }
  for (const key of ['timeoutMs', 'maxBodyBytes', 'listenPort']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) throw new Refused(503);
  }
  if (value.listenPort > 65535) throw new Refused(503);
  for (const key of ['nativeMcpUrl', 'corePepUrl', 'oidcTokenUrl', 'actionTokenIssuer']) fixedUrl(value[key]);
  if (fixedUrl(value.corePepUrl).pathname !== '/service/v1/adapter/pep_check') throw new Refused(503);
  for (const key of ['nativeMcpBearerFile', 'actionTokenJwksFile', 'oidcClientSecretFile']) {
    if (!value[key].startsWith('/')) throw new Refused(503);
  }
  return Object.freeze({ ...value });
}

export async function verifyKnowledgeToken(token, config, args, operation = 'query_revision') {
  const claims = await verifiedClaims(token, config);
  for (const key of ['jti', 'tenant_id', 'actor_principal_id', 'initiating_human_principal_id',
    'operation_id', 'action_execution_id', 'target_id', 'result_exposure_policy_id']) {
    if (!UUID.test(claims[key])) throw new Refused(401);
  }
  if (claims.tenant_id !== config.tenantId
    || (config.workspaceId !== undefined && claims.workspace_id !== config.workspaceId)
    || (claims.workspace_id !== undefined && !UUID.test(claims.workspace_id))
    || claims.target_type !== 'RESOURCE'
    || !['knowledge.search@v1', 'knowledge.read@v1', 'knowledge.export@v1',
      'knowledge.ingest@v1', 'knowledge.delete@v1'].includes(claims.action_key)
    || !Number.isSafeInteger(claims.action_definition_version) || claims.action_definition_version <= 0
    || !Number.isSafeInteger(claims.result_exposure_policy_version) || claims.result_exposure_policy_version <= 0
    || !nonempty(claims.authorization_min_zed_token)
    || claims.normalized_parameter_hash !== createHash('sha256')
      .update(canonical(operation === 'execute' ? args : { operation, arguments: args })).digest('hex')) throw new Refused(401);
  if (Object.hasOwn(claims, 'agent_principal_id')) {
    if (!UUID.test(claims.agent_principal_id) || claims.actor_principal_id !== claims.agent_principal_id
      || !UUID.test(claims.delegation_id) || !Number.isSafeInteger(claims.delegation_version)
      || claims.delegation_version <= 0) throw new Refused(401);
  } else if (claims.actor_principal_id !== claims.initiating_human_principal_id
    || Object.hasOwn(claims, 'delegation_id') || Object.hasOwn(claims, 'delegation_version')) throw new Refused(401);
  return claims;
}

// A client of the original stateless MCP endpoint, not another MCP server.
// Each call uses the configured SecretRef delivery and original tool allowlist.
export async function nativeTool(config, deadline, name, args) {
  const bearer = await secret(config.nativeMcpBearerFile);
  const client = new Client({ name: 'kailo-knowledge-adapter', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(config.nativeMcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    fetch: async (url, options) => {
      const remaining = deadline - Date.now();
      if (String(url) !== config.nativeMcpUrl || remaining <= 0) throw new Refused(503);
      const response = await fetch(url, { ...options, redirect: 'manual',
        signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining) });
      if (!response.body) return response;
      let received = 0;
      const bounded = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > config.maxBodyBytes) throw new Refused(503);
          controller.enqueue(chunk);
        },
      }));
      return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
  try {
    const options = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Refused(503);
      return { timeout: remaining, maxTotalTimeout: remaining };
    };
    await client.connect(transport, options());
    const result = await client.callTool({ name, arguments: args }, undefined, options());
    if ((result.isError !== undefined && result.isError !== false) || !object(result.structuredContent)) throw new Refused(503);
    return result.structuredContent;
  } catch {
    throw new Refused(503);
  } finally {
    await client.close().catch(() => {});
  }
}

async function nativeRevision(config, deadline, args) {
  if (args.authorizationTargetNativeRef !== config.nativeKnowledgeBaseId) throw new Refused(403);
  let revision;
  if (args.nativeObjectRef === config.nativeKnowledgeBaseId) {
    const result = await nativeTool(config, deadline, 'list_knowledge_bases', {});
    if (!Array.isArray(result.knowledge_bases)) throw new Refused(503);
    const matches = result.knowledge_bases.filter(item => item?.id === config.nativeKnowledgeBaseId);
    if (matches.length !== 1) throw new Refused(403);
    revision = matches[0].native_revision;
  } else {
    const result = await nativeTool(config, deadline, 'read_document', {
      knowledge_id: args.nativeObjectRef, metadata_only: true,
    });
    if (result.document?.id !== args.nativeObjectRef
      || result.knowledge_base?.id !== config.nativeKnowledgeBaseId) throw new Refused(403);
    revision = result.document.native_revision;
  }
  if (!nonempty(revision) || !Number.isFinite(Date.parse(revision))
    || revision.startsWith('0001-')) throw new Refused(503);
  return { nativeObjectRef: args.nativeObjectRef, nativeRevision: revision };
}

function referenceInput(args, claims) {
  if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, ['resourceId'])
    || args.target.resourceId !== claims.target_id || !object(args.input)
    || !exactKeys(args.input, ['resourceId', 'nativeObjectRef', 'nativeRevision', 'displayName', 'mediaType'])
    || args.input.resourceId !== claims.target_id || !UUID.test(args.input.nativeObjectRef)
    || !['nativeRevision', 'displayName', 'mediaType'].every(key => nonempty(args.input[key]))) throw new Refused(400);
  return args.input;
}

async function originalDocument(config, deadline, reference) {
  const result = await nativeTool(config, deadline, 'read_document', {
    knowledge_id: reference.nativeObjectRef, metadata_only: true,
  });
  if (result.document?.id !== reference.nativeObjectRef
    || result.knowledge_base?.id !== config.nativeKnowledgeBaseId
    || result.document.native_revision !== reference.nativeRevision) throw new Refused(403);
  return result.document;
}

async function readText(config, deadline, reference) {
  const content = [];
  const seen = new Set();
  let offset = 0;
  let total;
  let bytes = 0;
  do {
    const page = await nativeTool(config, deadline, 'read_document', {
      knowledge_id: reference.nativeObjectRef, offset,
    });
    if (page.document?.id !== reference.nativeObjectRef
      || page.document.native_revision !== reference.nativeRevision
      || page.knowledge_base?.id !== config.nativeKnowledgeBaseId
      || !Number.isSafeInteger(page.total_chunks) || page.total_chunks < 0
      || !Array.isArray(page.chunks) || page.fetched_chunks !== page.chunks.length
      || (total !== undefined && total !== page.total_chunks)) throw new Refused(503);
    total = page.total_chunks;
    for (const chunk of page.chunks) {
      if (!object(chunk) || !nonempty(chunk.chunk_id) || seen.has(chunk.chunk_id)
        || chunk.knowledge_id !== reference.nativeObjectRef
        || chunk.knowledge_base !== config.nativeKnowledgeBaseId || typeof chunk.content !== 'string') throw new Refused(503);
      seen.add(chunk.chunk_id);
      bytes += Buffer.byteLength(chunk.content, 'utf8') + (content.length === 0 ? 0 : 1);
      if (bytes > config.maxBodyBytes) throw new Refused(503);
      content.push(chunk.content);
    }
    offset += page.chunks.length;
    if (offset > total || (offset < total && page.chunks.length === 0)) throw new Refused(503);
  } while (offset < total);
  return { text: content.join('\n') };
}

async function executeRead(config, deadline, request, claims) {
  if (!['knowledge.read@v1', 'knowledge.export@v1'].includes(claims.action_key)) throw new Refused(404);
  const reference = referenceInput(request.arguments, claims);
  const document = await originalDocument(config, deadline, reference);
  // No HTTP receipt can turn pending/failed native parsing into a successful
  // full-text read. Export is independent of indexing and uses original bytes.
  let result;
  let nativeType;
  if (claims.action_key === 'knowledge.read@v1') {
    if (document.parse_status !== 'completed') throw new Refused(503);
    result = await readText(config, deadline, reference);
    nativeType = 'read_document';
  } else if (claims.action_key === 'knowledge.export@v1') {
    const exported = await nativeTool(config, deadline, 'export_document', { knowledge_id: reference.nativeObjectRef });
    if (exported.knowledge_id !== reference.nativeObjectRef
      || exported.knowledge_base_id !== config.nativeKnowledgeBaseId
      || exported.native_revision !== reference.nativeRevision || typeof exported.content_base64 !== 'string'
      || Buffer.from(exported.content_base64, 'base64').toString('base64') !== exported.content_base64
      || !nonempty(exported.media_type) || !nonempty(exported.filename)) throw new Refused(503);
    result = { contentBase64: exported.content_base64, mediaType: exported.media_type, filename: exported.filename };
    nativeType = 'export_document';
  } else {
    throw new Refused(404);
  }
  await originalDocument(config, deadline, reference);
  const at = new Date().toISOString();
  return { execution: { idempotencyKey: request.idempotencyKey, nativeType,
    nativeId: reference.nativeObjectRef, nativeStatus: 'completed', platformStatus: 'SUCCEEDED',
    cancelCapability: 'UNSUPPORTED', lastObservedAt: at, terminalAt: at },
    resultJson: JSON.stringify(result), contentReference: reference };
}

export function createAdapter(rawConfig) {
  const config = configuration(rawConfig);
  const server = createServer(async (request, response) => {
    try {
      const operation = request.url === QUERY_PATH ? 'query_revision'
        : request.url === '/platform-adapter/v1/execute' ? 'execute' : undefined;
      if (request.method !== 'POST' || operation === undefined) throw new Refused(404);
      if (request.headers['content-type'] !== 'application/json'
        || typeof request.headers.authorization !== 'string'
        || !request.headers.authorization.startsWith('Bearer ')) throw new Refused(401);
      const deadline = Date.now() + config.timeoutMs;
      const raw = await boundedBody(request, config.maxBodyBytes);
      let args;
      try { args = JSON.parse(raw); } catch { throw new Refused(400); }
      if (operation === 'query_revision' && (!exactKeys(args, ['nativeObjectRef', 'idempotencyKey', 'authorizationTargetNativeRef'])
        || !UUID.test(args.nativeObjectRef) || !UUID.test(args.authorizationTargetNativeRef)
        || !UUID.test(args.idempotencyKey) || args.idempotencyKey !== request.headers['idempotency-key']
        || raw !== canonical(args))) throw new Refused(400);
      if (operation === 'execute' && (!exactKeys(args, ['idempotencyKey', 'actionKey', 'arguments'])
        || !UUID.test(args.idempotencyKey) || args.idempotencyKey !== request.headers['idempotency-key'])) throw new Refused(400);
      const intent = operation === 'execute' ? args.arguments : args;
      const token = request.headers.authorization.slice('Bearer '.length);
      const claims = await verifyKnowledgeToken(token, config, intent, operation);
      if (operation === 'execute' && (args.actionKey !== claims.action_key
        || (claims.agent_principal_id === undefined && (claims.idempotency_key !== args.idempotencyKey
          || !UUID.test(claims.external_execution_id))))) throw new Refused(401);
      await freshPep(config, deadline, token, intent, claims, operation);
      const value = operation === 'execute' ? await executeRead(config, deadline, args, claims)
        : await nativeRevision(config, deadline, args);
      const current = await verifyKnowledgeToken(token, config, intent, operation);
      await freshPep(config, deadline, token, intent, current, operation);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(value));
    } catch (error) {
      const status = error instanceof Refused ? error.status : 503;
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ class: status === 401 || status === 403 ? 'DENIED' : 'UNAVAILABLE' }));
    }
  });
  server.requestTimeout = config.timeoutMs;
  server.headersTimeout = config.timeoutMs;
  return server;
}

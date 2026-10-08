import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Refused, object, nonempty, exactKeys, canonical, fixedUrl, boundedBody,
  verifiedClaims, verifyBindingHandshakeToken, secret, freshPep, readMeasurements, recordReadReceipt } from '../../../client-kit/adapter/protocol.mjs';
import { sourceReference, sourceFile } from './service-read.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUERY_PATH = '/platform-adapter/v1/query_revision';

// Both immutable capability contracts use the same original native consumer.
// Keep the signed key/version intact through PEP, hashing and observations.
function nativeKnowledgeAction(key) {
  return /^knowledge\.(search|read|export|ingest|delete)@v[12]$/.exec(key)?.[1];
}

export function configuration(value) {
  const required = ['bindingId', 'tenantId', 'nativeKnowledgeBaseId', 'nativeMcpUrl',
    'nativeMcpBearerFile', 'actionTokenIssuer', 'actionTokenAudience', 'actionTokenJwksFile',
    'corePepUrl', 'oidcTokenUrl', 'oidcClientId', 'oidcClientSecretFile',
    'timeoutMs', 'maxBodyBytes', 'listenHost', 'listenPort'];
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, 'workspaceId', 'readEdge', 'management'].includes(key))) throw new Refused(503);
  if (value.management !== undefined && (!exactKeys(value.management,
    ['componentTypeKey', 'componentReleaseId', 'artifactDigest', 'protocolRange'])
    || !nonempty(value.management.componentTypeKey) || !UUID.test(value.management.componentReleaseId)
    || !/^[a-f0-9]{64}$/.test(value.management.artifactDigest)
    || value.management.protocolRange !== '1')) throw new Refused(503);
  if (value.readEdge!==undefined && (!exactKeys(value.readEdge,value.readEdge?.usageMeasurements===undefined
      ? ['sourceActionVersion'] : ['sourceActionVersion','usageMeasurements'])
    || !Number.isSafeInteger(value.readEdge.sourceActionVersion) || value.readEdge.sourceActionVersion<=0)) throw new Refused(503);
  readMeasurements(value.readEdge?.usageMeasurements,0);
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

async function bindingHandshake(config, deadline, token, args) {
  const delivered = config.management;
  if (!delivered) throw new Refused(503);
  if (!exactKeys(args, ['idempotencyKey', 'componentReleaseId', 'componentTypeKey', 'protocolRange'])
    || args.componentReleaseId !== delivered.componentReleaseId
    || args.componentTypeKey !== delivered.componentTypeKey
    || args.protocolRange !== delivered.protocolRange) throw new Refused(403);
  const claims = await verifyBindingHandshakeToken(token, config, args);
  await freshPep(config, deadline, token, args, claims, 'handshake');
  // This observation proves only that the existing native MCP credential can
  // discover the exact configured KB. It does not assert write, secret-read
  // audit, or full validate_binding/conformance capabilities.
  const native = await nativeTool(config, deadline, 'list_knowledge_bases', {});
  if (!Array.isArray(native.knowledge_bases)) throw new Refused(503);
  const matches = native.knowledge_bases.filter(item => item?.id === config.nativeKnowledgeBaseId);
  if (matches.length !== 1) throw new Refused(403);
  if (!nonempty(matches[0].native_revision) || !Number.isFinite(Date.parse(matches[0].native_revision))
    || matches[0].native_revision.startsWith('0001-')) throw new Refused(503);
  const current = await verifyBindingHandshakeToken(token, config, args);
  await freshPep(config, deadline, token, args, current, 'handshake');
  return { protocolVersion: '1', artifactDigest: delivered.artifactDigest };
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
    || nativeKnowledgeAction(claims.action_key) === undefined
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

function deletionObservation(value, config, key, expected) {
  if (!object(value) || !UUID.test(value.task_id) || value.knowledge_base_id !== config.nativeKnowledgeBaseId
    || !UUID.test(value.knowledge_id) || !nonempty(value.native_revision)
    || !['RUNNING', 'UNKNOWN', 'SUCCEEDED'].includes(value.state)
    || (expected && (value.knowledge_id !== expected.nativeObjectRef || value.native_revision !== expected.nativeRevision))) throw new Refused(503);
  const observation = { idempotencyKey:key, nativeType:'delete_document', nativeId:value.task_id,
    nativeStatus:value.state, platformStatus:value.state, cancelCapability:'UNSUPPORTED', lastObservedAt:new Date().toISOString() };
  if (value.state === 'SUCCEEDED') {
    if (!nonempty(value.completed_at) || !Number.isFinite(Date.parse(value.completed_at)) || Date.parse(value.completed_at) > Date.now()) throw new Refused(503);
    observation.terminalAt = value.completed_at;
  } else if (value.completed_at !== undefined) throw new Refused(503);
  return observation;
}

function creationObservation(value, config, key, target, readOperation) {
  const document=value?.document;
  if (value?.knowledge_base_id!==config.nativeKnowledgeBaseId || !UUID.test(document?.id)
    || !nonempty(document.parse_status) || !UUID.test(value.read_operation_id)
    || (readOperation!==undefined && value.read_operation_id!==readOperation)) throw new Refused(503);
  // Pending/failed rows are retained native intent, not evidence of an outcome
  // that permits resubmitting the upload. Observation never calls creation.
  const status=document.parse_status==='completed' ? 'SUCCEEDED'
    : ['pending','processing','finalizing'].includes(document.parse_status) ? 'RUNNING' : 'UNKNOWN';
  const execution={idempotencyKey:key,nativeType:'add_document',nativeId:document.id,
    nativeStatus:document.parse_status,platformStatus:status,cancelCapability:'UNSUPPORTED',lastObservedAt:new Date().toISOString()};
  if (status!=='SUCCEEDED') return {execution};
  if (!nonempty(document.native_revision) || !Number.isFinite(Date.parse(document.native_revision))
    || Date.parse(document.native_revision)>Date.now() || !nonempty(document.file_name)
    || !nonempty(value.media_type)) throw new Refused(503);
  execution.terminalAt=document.native_revision;
  return {execution,resultJson:'{}',contentReference:{resourceId:target,nativeObjectRef:document.id,
    nativeRevision:document.native_revision,displayName:document.file_name,mediaType:value.media_type}};
}

async function recordCreationReceipt(value, observation, config, deadline, key) {
  if (observation.execution.platformStatus!=='SUCCEEDED') return;
  if (!/^[0-9a-f]{64}$/.test(value.source_content_sha256)
    || !Number.isSafeInteger(value.source_content_bytes) || value.source_content_bytes<0) throw new Refused(503);
  await recordReadReceipt(config,deadline,{bindingId:config.bindingId,operationId:value.read_operation_id,
    role:'RECEIVER',idempotencyKey:key,nativeObjectRef:observation.execution.nativeId,
    nativeRevision:observation.execution.terminalAt,completedAt:observation.execution.terminalAt,
    contentSha256:value.source_content_sha256,contentBytes:value.source_content_bytes,
    measurements:readMeasurements(config.readEdge?.usageMeasurements,value.source_content_bytes)});
}

async function executeOperation(config, deadline, request, claims, token) {
  if (claims.action_key === 'knowledge.search@v2') {
    const args = request.arguments;
    if (!exactKeys(args, ['target', 'input']) || !exactKeys(args.target, ['resourceId'])
      || args.target.resourceId !== claims.target_id || !exactKeys(args.input, ['query'])
      || !nonempty(args.input.query)) throw new Refused(400);
    const found = await nativeTool(config, deadline, 'search_knowledge', {
      query: args.input.query, knowledge_base_ids: [config.nativeKnowledgeBaseId],
    });
    if (found.query !== args.input.query || !Array.isArray(found.knowledge_base_ids)
      || found.knowledge_base_ids.length !== 1 || found.knowledge_base_ids[0] !== config.nativeKnowledgeBaseId
      || !Array.isArray(found.results) || !Number.isSafeInteger(found.count)
      || found.count !== found.results.length) throw new Refused(503);
    const documents = new Set();
    const references = new Set();
    const citations = [];
    for (const hit of found.results) {
      if (!object(hit) || !UUID.test(hit.knowledge_id)
        || hit.knowledge_base_id !== config.nativeKnowledgeBaseId) throw new Refused(503);
      if (documents.has(hit.knowledge_id)) continue;
      documents.add(hit.knowledge_id);
      const metadata = await nativeTool(config, deadline, 'read_document', {
        knowledge_id: hit.knowledge_id, metadata_only: true,
      });
      if (metadata.document?.id !== hit.knowledge_id || metadata.knowledge_base?.id !== config.nativeKnowledgeBaseId
        || metadata.document.parse_status !== 'completed' || !nonempty(metadata.document.native_revision)
        || !Number.isFinite(Date.parse(metadata.document.native_revision)) || metadata.document.native_revision.startsWith('0001-')
        || !Array.isArray(metadata.source_references) || metadata.source_references.length === 0) throw new Refused(503);
      // Search content/snippets/CustomMetadata never become consume output.
      // Provenance comes only from the guarded original document metadata.
      for (const value of metadata.source_references) {
        let reference;
        try { reference = sourceReference({ target: args.target, input: value }, claims); }
        catch { throw new Refused(503); }
        const encoded = canonical(reference);
        if (!references.has(encoded)) {
          references.add(encoded);
          citations.push(reference);
        }
      }
    }
    const at = new Date().toISOString();
    const result = { execution: { idempotencyKey: request.idempotencyKey, nativeType: 'search_knowledge',
      nativeId: config.nativeKnowledgeBaseId, nativeStatus: 'completed', platformStatus: 'SUCCEEDED',
      cancelCapability: 'UNSUPPORTED', lastObservedAt: at, terminalAt: at },
      resultJson: canonical({ citations }), ...(citations.length === 0 ? {} : { contentReferences: citations }) };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > config.maxBodyBytes) throw new Refused(503);
    return result;
  }
  if (nativeKnowledgeAction(claims.action_key)==='ingest') {
    const reference=sourceReference(request.arguments,claims);
    const source=await sourceFile(config,deadline,reference,request.idempotencyKey,claims);
    // Source read authorization does not substitute for receiver write authority.
    const current=await verifyKnowledgeToken(token,config,request.arguments,'execute');
    await freshPep(config,deadline,token,request.arguments,current,'execute');
    const value=await nativeTool(config,deadline,'add_document',{
      knowledge_base_id:config.nativeKnowledgeBaseId,title:reference.displayName,filename:reference.displayName,
      file_base64:source.bytes.toString('base64'),source_reference_json:canonical(reference),idempotency_key:request.idempotencyKey,
      read_operation_id:source.operationId,
    });
    const observed=creationObservation(value,config,request.idempotencyKey,claims.target_id,source.operationId);
    await recordCreationReceipt(value,observed,config,deadline,request.idempotencyKey);
    return observed;
  }
  if (nativeKnowledgeAction(claims.action_key) === 'delete') {
    const reference = referenceInput(request.arguments,claims);
    const value = await nativeTool(config,deadline,'delete_document',{
      knowledge_base_id:config.nativeKnowledgeBaseId,knowledge_id:reference.nativeObjectRef,
      expected_revision:reference.nativeRevision,idempotency_key:request.idempotencyKey,
    });
    const execution = deletionObservation(value,config,request.idempotencyKey,reference);
    return execution.platformStatus === 'SUCCEEDED' ? {execution,resultJson:'{}'} : {execution};
  }
  if (!['read', 'export'].includes(nativeKnowledgeAction(claims.action_key))) throw new Refused(404);
  const reference = referenceInput(request.arguments, claims);
  const document = await originalDocument(config, deadline, reference);
  // No HTTP receipt can turn pending/failed native parsing into a successful
  // full-text read. Export is independent of indexing and uses original bytes.
  let result;
  let nativeType;
  if (nativeKnowledgeAction(claims.action_key) === 'read') {
    if (document.parse_status !== 'completed') throw new Refused(503);
    result = await readText(config, deadline, reference);
    nativeType = 'read_document';
  } else if (nativeKnowledgeAction(claims.action_key) === 'export') {
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
        : request.url === '/platform-adapter/v1/handshake' ? 'handshake'
        : request.url === '/platform-adapter/v1/execute' ? 'execute'
          : request.url === '/platform-adapter/v1/observe' ? 'observe'
            : request.url === '/platform-adapter/v1/extract_usage' ? 'extract_usage' : undefined;
      if (request.method !== 'POST' || operation === undefined) throw new Refused(404);
      if (request.headers['content-type'] !== 'application/json'
        || typeof request.headers.authorization !== 'string'
        || !request.headers.authorization.startsWith('Bearer ')) throw new Refused(401);
      const deadline = Date.now() + config.timeoutMs;
      const raw = await boundedBody(request, config.maxBodyBytes);
      let args;
      try { args = JSON.parse(raw); } catch { throw new Refused(400); }
      if (operation === 'handshake') {
        if (!object(args) || !UUID.test(args.idempotencyKey)
          || args.idempotencyKey !== request.headers['idempotency-key'] || raw !== canonical(args)) throw new Refused(400);
        const value = await bindingHandshake(config, deadline, request.headers.authorization.slice('Bearer '.length), args);
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(value));
        return;
      }
      if (operation === 'query_revision' && (!exactKeys(args, ['nativeObjectRef', 'idempotencyKey', 'authorizationTargetNativeRef'])
        || !UUID.test(args.nativeObjectRef) || !UUID.test(args.authorizationTargetNativeRef)
        || !UUID.test(args.idempotencyKey) || args.idempotencyKey !== request.headers['idempotency-key']
        || raw !== canonical(args))) throw new Refused(400);
      if (operation === 'execute' && (!exactKeys(args, ['idempotencyKey', 'actionKey', 'arguments'])
        || !UUID.test(args.idempotencyKey) || args.idempotencyKey !== request.headers['idempotency-key'])) throw new Refused(400);
      if (['observe','extract_usage'].includes(operation) && (!exactKeys(args,Object.hasOwn(args,'nativeId')
        ? ['externalExecutionId','idempotencyKey','nativeType','nativeId'] : ['externalExecutionId','idempotencyKey','nativeType'])
        || !UUID.test(args.externalExecutionId) || !UUID.test(args.idempotencyKey)
        || args.idempotencyKey !== request.headers['idempotency-key'] || !['delete_document','add_document'].includes(args.nativeType)
        || (args.nativeId !== undefined && !UUID.test(args.nativeId)))) throw new Refused(400);
      const intent = operation === 'execute' ? args.arguments : args;
      const token = request.headers.authorization.slice('Bearer '.length);
      const claims = await verifyKnowledgeToken(token, config, intent, operation);
      if (operation === 'execute' && (args.actionKey !== claims.action_key
        || (claims.agent_principal_id === undefined && (claims.idempotency_key !== args.idempotencyKey
          || !UUID.test(claims.external_execution_id))))) throw new Refused(401);
      const admitted = await freshPep(config, deadline, token, intent, claims, operation);
      const searching = operation === 'execute' && claims.action_key === 'knowledge.search@v2';
      if (searching && admitted.targetResource?.nativeRef !== config.nativeKnowledgeBaseId) throw new Refused(403);
      let value;
      if (['observe','extract_usage'].includes(operation)) {
        if (nativeKnowledgeAction(claims.action_key)==='ingest' && args.nativeType==='add_document') {
          const native=await nativeTool(config,deadline,'add_document',{
            knowledge_base_id:config.nativeKnowledgeBaseId,idempotency_key:args.idempotencyKey,observe_only:true,
          });
          const observed=creationObservation(native,config,args.idempotencyKey,claims.target_id);
          await recordCreationReceipt(native,observed,config,deadline,args.idempotencyKey);
          value=operation==='observe' ? observed.execution : {
            externalExecutionId:args.externalExecutionId,idempotencyKey:args.idempotencyKey,
            nativeType:observed.execution.nativeType,nativeId:observed.execution.nativeId,
            measurements:readMeasurements(config.readEdge?.usageMeasurements,native.source_content_bytes)
              .map(entry=>({...entry,occurredAt:observed.execution.terminalAt})),
          };
          if (operation==='extract_usage' && observed.execution.platformStatus!=='SUCCEEDED') throw new Refused(503);
        } else if (operation==='observe' && nativeKnowledgeAction(claims.action_key)==='delete' && args.nativeType==='delete_document') {
          value = deletionObservation(await nativeTool(config,deadline,'delete_document',{
            knowledge_base_id:config.nativeKnowledgeBaseId,idempotency_key:args.idempotencyKey,observe_only:true,
          }),config,args.idempotencyKey);
        } else throw new Refused(403);
        if (args.nativeId !== undefined && args.nativeId !== value.nativeId) throw new Refused(503);
      } else {
        value = operation === 'execute' ? await executeOperation(config, deadline, args, claims, token)
          : await nativeRevision(config, deadline, args);
      }
      const current = await verifyKnowledgeToken(token, config, intent, operation);
      const disclosed = await freshPep(config, deadline, token, intent, current, operation);
      if (searching && canonical(disclosed.targetResource) !== canonical(admitted.targetResource)) throw new Refused(403);
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

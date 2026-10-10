// The fixed Cells node seam is REST. This is the same binding adapter's MCP
// for its existing node consumers, not a second registry or execution service.
import { createHash } from 'node:crypto';
import { Refused, exactKeys, object, nonempty, canonical, boundedBody,
  fixedUrl, verifiedClaims } from '../../../client-kit/adapter/protocol.mjs';
import { executeNode, nodeActions } from './node-execution.mjs';
import { executeWrite, writeAction } from './write-execution.mjs';
import { executeDelete, deleteAction } from './delete-execution.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const transportHeader = 'x-kailo-gateway-authorization';

export function mcpConfiguration(value, config) {
  if (value === undefined) return undefined;
  if (!exactKeys(value, ['path', 'gatewayIssuer', 'gatewayAudience', 'gatewayJwksFile',
    'gatewayCaller', 'gatewayMaxTokenSeconds', 'tools'])
    || !['path', 'gatewayIssuer', 'gatewayAudience', 'gatewayJwksFile', 'gatewayCaller']
      .every(key => nonempty(value[key]))
    || !value.path.startsWith('/') || value.path.startsWith('//') || /[?#\s]/.test(value.path)
    || value.path.startsWith('/platform-adapter/') || !value.gatewayJwksFile.startsWith('/')
    || value.gatewayAudience !== config.actionTokenAudience
    || !Number.isSafeInteger(value.gatewayMaxTokenSeconds) || value.gatewayMaxTokenSeconds <= 0
    || !config.management?.validation
    || !Array.isArray(value.tools) || !value.tools.length) throw new Refused(503);
  fixedUrl(value.gatewayIssuer);
  const names = new Set();
  const mapped = new Set();
  for (const tool of value.tools) {
    if (!exactKeys(tool, ['name', 'actionKey', 'actionVersion', 'inputSchemaDigest', 'inputSchema',
      ...(Object.hasOwn(tool ?? {}, 'description') ? ['description'] : [])])
      || !nonempty(tool.name) || names.has(tool.name)
      || (nodeActions.includes(tool.actionKey) ? !config.readEdge
        : tool.actionKey === writeAction ? !config.write
        : tool.actionKey !== deleteAction || !config.delete)
      || !Number.isSafeInteger(tool.actionVersion) || tool.actionVersion <= 0
      || !object(tool.inputSchema) || tool.inputSchema.type !== 'object'
      || (tool.description !== undefined && !nonempty(tool.description))
      || tool.inputSchemaDigest !== createHash('sha256').update(canonical(tool.inputSchema)).digest('hex')
      || mapped.has(`${tool.actionKey}:${tool.actionVersion}`)
      || !config.management.validation.actionVersions.some(action => action.actionKey === tool.actionKey
        && action.actionVersion === tool.actionVersion)) throw new Refused(503);
    names.add(tool.name); mapped.add(`${tool.actionKey}:${tool.actionVersion}`);
  }
  // Snapshot only controlled delivery. Requests never select schemas, action
  // mappings, credentials, a native URL or a different binding generation.
  return Object.freeze(JSON.parse(canonical(value)));
}

function bearer(request, header) {
  if (request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === header).length !== 1
    || typeof request.headers[header] !== 'string' || !request.headers[header].startsWith('Bearer ')
    || !nonempty(request.headers[header].slice(7))) throw new Refused(401);
  return request.headers[header].slice(7);
}

async function gatewayIdentity(config, request) {
  const delivered = config.mcp;
  const claims = await verifiedClaims(bearer(request, transportHeader), {
    actionTokenIssuer: delivered.gatewayIssuer, actionTokenAudience: delivered.gatewayAudience,
    actionTokenJwksFile: delivered.gatewayJwksFile,
  });
  if (claims.sub !== delivered.gatewayCaller || claims.azp !== delivered.gatewayCaller
    || claims.exp - claims.iat > delivered.gatewayMaxTokenSeconds) throw new Refused(401);
}

export async function handleMcp(config, request, response) {
  if (!config.mcp || request.url !== config.mcp.path) throw new Refused(404);
  await gatewayIdentity(config, request);
  const deadline = Date.now() + config.timeoutMs;
  // Lazy imports keep an unconfigured MCP surface absent. The pinned SDK owns
  // initialization, notification, JSON-RPC and stateless HTTP framing.
  const [{ Server }, { StreamableHTTPServerTransport }, types] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/index.js'),
    import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]);
  const server = new Server({ name: config.management.componentTypeKey,
    version: config.management.artifactDigest }, { capabilities: { tools: {} } });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  server.onerror = () => {};
  const refused = () => new types.McpError(types.ErrorCode.InvalidRequest, 'adapter request refused');
  server.setRequestHandler(types.ListToolsRequestSchema, async value => {
    try {
      await gatewayIdentity(config, request);
      if (value.params?.cursor !== undefined) throw new Refused(400);
      return { tools: config.mcp.tools.map(({ name, description, inputSchema }) => ({
        name, ...(description === undefined ? {} : { description }), inputSchema,
      })) };
    } catch { throw refused(); }
  });
  server.setRequestHandler(types.CallToolRequestSchema, async value => {
    try {
      await gatewayIdentity(config, request);
      const token = bearer(request, 'authorization');
      const claims = await verifiedClaims(token, config);
      const key = request.headers['idempotency-key'];
      if (request.rawHeaders.filter((entry, index) => index % 2 === 0 && entry.toLowerCase() === 'idempotency-key').length !== 1
        || !UUID.test(key) || claims.idempotency_key !== key || claims.target_type !== 'RESOURCE'
        || !UUID.test(claims.target_id) || !object(value.params.arguments)) throw new Refused(401);
      const tool = config.mcp.tools.find(entry => entry.name === value.params.name);
      if (!tool || claims.action_key !== tool.actionKey || claims.action_definition_version !== tool.actionVersion) throw new Refused(403);
      // ExtMcp forwards only input. The authenticated target, original hash,
      // HUMAN/AGENT delegation and all fresh PEP checks remain executeNode's.
      const args = { target: { resourceId: claims.target_id }, input: value.params.arguments };
      const execute = tool.actionKey === writeAction ? executeWrite
        : tool.actionKey === deleteAction ? executeDelete : executeNode;
      const structuredContent = await execute(config, deadline, canonical({ actionKey: tool.actionKey,
        idempotencyKey: key, arguments: args }), key, token);
      await gatewayIdentity(config, request);
      // Core's response PEP consumes the original AdapterExecutionResponse;
      // do not disclose resultJson as a separate ungoverned text block.
      return { content: [], structuredContent, isError: false };
    } catch { throw refused(); }
  });
  response.setHeader('cache-control', 'no-store');
  response.on('close', () => { void server.close().catch(() => {}); });
  try {
    await server.connect(transport);
    let body;
    if (request.method === 'POST') {
      try { body = JSON.parse(await boundedBody(request, config.maxBodyBytes)); }
      catch (error) { throw error instanceof Refused ? error : new Refused(400); }
    }
    await transport.handleRequest(request, response, body);
  } catch (error) {
    await server.close().catch(() => {});
    throw error instanceof Refused ? error : new Refused(503);
  }
}

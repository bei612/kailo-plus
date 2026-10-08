import { NextApiRequest, NextApiResponse } from 'next';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import {
  NativeQueryService,
  queryInputSchema,
} from '@server/services/nativeQueryService';
import { NativeBindingService } from '@server/services/nativeBindingService';
import {
  authenticateQueryGateway,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';

// Only these machine endpoints have their own authentication instead of the
// independent native browser OIDC middleware. They do not accept cookies,
// native UI bearer tokens or an identity chosen in the request body.
export const config = { api: { bodyParser: false } };

function bearer(request: NextApiRequest): string {
  const token =
    request.headers.authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1];
  if (!token) throw new NativeQueryRefusal(401, 'QUERY_ACTION_TOKEN_REQUIRED');
  return token;
}

async function body(request: NextApiRequest, maximum: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > maximum)
      throw new NativeQueryRefusal(413, 'QUERY_REQUEST_TOO_LARGE');
    chunks.push(Buffer.from(part));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new NativeQueryRefusal(400, 'QUERY_INVALID_REQUEST');
  }
}

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (
      request.method !== 'POST' ||
      !['mcp', 'execute', 'observe', 'handshake', 'validate_binding'].includes(
        String(request.query.operation),
      )
    ) {
      response.status(405).end();
      return;
    }
    if (request.headers.origin || request.headers.cookie) {
      throw new NativeQueryRefusal(403, 'QUERY_MACHINE_CHANNEL_REQUIRED');
    }
    const delivered = await loadQueryDelivery();
    if (
      request.query.operation === 'handshake' ||
      request.query.operation === 'validate_binding'
    ) {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string')
        throw new NativeQueryRefusal(400, 'QUERY_IDEMPOTENCY_REQUIRED');
      const { components } = await import('../../../common');
      const binding = new NativeBindingService(
        delivered,
        components.projectRepository,
      );
      response
        .status(200)
        .json(
          await binding.call(
            bearer(request),
            request.query.operation,
            key,
            await body(request, delivered.requestMaxBytes),
          ),
        );
      return;
    }
    let service: NativeQueryService;
    const queries = async () => {
      if (!service) {
        const { components } = await import('../../../common');
        service = new NativeQueryService(
          delivered,
          components.projectRepository,
          components.deployLogRepository,
          components.apiHistoryRepository,
          components.queryService,
          components.viewRepository,
          components.modelRepository,
          components.modelColumnRepository,
        );
      }
      return service;
    };
    if (request.query.operation === 'observe') {
      const raw = await body(request, delivered.requestMaxBytes);
      // Original ActionToken + binding service PEP authorizes this exact EE
      // reference. System observation returns metadata only, never SQL/results.
      response
        .status(200)
        .json(await (await queries()).observe(bearer(request), raw));
      return;
    }
    if (request.query.operation === 'execute') {
      const raw = await body(request, delivered.requestMaxBytes);
      const key = request.headers['idempotency-key'];
      if (
        !raw ||
        Object.keys(raw).sort().join(',') !==
          'actionKey,arguments,idempotencyKey' ||
        typeof key !== 'string' ||
        raw.idempotencyKey !== key ||
        !['data_query.query@v1', 'data_query.dry_run@v1'].includes(
          raw.actionKey,
        ) ||
        !raw.arguments ||
        Object.keys(raw.arguments).sort().join(',') !== 'input,target' ||
        !raw.arguments.target ||
        Object.keys(raw.arguments.target).join(',') !== 'resourceId' ||
        raw.arguments.target.resourceId !== raw.arguments.input?.resourceId
      ) {
        throw new NativeQueryRefusal(400, 'QUERY_INVALID_REQUEST');
      }
      response
        .status(200)
        .json(
          await (
            await queries()
          ).execute(bearer(request), key, raw.actionKey, raw.arguments.input),
        );
      return;
    }
    const machine = request.headers['x-kailo-gateway-authorization'];
    await authenticateQueryGateway(
      delivered,
      typeof machine === 'string' ? machine : undefined,
    );
    const server = new Server(
      { name: 'wren-native-query', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'data_query.query',
          description: 'Query one frozen native deployment',
          inputSchema: queryInputSchema,
        },
        {
          name: 'data_query.dry_run',
          description: 'Validate SQL against one frozen native deployment',
          inputSchema: queryInputSchema,
        },
        {
          name: 'data_query.describe',
          description:
            'Read this native model deployment reference and column metadata',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      try {
        if (
          ![
            'data_query.query',
            'data_query.dry_run',
            'data_query.describe',
          ].includes(call.params.name)
        ) {
          throw new NativeQueryRefusal(400, 'UNKNOWN_QUERY_OPERATION');
        }
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string')
          throw new NativeQueryRefusal(400, 'QUERY_IDEMPOTENCY_REQUIRED');
        const result = await (
          await queries()
        ).execute(
          bearer(request),
          key,
          `${call.params.name}@v1` as
            | 'data_query.query@v1'
            | 'data_query.dry_run@v1'
            | 'data_query.describe@v1',
          call.params.arguments,
        );
        // Remote Adapter v1 metadata is consumed by Core's existing response PEP;
        // only its validated resultJson business value reaches the model.
        return { content: [], structuredContent: result };
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof NativeQueryRefusal
            ? error.code
            : 'QUERY_ADMISSION_UNAVAILABLE',
        );
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedHosts: [delivered.mcpAuthority],
      enableDnsRebindingProtection: true,
    });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(
      request,
      response,
      await body(request, delivered.requestMaxBytes),
    );
  } catch (error) {
    // Do not return driver, JWT, SQL or configuration diagnostics to callers.
    if (!response.headersSent) {
      response
        .status(error instanceof NativeQueryRefusal ? error.status : 503)
        .json({
          error:
            error instanceof NativeQueryRefusal
              ? error.code
              : 'QUERY_ADMISSION_UNAVAILABLE',
        });
    }
  }
}

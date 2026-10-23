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
  describeInputSchema,
} from '@server/services/nativeQueryService';
import { NativeBindingService } from '@server/services/nativeBindingService';
import {
  authenticateQueryGateway,
  authorizeQuery,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import {
  boundedBody,
  nativeStatusErrorArguments,
  mapNativeStatusError,
  Refused,
  searchArguments,
  verifySearchToken,
} from '../../../../../../client-kit/adapter/protocol.mjs';
import { kailoAdapterSearch } from '@server/services/kailoAdapterSearch';

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
      ![
        'mcp',
        'execute',
        'observe',
        'handshake',
        'validate_binding',
        'reconcile',
        'map_native_status_error',
        'search',
      ].includes(String(request.query.operation))
    ) {
      response.status(405).end();
      return;
    }
    if (request.headers.origin || request.headers.cookie) {
      throw new NativeQueryRefusal(403, 'QUERY_MACHINE_CHANNEL_REQUIRED');
    }
    const delivered = await loadQueryDelivery();
    if (request.query.operation === 'search') {
      // DD-138(5), `07` §4.8.4 / §5.2: shared body and Search Token checks
      // (400 body, 401 token); no Core PEP call and no ActionExecution.
      const args = searchArguments(
        await boundedBody(request, delivered.requestMaxBytes),
        request.headers['idempotency-key'],
      );
      await verifySearchToken(bearer(request), delivered, args);
      const { components } = await import('../../../common');
      response
        .status(200)
        .json(await kailoAdapterSearch(components.knex, delivered, args));
      return;
    }
    if (request.query.operation === 'map_native_status_error') {
      const operation = 'map_native_status_error';
      const args = nativeStatusErrorArguments(
        await boundedBody(request, delivered.requestMaxBytes),
        request.headers['idempotency-key'],
      );
      const token = bearer(request);
      const claims = await authorizeQuery(delivered, token, operation, args);
      if (
        ![
          'data_query.query@v2',
          'data_query.dry_run@v2',
          'data_query.describe@v2',
        ].includes(String(claims.action_key)) ||
        claims.action_definition_version !== 1 ||
        claims.target_type !== 'RESOURCE' ||
        typeof claims.target_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          claims.target_id,
        )
      )
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const result = mapNativeStatusError(args);
      await authorizeQuery(delivered, token, operation, args);
      response.status(200).json(result);
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
    if (
      request.query.operation === 'handshake' ||
      request.query.operation === 'validate_binding' ||
      request.query.operation === 'reconcile'
    ) {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string')
        throw new NativeQueryRefusal(400, 'QUERY_IDEMPOTENCY_REQUIRED');
      const raw = await body(request, delivered.requestMaxBytes);
      if (
        request.query.operation === 'reconcile' &&
        raw &&
        !Array.isArray(raw) &&
        Object.keys(raw).join(',') === 'idempotencyKey'
      ) {
        if (raw.idempotencyKey !== key)
          throw new NativeQueryRefusal(400, 'QUERY_INVALID_REQUEST');
        response
          .status(200)
          .json(
            await (await queries()).observe(bearer(request), raw, 'reconcile'),
          );
        return;
      }
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
            raw,
            components.apiHistoryRepository,
          ),
        );
      return;
    }
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
        ![
          'data_query.query@v2',
          'data_query.dry_run@v2',
          'data_query.describe@v2',
        ].includes(raw.actionKey) ||
        !raw.arguments ||
        Object.keys(raw.arguments).sort().join(',') !== 'input,target' ||
        !raw.arguments.target ||
        Object.keys(raw.arguments.target).join(',') !== 'resourceId' ||
        typeof raw.arguments.target.resourceId !== 'string' ||
        (raw.actionKey !== 'data_query.describe@v2' &&
          raw.arguments.target.resourceId !== raw.arguments.input?.resourceId)
      ) {
        throw new NativeQueryRefusal(400, 'QUERY_INVALID_REQUEST');
      }
      response
        .status(200)
        .json(
          await (
            await queries()
          ).execute(
            bearer(request),
            key,
            raw.actionKey,
            raw.arguments.input,
            raw.arguments.target,
          ),
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
          inputSchema: describeInputSchema,
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
          `${call.params.name}@v2` as
            | 'data_query.query@v2'
            | 'data_query.dry_run@v2'
            | 'data_query.describe@v2',
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
        .status(
          error instanceof NativeQueryRefusal || error instanceof Refused
            ? error.status
            : 503,
        )
        .json(
          error instanceof NativeQueryRefusal && error.resourcePermissionDenied
            ? {
                class: 'DENIED',
                reason: 'PERMISSION_DENIED',
              }
            : {
                error:
                  error instanceof NativeQueryRefusal
                    ? error.code
                    : 'QUERY_ADMISSION_UNAVAILABLE',
              },
        );
    }
  }
}

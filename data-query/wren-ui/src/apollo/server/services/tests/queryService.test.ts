import { TelemetryEvent } from '../../telemetry/telemetry';
import { createServer, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { IbisAdaptor } from '../../adaptors/ibisAdaptor';
import { WrenEngineAdaptor } from '../../adaptors/wrenEngineAdaptor';
import { encryptConnectionInfo } from '../../dataSource';
import { DataSourceName } from '../../types';
import { QueryService } from '../queryService';

describe('QueryService', () => {
  let mockIbisAdaptor;
  let mockWrenEngineAdaptor;
  let mockTelemetry;
  let queryService;

  beforeEach(() => {
    mockIbisAdaptor = {
      query: jest.fn(),
      dryRun: jest.fn(),
    };
    mockWrenEngineAdaptor = {};
    mockTelemetry = new MockTelemetry();

    queryService = new QueryService({
      ibisAdaptor: mockIbisAdaptor,
      wrenEngineAdaptor: mockWrenEngineAdaptor,
      telemetry: mockTelemetry,
    });
  });

  afterEach(() => {
    mockTelemetry.records = [];
    jest.clearAllMocks();
  });

  it('should return true and send event when previewing via ibis dry run succeeds', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      dryRun: true,
    });

    expect(res).toEqual({ correlationId: '123' });
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('should send event when previewing via ibis dry run fails', async () => {
    mockIbisAdaptor.dryRun.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    try {
      await queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
        dryRun: true,
      });
    } catch (e) {
      expect(e.message).toEqual('Error message');
      expect(e.extensions.other.correlationId).toEqual('123');
      expect(e.extensions.other.processTime).toEqual('1s');
    }

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });

  it('should return data and send event when previewing via ibis query succeeds', async () => {
    mockIbisAdaptor.query.mockResolvedValue({
      data: [],
      columns: [],
      dtypes: [],
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      limit: 10,
    });

    expect(res.data).toEqual([]);
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('should send event when previewing via ibis query fails', async () => {
    mockIbisAdaptor.query.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
      }),
    ).rejects.toMatchObject({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });
});

class MockTelemetry {
  records: any[] = [];
  sendEvent(
    event: TelemetryEvent,
    properties: Record<string, any> = {},
    service: any,
    actionSuccess: boolean = true,
  ) {
    this.records.push({ event, properties, service, actionSuccess });
  }
}

describe('original QueryService governed SQL transport', () => {
  it.each(
    [DataSourceName.DUCKDB, DataSourceName.POSTGRES].flatMap((type) =>
      [false, true].flatMap((dryRun) =>
        ['deadline', 'response size'].map((boundary) => ({
          type,
          dryRun,
          boundary,
        })),
      ),
    ),
  )(
    'consumes $boundary for $type dryRun=$dryRun without retry',
    async ({ type, dryRun, boundary }) => {
      let requestCount = 0;
      let pending: ServerResponse;
      let lateReply: ReturnType<typeof setTimeout>;
      let input: Record<string, any>;
      let path: string;
      let blocked = true;
      const server = createServer(async (request, response) => {
        requestCount++;
        path = request.url;
        let body = '';
        for await (const part of request) body += part;
        input = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        const oversized = blocked && boundary === 'response size';
        const value =
          type === DataSourceName.DUCKDB
            ? dryRun
              ? oversized
                ? [{ name: randomUUID().repeat(100), type: 'TEXT' }]
                : []
              : {
                  columns: [{ name: 'one', type: 'INTEGER' }],
                  data: [[oversized ? randomUUID().repeat(100) : 1]],
                }
            : {
                columns: ['one'],
                dtypes: { one: 'int32' },
                data: [[oversized ? randomUUID().repeat(100) : 1]],
              };
        const payload = JSON.stringify(value);
        if (blocked && boundary === 'deadline') {
          pending = response;
          lateReply = setTimeout(
            () => response.end(payload),
            options.requestTimeoutMs * 4,
          );
          return;
        }
        // A chunked native response must be bounded too, not only Content-Length.
        response.write(payload.slice(0, payload.length / 2));
        response.end(payload.slice(payload.length / 2));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const service = new QueryService({
        ibisAdaptor: new IbisAdaptor({ ibisServerEndpoint: origin }),
        wrenEngineAdaptor: new WrenEngineAdaptor({
          wrenEngineEndpoint: origin,
        }),
        telemetry: new MockTelemetry() as any,
      });
      const manifest = { catalog: 'fixture', schema: 'public', models: [] };
      const sql = `SELECT '${randomUUID()}' AS one`;
      const options = {
        project: {
          type,
          connectionInfo:
            type === DataSourceName.POSTGRES
              ? encryptConnectionInfo(type, {
                  host: 'native-database.invalid',
                  port: 5432,
                  database: randomUUID(),
                  user: randomUUID(),
                  password: randomUUID(),
                  ssl: false,
                })
              : {},
        } as any,
        manifest,
        limit: 3,
        dryRun,
        cacheEnabled: false,
        requestTimeoutMs: 200,
        responseMaxBytes: 256,
      };
      try {
        await expect(service.preview(sql, options)).rejects.toBeDefined();
        expect(requestCount).toBe(1);
        expect(input.sql).toBe(sql);
        expect(
          type === DataSourceName.DUCKDB
            ? input.manifest
            : JSON.parse(Buffer.from(input.manifestStr, 'base64').toString()),
        ).toEqual(manifest);
        expect(path).toContain(
          type === DataSourceName.DUCKDB
            ? dryRun
              ? '/v1/mdl/dry-run'
              : '/v1/mdl/preview'
            : '/connector/postgres/query',
        );
        if (dryRun && type === DataSourceName.POSTGRES)
          expect(path).toContain('dryRun=true');
        pending?.end('{}');
        clearTimeout(lateReply);
        blocked = false;
        const result = await service.preview(sql, options);
        if (dryRun)
          expect(type === DataSourceName.DUCKDB ? result : !!result).toBe(true);
        else expect(result).toMatchObject({ data: [[1]] });
        expect(requestCount).toBe(2);
      } finally {
        pending?.end('{}');
        clearTimeout(lateReply);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});

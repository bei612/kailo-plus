import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { DiagramResolver } from './apollo/server/resolvers/diagramResolver';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { ProjectResolver } from './apollo/server/resolvers/projectResolver';
import { AskResultStatus, AskResultType } from './apollo/server/models/adaptor';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import {
  isGovernedQueryMode,
  nativeQueryMode,
  NativeQueryMode,
} from './apollo/server/services/nativeQueryMode';
import { governedMetadataDelivery } from './apollo/server/services/nativeGovernedMetadata';

// Resolver imports initialize the real singleton, including upstream trackers
// with no stop method. Own those actual interval handles in this test and close
// its original pool; do not replace the resolver, repository or admission.
jest.mock('./common', () => {
  const intervals = jest.spyOn(global, 'setInterval');
  try {
    const actual = jest.requireActual('./common');
    const handles = intervals.mock.results
      .filter((result) => result.type === 'return')
      .map((result) => result.value);
    afterAll(async () => {
      for (const handle of handles) clearInterval(handle);
      await actual.components.knex.destroy();
    });
    return actual;
  } finally {
    intervals.mockRestore();
  }
});

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));

// DD-127(7)/DD-124: one deployment-mode source. An independent native page
// (no query/binding delivery) never loads a delivery even though its native
// OIDC login always carries a token; a governed instance keeps its chain.
const ENV = [
  'WREN_PLATFORM_QUERY_CONFIG_FILE',
  'WREN_PLATFORM_BINDING_CONFIG_FILE',
] as const;

describe('native query deployment mode', () => {
  const saved: Record<string, string | undefined> = {};
  const projectId = 3;
  const config = {
    bindingId: '8b066261-f827-462e-95c1-1d596fce1849',
    projectId,
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: String(projectId),
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
  } as NativeQueryDelivery;
  const calls = jest.mocked(bindingServiceCall);
  const delivery = jest.mocked(loadQueryDelivery);
  const model = {
    id: 11,
    projectId,
    referenceName: 'orders',
    displayName: 'Orders',
    sourceTableName: 'orders',
    properties: '{}',
    cached: false,
    refSql: null,
  };
  const column = {
    id: 31,
    modelId: 11,
    referenceName: 'amount',
    sourceColumnName: 'amount',
    displayName: 'Amount',
    type: 'INTEGER',
    isCalculated: false,
    isPk: false,
    properties: '{}',
  };
  const view = {
    id: 7,
    projectId,
    name: 'saved_orders',
    statement: 'SELECT amount FROM orders',
    cached: false,
    properties: JSON.stringify({
      displayName: 'Saved orders',
      columns: [{ name: 'amount', type: 'INTEGER' }],
    }),
  };
  const task = {
    projectId,
    queryId: 'native-query',
    status: AskResultStatus.FINISHED,
    type: AskResultType.TEXT_TO_SQL,
    response: [
      { type: 'llm', sql: 'SELECT amount FROM orders' },
      { type: 'view', viewId: 7, sql: 'SELECT amount FROM saved_orders' },
    ],
    traceId: 'trace',
    error: null,
  };
  let ctx: any;

  const setMode = (query?: string, binding?: string) => {
    if (query === undefined) delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = query;
    if (binding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = binding;
  };

  beforeAll(() => {
    for (const name of ENV) saved[name] = process.env[name];
  });
  afterAll(() => {
    for (const name of ENV)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  });
  beforeEach(() => {
    setMode();
    // The production failure: no delivery file means admission unavailable.
    delivery
      .mockReset()
      .mockRejectedValue(
        new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
      );
    calls
      .mockReset()
      .mockImplementation(async (_config, _operation, request: any) => ({
        resource: {
          resourceId: 'f0d7d739-666c-4cdb-927b-4bad718c94e2',
          resourceVersion: 1,
          nativeType: request.resolveResource.nativeType,
          nativeRef: request.resolveResource.nativeRef,
          nativeInstanceRef: config.nativeInstanceRef,
          nativeScopeRef: config.nativeScopeRef,
        },
      }));
    ctx = {
      // Native OIDC login: the request always carries its verified identity.
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'native-oidc-token',
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      projectRepository: {
        getCurrentProject: jest.fn(async () => ({
          id: projectId,
          type: 'DUCKDB',
          catalog: 'original',
          schema: 'original',
        })),
      },
      askingService: {
        getAskingTask: jest.fn(async () => ({ ...task })),
      },
      askingTaskRepository: { findOneBy: jest.fn(async () => null) },
      viewRepository: {
        findOneBy: jest.fn(async (where) =>
          where.id === view.id && where.projectId === projectId
            ? { ...view }
            : null,
        ),
        findAllBy: jest.fn(async () => [{ ...view }]),
      },
      sqlPairRepository: { findOneBy: jest.fn() },
      modelRepository: { findAllBy: jest.fn(async () => [{ ...model }]) },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn(async () => [{ ...column }]),
      },
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn(async () => []),
      },
      relationRepository: { findRelationInfoBy: jest.fn(async () => []) },
      schemaChangeRepository: {
        findLastSchemaChange: jest.fn(async () => ({
          projectId,
          createdAt: 'fixture-time',
          resolve: { deletedColumns: false },
          change: {
            deletedColumns: [
              {
                name: 'orders',
                columns: [{ name: 'amount', type: 'INTEGER' }],
              },
            ],
          },
        })),
      },
      telemetry: { sendEvent: jest.fn() },
    };
  });

  const readers = {
    getAskingTask: () =>
      new AskingResolver().getAskingTask({}, { taskId: task.queryId }, ctx),
    getDiagram: () => new DiagramResolver().getDiagram(null, {}, ctx),
    getSchemaChange: () =>
      new ProjectResolver().getSchemaChange(null, null, ctx),
    metadataConfig: () => new ModelResolver().listModels(null, null, ctx),
  };

  describe('nativeQueryMode', () => {
    it.each([
      [undefined, undefined, NativeQueryMode.STANDALONE],
      [
        '/delivery/query.json',
        '/delivery/binding.json',
        NativeQueryMode.GOVERNED,
      ],
      ['/delivery/query.json', undefined, NativeQueryMode.GOVERNED],
      [undefined, '/delivery/binding.json', NativeQueryMode.GOVERNED],
      // A present but empty/relative delivery is GOVERNED and fails closed.
      ['', undefined, NativeQueryMode.GOVERNED],
      ['relative.json', undefined, NativeQueryMode.GOVERNED],
    ])('query=%p binding=%p is %s', (query, binding, mode) => {
      setMode(query, binding);
      expect(nativeQueryMode()).toBe(mode);
      expect(isGovernedQueryMode()).toBe(mode === NativeQueryMode.GOVERNED);
    });

    it('is not selected by a request token or identity', async () => {
      expect(nativeQueryMode()).toBe(NativeQueryMode.STANDALONE);
      await expect(governedMetadataDelivery(ctx, projectId)).resolves.toBe(
        undefined,
      );
      setMode('/delivery/query.json', '/delivery/binding.json');
      delivery.mockResolvedValue(config);
      delete ctx.nativeHumanToken;
      delete ctx.nativeIdentityScope;
      await expect(
        governedMetadataDelivery(ctx, projectId),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('STANDALONE serves the original readers without any delivery', () => {
    afterEach(() => {
      expect(delivery).not.toHaveBeenCalled();
      expect(calls).not.toHaveBeenCalled();
    });

    it('getAskingTask returns the finished candidates with their saved view', async () => {
      const result: any = await readers.getAskingTask();
      expect(result.status).toBe(AskResultStatus.FINISHED);
      expect(result.candidates).toEqual([
        {
          type: 'llm',
          sql: 'SELECT amount FROM orders',
          view: null,
          sqlPair: null,
        },
        {
          type: 'view',
          sql: 'SELECT amount FROM saved_orders',
          view: { ...view },
          sqlPair: null,
        },
      ]);
      expect(ctx.askingTaskRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('getAskingTask keeps the original null view for a removed saved view', async () => {
      ctx.viewRepository.findOneBy.mockResolvedValue(null);
      const result: any = await readers.getAskingTask();
      expect(result.candidates.map((candidate) => candidate.view)).toEqual([
        null,
        null,
      ]);
    });

    it('getDiagram returns the complete original diagram', async () => {
      const result = await readers.getDiagram();
      expect(result.models).toEqual([
        expect.objectContaining({
          modelId: 11,
          referenceName: 'orders',
          fields: [expect.objectContaining({ columnId: 31 })],
        }),
      ]);
      expect(result.views).toEqual([
        expect.objectContaining({ viewId: 7, referenceName: 'saved_orders' }),
      ]);
    });

    it('getSchemaChange returns the original detector output', async () => {
      const result: any = await readers.getSchemaChange();
      expect(result.lastSchemaChangeTime).toBe('fixture-time');
      expect(result.deletedColumns).toEqual([
        expect.objectContaining({ modelId: 11, displayName: 'Orders' }),
      ]);
    });

    it('metadataConfig keeps the original model list (Models(n), not 0)', async () => {
      const result: any[] = await readers.metadataConfig();
      expect(result).toEqual([
        expect.objectContaining({
          id: 11,
          fields: [expect.objectContaining({ id: 31 })],
        }),
      ]);
    });
  });

  describe('GOVERNED keeps the existing governed chain', () => {
    beforeEach(() => {
      setMode('/delivery/query.json', '/delivery/binding.json');
      delivery.mockReset().mockResolvedValue(config);
    });

    it.each(Object.keys(readers))(
      '%s refuses a request without the verified native person',
      async (name) => {
        delete ctx.nativeHumanToken;
        delete ctx.nativeIdentityScope;
        await expect(readers[name]()).rejects.toMatchObject({ status: 401 });
        expect(delivery).toHaveBeenCalled();
        expect(ctx.modelRepository.findAllBy).not.toHaveBeenCalled();
      },
    );

    it.each(Object.keys(readers))(
      '%s refuses an unavailable delivery instead of the original read',
      async (name) => {
        delivery.mockRejectedValue(
          new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
        );
        await expect(readers[name]()).rejects.toMatchObject({
          status: 503,
          message: 'QUERY_ADMISSION_UNAVAILABLE',
        });
        expect(ctx.modelRepository.findAllBy).not.toHaveBeenCalled();
      },
    );

    it('getAskingTask requires the owned native task proof', async () => {
      await expect(readers.getAskingTask()).rejects.toMatchObject({
        status: 403,
        message: 'QUERY_SCOPE_DENIED',
      });
      expect(ctx.askingTaskRepository.findOneBy).toHaveBeenCalledWith({
        queryId: task.queryId,
        projectId,
      });
      expect(ctx.askingService.getAskingTask).not.toHaveBeenCalled();
    });

    it('getDiagram authorizes every model and view before and after reading', async () => {
      const result = await readers.getDiagram();
      expect(result.models).toHaveLength(1);
      expect(
        calls.mock.calls.map((call: any[]) => [
          call[2].resolveResource.nativeType,
          call[3],
        ]),
      ).toEqual([
        ['model', 'native-oidc-token'],
        ['view', 'native-oidc-token'],
        ['model', 'native-oidc-token'],
        ['view', 'native-oidc-token'],
      ]);
    });

    it('getSchemaChange authorizes the models before and after reading', async () => {
      const result: any = await readers.getSchemaChange();
      expect(result.lastSchemaChangeTime).toBe('fixture-time');
      expect(calls).toHaveBeenCalledTimes(2);
    });

    it('metadataConfig filters the model list by current Resource read', async () => {
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true),
      );
      expect(await readers.metadataConfig()).toEqual([]);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(
        ctx.modelColumnRepository.findColumnsByModelIds,
      ).not.toHaveBeenCalled();
    });

    it('refuses a bound project other than the delivered one', async () => {
      delivery.mockResolvedValue({ ...config, projectId: 4 });
      for (const name of ['getDiagram', 'getSchemaChange', 'metadataConfig'])
        await expect(readers[name]()).rejects.toMatchObject({ status: 403 });
    });
  });
});

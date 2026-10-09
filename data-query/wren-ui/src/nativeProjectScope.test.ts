import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import originalResolvers from './apollo/server/resolvers';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from './apollo/server/services/nativeHumanQuery';
import { ApiType } from './apollo/server/repositories/apiHistoryRepository';
import { ApolloServer } from 'apollo-server-micro';
import { gql } from '@apollo/client';
import GraphQLJSON from 'graphql-type-json';
import { typeDefs } from './apollo/server/schema';
import { LIST_MODELS, GET_MODEL } from './apollo/client/graphql/model';
import { LIST_VIEWS } from './apollo/client/graphql/view';
import { GET_NATIVE_SQL } from './apollo/client/graphql/home';
import { DiagramResolver } from './apollo/server/resolvers/diagramResolver';
import { AskingService } from './apollo/server/services/askingService';
import { ProjectService } from './apollo/server/services/projectService';
import { TextBasedAnswerBackgroundTracker } from './apollo/server/backgrounds/textBasedAnswerBackgroundTracker';
import {
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
} from './apollo/server/backgrounds/chart';
import { DashboardResolver } from './apollo/server/resolvers/dashboardResolver';
import { DashboardService } from './apollo/server/services/dashboardService';
import { MDLService } from './apollo/server/services/mdlService';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe('original independent Model/View preview business consumers', () => {
  const resolver = new ModelResolver();
  const project = { id: 7 };
  const manifest = { models: [{ name: 'orders' }], views: [] };
  const rows = { columns: [{ name: 'customer' }], data: [['original']] };
  const config: any = {
    projectId: project.id,
    bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
    nativeInstanceRef: 'fixture-instance',
    nativeScopeRef: String(project.id),
  };
  let previous: string | undefined;
  let ctx: any;
  let governed: jest.SpyInstance;
  const invoke = (kind: 'model' | 'view', where: any = { id: 11, limit: 17 }) =>
    resolver[kind === 'model' ? 'previewModelData' : 'previewViewData'](
      null,
      { where },
      ctx,
    );
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    jest.mocked(loadQueryDelivery).mockReset().mockResolvedValue(config);
    governed = jest
      .spyOn(NativeHumanQuery.prototype, 'preview')
      .mockResolvedValue({ terminalStatus: 'UNKNOWN' } as any);
    ctx = {
      projectService: { getCurrentProject: jest.fn(async () => project) },
      modelRepository: {
        findOneBy: jest.fn(async () => ({
          id: 11,
          projectId: project.id,
          referenceName: 'orders',
        })),
      },
      viewRepository: {
        findOneBy: jest.fn(async () => ({
          id: 11,
          projectId: project.id,
          statement: 'SELECT customer FROM orders',
        })),
      },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn(async () => [
          { referenceName: 'customer' },
          { referenceName: 'total' },
        ]),
      },
      mdlService: {
        makeCurrentModelMDL: jest.fn(async () => ({ manifest })),
      },
      queryService: { preview: jest.fn(async () => rows) },
    };
  });
  afterEach(() => {
    governed.mockRestore();
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });
  it.each(['model', 'view'] as const)(
    'retains the fixed original independent %s SQL, options and raw rows without an AE receipt',
    async (kind) => {
      await expect(invoke(kind)).resolves.toBe(rows);
      expect(
        ctx[kind === 'model' ? 'modelRepository' : 'viewRepository'].findOneBy,
      ).toHaveBeenCalledWith({ id: 11, projectId: project.id });
      expect(ctx.mdlService.makeCurrentModelMDL).toHaveBeenCalledWith(project);
      expect(ctx.queryService.preview).toHaveBeenCalledTimes(1);
      expect(ctx.queryService.preview).toHaveBeenCalledWith(
        kind === 'model'
          ? 'select "customer","total" from "orders"'
          : 'SELECT customer FROM orders',
        {
          project,
          manifest,
          modelingOnly: false,
          ...(kind === 'view' ? { limit: 17 } : {}),
        },
      );
      expect(loadQueryDelivery).not.toHaveBeenCalled();
      expect(governed).not.toHaveBeenCalled();
    },
  );
  it('keeps the original model wildcard for no native columns', async () => {
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([]);
    await invoke('model');
    expect(ctx.queryService.preview.mock.calls[0][0]).toBe(
      'select * from "orders"',
    );
  });
  it.each(['model', 'view'] as const)(
    'never drops a bound intent into independent %s SQL',
    async (kind) => {
      await expect(
        invoke(kind, {
          id: 11,
          idempotencyKey: 'retained-bound-intent',
          idempotencyScope: 'a'.repeat(64),
        }),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    },
  );
  it.each(['empty', 'invalid', 'identity-only', 'token-only', 'mixed'])(
    'refuses %s configuration/context rather than falling back to independent SQL',
    async (fault) => {
      if (fault === 'empty' || fault === 'invalid') {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
          fault === 'empty' ? '' : 'invalid-fixture';
        jest
          .mocked(loadQueryDelivery)
          .mockRejectedValue(
            new NativeQueryRefusal(503, 'QUERY_CONFIG_UNAVAILABLE'),
          );
      }
      if (fault === 'identity-only' || fault === 'mixed')
        ctx.nativeIdentityScope = 'a'.repeat(64);
      if (fault === 'token-only' || fault === 'mixed')
        ctx.nativeHumanToken = 'trusted-person';
      for (const kind of ['model', 'view'] as const)
        await expect(invoke(kind)).rejects.toThrow();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(governed).not.toHaveBeenCalled();
    },
  );
  it.each(['model', 'view'] as const)(
    'retains current HUMAN same-key observation for a configured %s, without native SQL fallback',
    async (kind) => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
      ctx.nativeIdentityScope = 'a'.repeat(64);
      ctx.nativeHumanToken = 'trusted-person';
      const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
      const key = '5da4d2d5-4b99-4383-942a-4c6b0f7db0da';
      await expect(
        invoke(kind, {
          id: 11,
          limit: 17,
          idempotencyKey: key,
          idempotencyScope: scope,
        }),
      ).resolves.toEqual({ terminalStatus: 'UNKNOWN', previewScope: scope });
      expect(governed).toHaveBeenCalledWith(
        'trusted-person',
        11,
        17,
        key,
        kind,
        undefined,
      );
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(ctx.mdlService.makeCurrentModelMDL).not.toHaveBeenCalled();
    },
  );
  it.each(['binding', 'identity', 'token', 'project'])(
    'refuses an independent preview when %s changes while the original MDL is prepared',
    async (fault) => {
      ctx.mdlService.makeCurrentModelMDL.mockImplementation(async () => {
        if (fault === 'binding')
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
        if (fault === 'identity') ctx.nativeIdentityScope = 'a'.repeat(64);
        if (fault === 'token') ctx.nativeHumanToken = 'trusted-person';
        if (fault === 'project')
          ctx.projectService.getCurrentProject.mockResolvedValue({ id: 8 });
        return { manifest };
      });
      await expect(invoke('view')).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    },
  );
  it.each(['model', 'view'] as const)(
    'withholds late independent %s rows after binding delivery, without repeating the original query',
    async (kind) => {
      ctx.queryService.preview.mockImplementation(async () => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
        return rows;
      });
      await expect(invoke(kind)).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(ctx.queryService.preview).toHaveBeenCalledTimes(1);
      expect(governed).not.toHaveBeenCalled();
    },
  );
  it('withholds rows if the current native project changes during SQL', async () => {
    ctx.queryService.preview.mockImplementation(async () => {
      ctx.projectService.getCurrentProject.mockResolvedValue({ id: 8 });
      return rows;
    });
    await expect(invoke('view')).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(ctx.queryService.preview).toHaveBeenCalledTimes(1);
  });
  it('preserves the internal Asking view snapshot before independent SQL', async () => {
    await expect(
      resolver.previewViewSnapshotData(
        { where: { id: 11 } },
        ctx,
        'SELECT changed',
      ),
    ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });
  it('preserves an original independent provider refusal without fabricating a terminal receipt', async () => {
    const failure = new Error('Original native query refused');
    ctx.queryService.preview.mockRejectedValue(failure);
    await expect(invoke('view')).rejects.toBe(failure);
    expect(ctx.queryService.preview).toHaveBeenCalledTimes(1);
    expect(governed).not.toHaveBeenCalled();
  });
});

describe('original Save as View consumes the same HUMAN query history', () => {
  const resolver = new ModelResolver();
  const config: any = {
    projectId: 7,
    bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
    nativeInstanceRef: 'fixture-instance',
    nativeScopeRef: '7',
  };
  const response = {
    id: 21,
    threadId: 11,
    sql: 'SELECT customer FROM original_model',
  };
  const columns = [{ name: 'customer', type: 'STRING' }];
  let previous: string | undefined;
  let ctx: any;
  let record: any;
  let disclose: jest.SpyInstance;
  let find: jest.Mock;
  const input = () => ({
    data: {
      name: 'OriginalView',
      responseId: response.id,
      rephrasedQuestion: 'Original question',
      queryHistoryId: record.id,
    },
  });
  const invoke = () => resolver.createView(null, input(), ctx);
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
    jest.mocked(loadQueryDelivery).mockReset().mockResolvedValue(config);
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'human-a',
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue({ id: 7 }),
      },
      deployService: {
        getLastDeployment: jest.fn().mockResolvedValue({ manifest: {} }),
      },
      askingService: {
        getResponse: jest.fn().mockResolvedValue({ ...response }),
      },
      viewRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn(async (row) => ({ id: 99, ...row })),
      },
      queryService: {
        describeStatement: jest.fn().mockResolvedValue({ columns }),
        preview: jest.fn(),
      },
      telemetry: { sendEvent: jest.fn() },
    };
    record = {
      id: '3b41671e-d794-46fa-a8c1-b287fe3ebdbb',
      projectId: 7,
      apiType: ApiType.RUN_SQL,
      governanceBindingId: config.bindingId,
      governanceState: 'SUCCEEDED',
      requestPayload: {
        action: 'data_query.query@v1',
        sql: response.sql,
        limit: 1,
        previewScope: nativePreviewScope(config, ctx.nativeIdentityScope),
      },
    };
    find = jest.fn(async (where) =>
      Object.entries(where).every(([key, value]) => record[key] === value)
        ? record
        : null,
    );
    require('./common').components.apiHistoryRepository.findOneBy = find;
    disclose = jest
      .spyOn(NativeHumanQuery.prototype, 'readHistory')
      .mockResolvedValue({
        requestPayload: record.requestPayload,
        responsePayload: { columns, data: [['original']] },
      });
  });
  afterEach(() => {
    disclose.mockRestore();
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });
  it('creates the original view with original columns only after observing its same completed query, without another SQL call', async () => {
    const view = await invoke();
    expect(view).toMatchObject({ id: 99, displayName: 'OriginalView' });
    expect(JSON.parse(view.properties)).toEqual({
      displayName: 'OriginalView',
      columns,
      responseId: response.id,
      question: 'Original question',
    });
    expect(find).toHaveBeenCalledWith({
      id: record.id,
      projectId: config.projectId,
      apiType: ApiType.RUN_SQL,
      governanceBindingId: config.bindingId,
      governanceState: 'SUCCEEDED',
    });
    expect(disclose).toHaveBeenCalledWith(ctx.nativeHumanToken, record);
    expect(ctx.queryService.describeStatement).not.toHaveBeenCalled();
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(ctx.viewRepository.createOne).toHaveBeenCalledTimes(1);
  });
  it.each([
    'missing',
    'UNKNOWN',
    'project',
    'binding',
    'scope',
    'sql',
    'action',
    'limit',
  ])(
    'refuses %s history before native INSERT or implicit SQL',
    async (fault) => {
      if (fault === 'missing') find.mockResolvedValue(null);
      if (fault === 'UNKNOWN') record.governanceState = 'UNKNOWN';
      if (fault === 'project') record.projectId++;
      if (fault === 'binding') record.governanceBindingId = 'another-binding';
      if (fault === 'scope')
        record.requestPayload.previewScope = 'b'.repeat(64);
      if (fault === 'sql')
        record.requestPayload.sql = 'SELECT private FROM another_model';
      if (fault === 'action')
        record.requestPayload.action = 'data_query.dry_run@v1';
      if (fault === 'limit') record.requestPayload.limit = 2;
      await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(disclose).not.toHaveBeenCalled();
      expect(ctx.viewRepository.createOne).not.toHaveBeenCalled();
      expect(ctx.queryService.describeStatement).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    },
  );
  it('does not create a view after current source permission or completed-query exposure is revoked', async () => {
    disclose.mockRejectedValue(
      new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
    );
    await expect(invoke()).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(ctx.viewRepository.createOne).not.toHaveBeenCalled();
    expect(ctx.queryService.describeStatement).not.toHaveBeenCalled();
  });
  it.each(['response', 'actor', 'token', 'delivery', 'project'])(
    'refuses a %s change while the same original AE is being observed',
    async (fault) => {
      disclose.mockImplementation(async () => {
        if (fault === 'response')
          ctx.askingService.getResponse.mockResolvedValue({
            ...response,
            sql: 'SELECT changed FROM another_model',
          });
        if (fault === 'actor') ctx.nativeIdentityScope = 'b'.repeat(64);
        if (fault === 'token') ctx.nativeHumanToken = 'human-b';
        if (fault === 'delivery')
          jest.mocked(loadQueryDelivery).mockResolvedValue({
            ...config,
            nativeInstanceRef: 'changed-instance',
          });
        if (fault === 'project')
          ctx.projectService.getCurrentProject.mockResolvedValue({ id: 8 });
        return {
          requestPayload: record.requestPayload,
          responsePayload: { columns, data: [] },
        };
      });
      await expect(invoke()).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(ctx.viewRepository.createOne).not.toHaveBeenCalled();
      expect(ctx.queryService.describeStatement).not.toHaveBeenCalled();
    },
  );
  it('retains the original independent describe/INSERT without fabricated history or HUMAN identity', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete ctx.nativeIdentityScope;
    delete ctx.nativeHumanToken;
    await expect(invoke()).resolves.toMatchObject({ id: 99 });
    expect(ctx.queryService.describeStatement).toHaveBeenCalledTimes(1);
    expect(disclose).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
  it('does not adopt an independent describe result if a binding is configured during that original SQL call', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete ctx.nativeIdentityScope;
    delete ctx.nativeHumanToken;
    ctx.queryService.describeStatement.mockImplementation(async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-fixture';
      return { columns };
    });
    await expect(invoke()).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(ctx.viewRepository.createOne).not.toHaveBeenCalled();
  });
});

describe('native bound-project business consumers', () => {
  const resolver = new ModelResolver();
  const projectId = 7;
  let ctx: any;
  const config: any = {
    projectId,
    nativeScopeRef: String(projectId),
    nativeInstanceRef: 'fixture-instance',
    bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
    workspaceId: '87c27723-e475-4e0b-a0e9-50e5d755fe63',
  };
  const authorize = jest.mocked(bindingServiceCall);
  const selected = (request: any) => ({
    resource: {
      resourceId: '09c6b43b-1edf-467d-8e81-e47a3f506c4f',
      resourceVersion: 1,
      nativeType: request.resolveResource.nativeType,
      nativeRef: request.resolveResource.nativeRef,
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
    },
  });
  const repository = (rows: any[]) => ({
    findOneBy: jest.fn(
      async (where) =>
        rows.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null,
    ),
    createOne: jest.fn(async (data) => ({ id: 99, ...data })),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    findAllBy: jest.fn(async () => []),
    transaction: jest.fn(async () => ({})),
    commit: jest.fn(),
    rollback: jest.fn(),
  });
  beforeEach(() => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    authorize.mockReset();
    authorize.mockImplementation(async (_config, _operation, request) =>
      selected(request),
    );
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'first-person-token',
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      modelRepository: repository([
        { id: 11, projectId, properties: '{}' },
        { id: 12, projectId: 8 },
      ]),
      viewRepository: repository([
        { id: 21, projectId, name: 'original', properties: '{}' },
        { id: 22, projectId: 8 },
      ]),
      modelColumnRepository: repository([
        { id: 31, modelId: 11 },
        { id: 32, modelId: 12, isCalculated: true },
      ]),
      modelNestedColumnRepository: repository([{ id: 41, modelId: 12 }]),
      relationRepository: repository([{ id: 51, projectId: 8 }]),
      deployRepository: repository([
        { id: 61, projectId: 8, hash: 'foreign-hash' },
      ]),
      telemetry: { sendEvent: jest.fn() },
      queryService: { preview: jest.fn() },
      modelService: {
        updateRelation: jest.fn(),
        deleteRelation: jest.fn(),
        createCalculatedField: jest.fn(),
        updateCalculatedField: jest.fn(),
        validateCalculatedFieldNaming: jest.fn(async () => ({ valid: true })),
      },
    };
    ctx.modelColumnRepository.findColumnsByModelIds = jest.fn(async () => [
      {
        id: 31,
        modelId: 11,
        properties: '{}',
        type: 'STRING',
        isCalculated: false,
      },
    ]);
    ctx.modelNestedColumnRepository.findNestedColumnsByModelIds = jest.fn(
      async () => [],
    );
    ctx.relationRepository.findRelationsBy = jest.fn(async () => []);
  });
  const diagramContext = () => {
    ctx.projectRepository = {
      getCurrentProject: jest.fn(async () => ({
        id: projectId,
        type: 'DUCKDB',
        catalog: 'original',
        schema: 'original',
      })),
    };
    const models = [11, 13].map((id) => ({
      id,
      projectId,
      referenceName: `model${id}`,
      displayName: `Model ${id}`,
      sourceTableName: `table${id}`,
      properties: '{}',
      cached: false,
      refSql: `SELECT original${id}`,
    }));
    const columns = models.map((model) => ({
      id: model.id + 20,
      modelId: model.id,
      referenceName: 'id',
      sourceColumnName: 'id',
      displayName: 'ID',
      type: 'INTEGER',
      isCalculated: false,
      isPk: true,
      properties: '{}',
    }));
    const views = [
      {
        id: 21,
        projectId,
        name: 'originalView',
        statement: 'SELECT original',
        properties: JSON.stringify({
          description: 'Original view',
          columns: [{ name: 'id', type: 'INTEGER' }],
        }),
      },
    ];
    const relations = [
      {
        id: 51,
        projectId,
        name: 'originalRelation',
        joinType: 'ONE_TO_ONE',
        condition: 'model11.id = model13.id',
        fromColumnId: 31,
        toColumnId: 33,
        fromModelId: 11,
        toModelId: 13,
        fromModelName: 'model11',
        toModelName: 'model13',
        fromColumnName: 'id',
        toColumnName: 'id',
        properties: '{}',
      },
    ];
    ctx.modelRepository.findAllBy.mockResolvedValue(models);
    ctx.viewRepository.findAllBy.mockResolvedValue(views);
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue(columns);
    ctx.relationRepository.findRelationInfoBy = jest.fn(async () => relations);
    return {
      models,
      columns,
      views,
      relations,
      resolver: new DiagramResolver(),
    };
  };
  describe('original never-configured model metadata consumers', () => {
    let previous: string | undefined;
    const manifest = { models: [{ name: 'model11' }], views: [] };
    const queries = {
      listModels: LIST_MODELS,
      model: GET_MODEL,
      listViews: LIST_VIEWS,
      view: gql`
        query View($where: ViewWhereUniqueInput!) {
          view(where: $where) {
            id
            name
            statement
            displayName
          }
        }
      `,
      getMDL: gql`
        query MDL($hash: String!) {
          getMDL(hash: $hash) {
            hash
            mdl
          }
        }
      `,
    };
    const read = async (operation: keyof typeof queries) => {
      const graphql = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: {
            listModels: resolver.listModels,
            model: resolver.getModel,
            listViews: resolver.listViews,
            view: resolver.getView,
            getMDL: resolver.getMDL,
          },
        },
        context: () => ctx,
      });
      try {
        return await graphql.executeOperation({
          query: queries[operation],
          variables: {
            where: { id: operation === 'view' ? 21 : 11 },
            hash: 'original-standalone-hash',
          },
        });
      } finally {
        await graphql.stop();
      }
    };
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete ctx.nativeHumanToken;
      delete ctx.nativeIdentityScope;
      jest.mocked(loadQueryDelivery).mockClear();
      const model = {
        id: 11,
        projectId,
        referenceName: 'model11',
        displayName: 'Original model',
        sourceTableName: 'original_table',
        refSql: '',
        cached: false,
        properties: '{}',
      };
      ctx.modelRepository = repository([model]);
      ctx.modelRepository.findAllBy.mockResolvedValue([model]);
      ctx.viewRepository = repository([
        {
          id: 21,
          projectId,
          name: 'originalView',
          statement: 'SELECT original',
        },
      ]);
      ctx.viewRepository.findAllBy.mockResolvedValue([
        {
          id: 21,
          projectId,
          name: 'originalView',
          statement: 'SELECT original',
        },
      ]);
      ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([
        {
          id: 31,
          modelId: 11,
          displayName: 'ID',
          referenceName: 'id',
          sourceColumnName: 'id',
          type: 'INTEGER',
          isCalculated: false,
          notNull: false,
          properties: '{}',
        },
      ]);
      ctx.deployRepository = repository([
        {
          id: 61,
          projectId,
          hash: 'original-standalone-hash',
          manifest,
          // The original standalone deployment predates platform provenance.
        },
      ]);
    });
    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });
    it.each(Object.keys(queries) as (keyof typeof queries)[])(
      'serves the actual original %s GraphQL body without fabricated platform identity or Resource',
      async (operation) => {
        const result = await read(operation);
        expect(result.errors).toBeUndefined();
        if (operation === 'getMDL')
          expect(result.data.getMDL).toEqual({
            hash: 'original-standalone-hash',
            mdl: Buffer.from(JSON.stringify(manifest)).toString('base64'),
          });
        else {
          expect(result.data[operation]).toBeTruthy();
          if (operation === 'model')
            expect(result.data.model).toMatchObject({
              displayName: 'Original model',
              fields: [{ referenceName: 'id' }],
            });
          if (operation === 'view')
            expect(result.data.view).toMatchObject({
              id: 21,
              statement: 'SELECT original',
            });
        }
        expect(loadQueryDelivery).not.toHaveBeenCalled();
        expect(authorize).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        expect(ctx.modelRepository.createOne).not.toHaveBeenCalled();
        expect(ctx.viewRepository.createOne).not.toHaveBeenCalled();
      },
    );
    it.each(['', 'invalid-controlled-delivery'])(
      'does not treat defined configuration %p as the independent original model mode',
      async (value) => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = value;
        jest
          .mocked(loadQueryDelivery)
          .mockRejectedValue(
            new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
          );
        for (const operation of Object.keys(
          queries,
        ) as (keyof typeof queries)[]) {
          const result = await read(operation);
          expect(result.errors).toBeDefined();
          expect(result.data).toBeNull();
        }
        expect(authorize).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each([
      'scope-only',
      'token-only',
      'both-heads',
      'empty-scope',
      'empty-token',
    ])(
      'refuses %s without a configured binding instead of borrowing the standalone current project',
      async (mode) => {
        if (mode === 'empty-scope') ctx.nativeIdentityScope = '';
        else if (mode === 'empty-token') ctx.nativeHumanToken = '';
        else {
          if (mode !== 'token-only') ctx.nativeIdentityScope = 'a'.repeat(64);
          if (mode !== 'scope-only')
            ctx.nativeHumanToken = 'verified-native-token';
        }
        jest
          .mocked(loadQueryDelivery)
          .mockRejectedValue(
            new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
          );
        const result = await read('listModels');
        expect(result.errors).toBeDefined();
        expect(result.data).toBeNull();
        expect(loadQueryDelivery).toHaveBeenCalledTimes(1);
        expect(
          ctx.modelColumnRepository.findColumnsByModelIds,
        ).not.toHaveBeenCalled();
        expect(authorize).not.toHaveBeenCalled();
      },
    );
    it.each(['listModels', 'model'] as const)(
      'withholds the original standalone %s response if a binding appears during native column loading',
      async (operation) => {
        const columns =
          ctx.modelColumnRepository.findColumnsByModelIds.getMockImplementation();
        ctx.modelColumnRepository.findColumnsByModelIds.mockImplementation(
          async (...args) => {
            const result = await columns(...args);
            process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
              'new-controlled-binding';
            return result;
          },
        );
        const result = await read(operation);
        expect(result.errors).toBeDefined();
        expect(result.data).toBeNull();
        expect(authorize).not.toHaveBeenCalled();
      },
    );
    it('withholds the original standalone view list if a binding appears during its native read', async () => {
      const find = ctx.viewRepository.findAllBy.getMockImplementation();
      ctx.viewRepository.findAllBy.mockImplementation(async (...args) => {
        const rows = await find(...args);
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'new-controlled-binding';
        return rows;
      });
      const result = await read('listViews');
      expect(result.errors).toBeDefined();
      expect(result.data).toBeNull();
      expect(authorize).not.toHaveBeenCalled();
    });
    it('refuses a platform-correlated MDL request rather than claiming standalone evidence', async () => {
      await expect(
        resolver.getMDL(
          null,
          {
            hash: 'original-standalone-hash',
            queryScope: 'a'.repeat(64),
            generation: 1,
          },
          ctx,
        ),
      ).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
      expect(authorize).not.toHaveBeenCalled();
    });
  });

  describe('original native SQL conversion HUMAN source consumer', () => {
    let previous: string | undefined;
    let captured: any;
    let response: any;
    let generation: number;
    let args: any;
    let requestContext: typeof ctx;
    const read = async () => {
      const graphql = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: {
            nativeSql: (root, variables, context) => {
              requestContext = context;
              return resolver.getNativeSql(root, variables, context);
            },
          },
        },
        context: () => ctx,
      });
      try {
        return await graphql.executeOperation({
          query: GET_NATIVE_SQL,
          variables: args,
        });
      } finally {
        await graphql.stop();
      }
    };
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      generation = 2;
      requestContext = undefined;
      captured = {
        manifest: {
          catalog: 'original',
          schema: 'original',
          models: [{ name: 'model11', columns: [] }],
          views: [
            {
              name: 'originalView',
              statement: 'SELECT model11',
              properties: { viewId: '21' },
            },
          ],
        },
        nativeObjectRefs: [
          { nativeType: 'model', nativeId: 11, nativeName: 'model11' },
          { nativeType: 'view', nativeId: 21, nativeName: 'originalView' },
        ],
      };
      response = { id: 71, threadId: 81, sql: 'SELECT originalView' };
      ctx.projectService.getCurrentProject.mockResolvedValue({
        id: projectId,
        type: 'POSTGRES',
      });
      ctx.mdlService = {
        makeCurrentModelMDL: jest.fn(async () => structuredClone(captured)),
      };
      ctx.askingService = {
        getResponse: jest.fn(async () => structuredClone(response)),
      };
      ctx.wrenEngineAdaptor = {
        getNativeSQL: jest.fn(async () => 'SELECT converted'),
      };
      ctx.ibisServerAdaptor = {
        getNativeSql: jest.fn(async () => 'SELECT converted'),
      };
      args = {
        responseId: 71,
        queryScope: nativePreviewScope(config, ctx.nativeIdentityScope),
        generation,
      };
      authorize.mockImplementation(async (_config, _operation, input) =>
        input.authorizeScope
          ? {
              scope: {
                ...config,
                generation,
                tenantId: config.tenantId,
                permission: 'discover',
                checkedRevision: 'fresh-scope',
              },
            }
          : selected(input),
      );
    });
    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });
    it.each(['POSTGRES', 'DUCKDB', 'MSSQL'])(
      'converts the original current %s model snapshot once after real source reads, without executing SQL',
      async (type) => {
        const project = { id: projectId, type };
        ctx.projectService.getCurrentProject.mockResolvedValue(project);
        const result = await read();
        expect(result.errors).toBeUndefined();
        expect(result.data.nativeSql).toContain('converted');
        expect(ctx.mdlService.makeCurrentModelMDL).toHaveBeenNthCalledWith(
          1,
          project,
        );
        expect(ctx.mdlService.makeCurrentModelMDL).toHaveBeenNthCalledWith(
          2,
          project,
        );
        expect(ctx.askingService.getResponse).toHaveBeenNthCalledWith(
          1,
          71,
          project,
        );
        expect(ctx.askingService.getResponse).toHaveBeenNthCalledWith(
          2,
          71,
          project,
        );
        const convert =
          type === 'DUCKDB'
            ? ctx.wrenEngineAdaptor.getNativeSQL
            : ctx.ibisServerAdaptor.getNativeSql;
        expect(convert).toHaveBeenCalledTimes(1);
        const scopeRequests = authorize.mock.calls
          .map((entry) => entry[2].authorizeScope)
          .filter(Boolean);
        expect(scopeRequests).toHaveLength(3);
        scopeRequests.forEach((request) =>
          expect(request).toEqual({ permission: 'discover' }),
        );
        expect(
          authorize.mock.calls
            .filter((entry) => (entry[2] as any).resolveResource)
            .map((entry) => (entry[2] as any).resolveResource),
        ).toEqual(
          [11, 21, 11, 21].map((id) => ({
            workspaceId: config.workspaceId,
            actionKey: 'data_query.describe@v1',
            actionVersion: 1,
            nativeType: id === 11 ? 'model' : 'view',
            nativeRef: String(id),
          })),
        );
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['missing', 'scope', 'generation'])(
      'rejects %s request association before reading model bodies or converting',
      async (fault) => {
        if (fault === 'missing') args = { responseId: 71 };
        else if (fault === 'scope') args.queryScope = 'b'.repeat(64);
        else args.generation = 3;
        const result = await read();
        expect(result.errors).toBeDefined();
        expect(result.data).toBeNull();
        expect(ctx.mdlService.makeCurrentModelMDL).not.toHaveBeenCalled();
        expect(ctx.ibisServerAdaptor.getNativeSql).not.toHaveBeenCalled();
      },
    );
    it.each(['model', 'view'])(
      'refuses denied %s before sending full native MDL to the original converter',
      async (kind) => {
        const original = authorize.getMockImplementation();
        authorize.mockImplementation(async (...input) => {
          if ((input[2] as any).resolveResource?.nativeType === kind)
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return original(...input);
        });
        expect((await read()).data).toBeNull();
        expect(ctx.ibisServerAdaptor.getNativeSql).not.toHaveBeenCalled();
      },
    );
    it.each([
      'source',
      'resource-version',
      'generation',
      'scope',
      'delivery',
      'manifest',
      'provenance',
      'response',
      'project',
    ])(
      'withholds converted SQL after %s changes while the original converter is in flight',
      async (fault) => {
        const original = authorize.getMockImplementation();
        ctx.ibisServerAdaptor.getNativeSql.mockImplementation(async () => {
          if (fault === 'source')
            authorize.mockImplementation(async (...input) => {
              if ((input[2] as any).resolveResource)
                throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
              return original(...input);
            });
          if (fault === 'resource-version')
            authorize.mockImplementation(async (...input) => {
              const result = await original(...input);
              return result.resource
                ? { resource: { ...result.resource, resourceVersion: 2 } }
                : result;
            });
          if (fault === 'generation') generation += 1;
          if (fault === 'scope') {
            requestContext.nativeIdentityScope =
              requestContext.nativeIdentityScope === 'a'.repeat(64)
                ? 'b'.repeat(64)
                : 'a'.repeat(64);
            expect(
              nativePreviewScope(config, requestContext.nativeIdentityScope),
            ).not.toBe(args.queryScope);
          }
          if (fault === 'delivery')
            jest.mocked(loadQueryDelivery).mockResolvedValue({
              ...config,
              nativeInstanceRef: 'different-controlled-instance',
            });
          if (fault === 'manifest')
            captured.manifest.models[0].columns = [{ name: 'new-column' }];
          if (fault === 'provenance')
            captured.nativeObjectRefs[0].nativeId = 12;
          if (fault === 'response') response.sql = 'SELECT other';
          if (fault === 'project')
            ctx.projectService.getCurrentProject.mockResolvedValue({
              id: 8,
              type: 'POSTGRES',
            });
          return 'SELECT secretConverted';
        });
        const result = await read();
        expect(result.errors).toBeDefined();
        expect(result.data).toBeNull();
        expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('refuses missing captured source facts instead of adopting same-name current native IDs', async () => {
      delete captured.nativeObjectRefs;
      const result = await read();
      expect(result.errors).toBeDefined();
      expect(result.data).toBeNull();
      expect(ctx.ibisServerAdaptor.getNativeSql).not.toHaveBeenCalled();
    });
    it.each([undefined, { sql: 'SELECT undisclosed_native_detail' }])(
      'does not expose an unrecognized native converter response %p through GraphQL serialization',
      async (value) => {
        ctx.ibisServerAdaptor.getNativeSql.mockResolvedValue(value);
        const result = await read();
        expect(result.data).toBeNull();
        expect(result.errors[0].message).toBe('QUERY_EVIDENCE_UNAVAILABLE');
        expect(JSON.stringify(result.errors)).not.toContain(
          'undisclosed_native_detail',
        );
        expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['unchanged', 'revoked', 'generation'])(
      'applies the same current read authorization to an original converter error after %s',
      async (boundary) => {
        const original = authorize.getMockImplementation();
        const message = 'original-native-conversion-detail SELECT model11';
        ctx.ibisServerAdaptor.getNativeSql.mockImplementation(async () => {
          if (boundary === 'generation') generation += 1;
          if (boundary === 'revoked')
            authorize.mockImplementation(async (...input) => {
              if ((input[2] as any).resolveResource)
                throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
              return original(...input);
            });
          throw new Error(message);
        });
        const result = await read();
        expect(result.data).toBeNull();
        expect(result.errors).toBeDefined();
        expect(JSON.stringify(result.errors)).not.toContain(message);
        expect(result.errors[0].message).toBe(
          boundary === 'unchanged'
            ? 'QUERY_EVIDENCE_UNAVAILABLE'
            : boundary === 'revoked'
              ? 'QUERY_SCOPE_DENIED'
              : 'QUERY_REFERENCE_CHANGED',
        );
        expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('retains the original independent converter without invented platform provenance or scope', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete ctx.nativeIdentityScope;
      delete ctx.nativeHumanToken;
      delete captured.nativeObjectRefs;
      args = { responseId: 71 };
      expect((await read()).errors).toBeUndefined();
      expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
      expect(authorize).not.toHaveBeenCalled();
      expect(ctx.mdlService.makeCurrentModelMDL).toHaveBeenCalledTimes(1);
    });
    it('retains an original independent converter error without inventing bound delivery', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete ctx.nativeIdentityScope;
      delete ctx.nativeHumanToken;
      args = { responseId: 71 };
      const error = new Error('original independent converter error');
      ctx.ibisServerAdaptor.getNativeSql.mockRejectedValue(error);
      const result = await read();
      expect(result.data).toBeNull();
      expect(result.errors[0].message).toBe(error.message);
      expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
      expect(authorize).not.toHaveBeenCalled();
    });
    it('does not convert under invalid configured delivery or disclose a standalone conversion adopted by a new binding', async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
      jest
        .mocked(loadQueryDelivery)
        .mockRejectedValue(
          new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
        );
      expect((await read()).data).toBeNull();
      expect(ctx.ibisServerAdaptor.getNativeSql).not.toHaveBeenCalled();
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete ctx.nativeIdentityScope;
      delete ctx.nativeHumanToken;
      args = { responseId: 71 };
      ctx.ibisServerAdaptor.getNativeSql.mockImplementation(async () => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'new-controlled-binding';
        return 'SELECT secretConverted';
      });
      const result = await read();
      expect(result.errors).toBeDefined();
      expect(result.data).toBeNull();
      expect(ctx.ibisServerAdaptor.getNativeSql).toHaveBeenCalledTimes(1);
    });
  });

  it('returns the original complete diagram through its real builder after read authorizing every captured model and view', async () => {
    const { resolver: diagram } = diagramContext();
    const result = await diagram.getDiagram(null, {}, ctx);
    expect(result.models.map((model) => model.modelId)).toEqual([11, 13]);
    expect(result.models[0]).toMatchObject({
      referenceName: 'model11',
      sourceTableName: 'table11',
      fields: [{ columnId: 31, referenceName: 'id' }],
      relationFields: [{ relationId: 51, fromModelId: 11, toModelId: 13 }],
    });
    expect(result.views).toEqual([
      expect.objectContaining({
        viewId: 21,
        referenceName: 'originalView',
        fields: [expect.objectContaining({ referenceName: 'id' })],
      }),
    ]);
    expect(authorize.mock.calls.map((call) => [call[2], call[3]])).toEqual(
      [
        ['model', '11'],
        ['model', '13'],
        ['view', '21'],
        ['model', '11'],
        ['model', '13'],
        ['view', '21'],
      ].map(([nativeType, nativeRef]) => [
        {
          bindingId: config.bindingId,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.describe@v1',
            actionVersion: 1,
            nativeType,
            nativeRef,
          },
        },
        ctx.nativeHumanToken,
      ]),
    );
    expect(ctx.modelRepository.findAllBy).toHaveBeenCalledTimes(1);
    expect(ctx.viewRepository.findAllBy).toHaveBeenCalledTimes(1);
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });

  it.each(['model', 'view'])(
    'refuses the whole original diagram when one %s is denied instead of returning an incomplete or empty graph',
    async (kind) => {
      const { resolver: diagram } = diagramContext();
      authorize.mockImplementation(
        async (_config, _operation, request: any) => {
          if (request.resolveResource.nativeType === kind)
            throw new NativeQueryRefusal(
              403,
              'QUERY_ADMISSION_UNAVAILABLE',
              true,
            );
          return selected(request);
        },
      );
      await expect(diagram.getDiagram(null, {}, ctx)).rejects.toThrow(
        'QUERY_SCOPE_DENIED',
      );
      expect(
        ctx.modelColumnRepository.findColumnsByModelIds,
      ).not.toHaveBeenCalled();
    },
  );

  it('refuses diagram disclosure if read permission is revoked while its columns load', async () => {
    const { resolver: diagram, columns } = diagramContext();
    ctx.modelColumnRepository.findColumnsByModelIds.mockImplementation(
      async () => {
        authorize.mockRejectedValue(
          new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true),
        );
        return columns;
      },
    );
    await expect(diagram.getDiagram(null, {}, ctx)).rejects.toThrow(
      'QUERY_SCOPE_DENIED',
    );
  });

  it('keeps a genuinely empty diagram empty without querying unfiltered column or relation tables', async () => {
    const { resolver: diagram } = diagramContext();
    ctx.modelRepository.findAllBy.mockResolvedValue([]);
    ctx.viewRepository.findAllBy.mockResolvedValue([]);
    expect(await diagram.getDiagram(null, {}, ctx)).toEqual({
      models: [],
      views: [],
    });
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
    expect(
      ctx.modelNestedColumnRepository.findNestedColumnsByModelIds,
    ).not.toHaveBeenCalled();
    expect(ctx.relationRepository.findRelationInfoBy).not.toHaveBeenCalled();
  });

  it.each([
    'identity',
    'token',
    'project',
    'model',
    'view',
    'column',
    'relation',
  ])(
    'rejects missing or mixed diagram %s scope rather than feeding it to the original builder',
    async (fault) => {
      const {
        resolver: diagram,
        models,
        views,
        columns,
        relations,
      } = diagramContext();
      if (fault === 'identity') ctx.nativeIdentityScope = undefined;
      if (fault === 'token') ctx.nativeHumanToken = undefined;
      if (fault === 'project')
        ctx.projectRepository.getCurrentProject.mockResolvedValue({ id: 8 });
      if (fault === 'model') models[0].projectId = 8;
      if (fault === 'view') views[0].projectId = 8;
      if (fault === 'column') columns[0].modelId = 12;
      if (fault === 'relation') relations[0].projectId = 8;
      await expect(diagram.getDiagram(null, {}, ctx)).rejects.toBeInstanceOf(
        NativeQueryRefusal,
      );
    },
  );

  it('filters original model and view list consumers by each HUMAN read grant without changing their shape', async () => {
    const models = [
      { id: 11, projectId, properties: '{}' },
      { id: 13, projectId, properties: '{}' },
    ];
    const views = [
      {
        id: 21,
        projectId,
        name: 'allowed',
        properties: '{}',
        statement: 'SELECT original',
      },
      {
        id: 23,
        projectId,
        name: 'other',
        properties: '{}',
        statement: 'SELECT other',
      },
    ];
    ctx.modelRepository.findAllBy.mockResolvedValue(models);
    ctx.viewRepository.findAllBy.mockResolvedValue(views);
    authorize.mockImplementation(
      async (_config, operation, request: any, token) => {
        expect(operation).toBe('human-action');
        expect(request).toEqual({
          bindingId: config.bindingId,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.describe@v1',
            actionVersion: 1,
            nativeType: request.resolveResource.nativeType,
            nativeRef: request.resolveResource.nativeRef,
          },
        });
        const own =
          token === 'first-person-token' ? ['11', '21'] : ['13', '23'];
        if (!own.includes(request.resolveResource.nativeRef))
          throw new NativeQueryRefusal(
            403,
            'QUERY_ADMISSION_UNAVAILABLE',
            true,
          );
        return selected(request);
      },
    );
    expect(
      (await resolver.listModels(null, {}, ctx)).map((row) => row.id),
    ).toEqual([11]);
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).toHaveBeenCalledWith([11]);
    expect(await resolver.listViews(null, {}, ctx)).toEqual([
      { ...views[0], displayName: undefined },
    ]);
    const other = {
      ...ctx,
      nativeHumanToken: 'second-person-token',
      nativeIdentityScope: 'b'.repeat(64),
    };
    expect(
      (await resolver.listModels(null, {}, other)).map((row) => row.id),
    ).toEqual([13]);
    expect(
      (await resolver.listViews(null, {}, other)).map((row) => row.id),
    ).toEqual([23]);
  });
  it('refuses in-project model/view detail without object read permission before loading their body dependencies', async () => {
    authorize.mockRejectedValue(
      new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true),
    );
    await expect(
      resolver.getModel(null, { where: { id: 11 } }, ctx),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    await expect(
      resolver.getView(null, { where: { id: 21 } }, ctx),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
    expect(ctx.relationRepository.findRelationsBy).not.toHaveBeenCalled();
  });
  it('does not turn missing identity, unavailable authorization or malformed native facts into an empty successful list', async () => {
    ctx.modelRepository.findAllBy.mockResolvedValue([
      { id: 11, projectId, properties: '{}' },
    ]);
    await expect(
      resolver.listModels(null, {}, { ...ctx, nativeHumanToken: undefined }),
    ).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockRejectedValueOnce(
      new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE'),
    );
    await expect(resolver.listModels(null, {}, ctx)).rejects.toThrow(
      'QUERY_ADMISSION_UNAVAILABLE',
    );
    authorize.mockImplementationOnce(async (_config, _operation, request) => ({
      resource: {
        ...selected(request).resource,
        nativeRef: 'wrong-object',
      },
    }));
    await expect(resolver.listModels(null, {}, ctx)).rejects.toThrow(
      'QUERY_SCOPE_DENIED',
    );
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
  });
  it('does not disclose model data revoked while original column loading was in flight', async () => {
    ctx.modelRepository.findAllBy.mockResolvedValue([
      { id: 11, projectId, properties: '{}' },
    ]);
    ctx.modelColumnRepository.findColumnsByModelIds.mockImplementation(
      async () => {
        authorize.mockRejectedValue(
          new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true),
        );
        return [{ id: 31, modelId: 11, properties: '{}', type: 'STRING' }];
      },
    );
    expect(await resolver.listModels(null, {}, ctx)).toEqual([]);
    authorize.mockImplementation(async (_config, _operation, request) =>
      selected(request),
    );
    await expect(
      resolver.getModel(null, { where: { id: 11 } }, ctx),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
  });
  it('does not read an unfiltered column or relation table for an empty authorized model set', async () => {
    ctx.modelRepository.findAllBy.mockResolvedValue([
      { id: 11, projectId, properties: '{}' },
    ]);
    authorize.mockRejectedValue(
      new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true),
    );
    expect(await resolver.listModels(null, {}, ctx)).toEqual([]);
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
    authorize.mockImplementation(async (_config, _operation, request) =>
      selected(request),
    );
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([]);
    expect(
      (await resolver.getModel(null, { where: { id: 11 } }, ctx)).relations,
    ).toEqual([]);
    expect(ctx.relationRepository.findRelationsBy).not.toHaveBeenCalled();
  });
  it('does not use readable model detail to expose a relationship to another denied model', async () => {
    ctx.modelRepository.findOneBy.mockImplementation(
      async ({ id, projectId: requested }) =>
        requested === projectId && [11, 13].includes(id)
          ? { id, projectId, properties: '{}' }
          : null,
    );
    ctx.modelColumnRepository.findOneBy.mockResolvedValue({
      id: 33,
      modelId: 13,
    });
    const relation = {
      id: 51,
      projectId,
      fromColumnId: 31,
      toColumnId: 33,
      joinType: 'ONE_TO_MANY',
      properties: '{}',
    };
    ctx.relationRepository.findRelationsBy.mockResolvedValue([relation]);
    authorize.mockImplementation(async (_config, _operation, request: any) => {
      if (request.resolveResource.nativeRef === '13')
        throw new NativeQueryRefusal(403, 'QUERY_ADMISSION_UNAVAILABLE', true);
      return selected(request);
    });
    expect(
      (await resolver.getModel(null, { where: { id: 11 } }, ctx)).relations,
    ).toEqual([]);
    authorize.mockImplementation(async (_config, _operation, request) =>
      selected(request),
    );
    expect(
      (await resolver.getModel(null, { where: { id: 11 } }, ctx)).relations,
    ).toEqual([{ ...relation, type: relation.joinType, properties: {} }]);
  });
  it.each([{ columnId: null }, {}])(
    'preserves nullable and omitted columnId naming input %j',
    async (optional) => {
      expect(
        await resolver.validateCalculatedField(
          null,
          { data: { name: 'original', modelId: 11, ...optional } },
          ctx,
        ),
      ).toEqual({ valid: true });
      expect(ctx.modelColumnRepository.findOneBy).not.toHaveBeenCalled();
      expect(
        ctx.modelService.validateCalculatedFieldNaming,
      ).toHaveBeenCalledWith(
        'original',
        11,
        'columnId' in optional ? null : undefined,
      );
    },
  );
  it.each([
    'getModel',
    'deleteModel',
    'previewModelData',
    'updateModelMetadata',
  ])(
    '%s refuses an ID from another native project before disclosure or mutation',
    async (method) => {
      await expect(
        resolver[method](null, { where: { id: 12 }, data: {} }, ctx),
      ).rejects.toThrow('Model not found');
      expect(ctx.modelRepository.findOneBy).toHaveBeenCalledWith({
        id: 12,
        projectId,
      });
      expect(ctx.modelRepository.deleteOne).not.toHaveBeenCalled();
      expect(ctx.modelRepository.updateOne).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    },
  );
  it.each(['getView', 'deleteView', 'updateViewMetadata'])(
    '%s checks the same project as the view list',
    async (method) => {
      await expect(
        resolver[method](null, { where: { id: 22 }, data: {} }, ctx),
      ).rejects.toThrow('View not found');
      expect(ctx.viewRepository.findOneBy).toHaveBeenCalledWith({
        id: 22,
        projectId,
      });
      expect(ctx.viewRepository.deleteOne).not.toHaveBeenCalled();
      expect(ctx.viewRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it('keeps the original in-project view read, update and delete usable', async () => {
    expect(
      await resolver.getView(null, { where: { id: 21 } }, ctx),
    ).toMatchObject({ id: 21, displayName: undefined });
    expect(
      await resolver.updateViewMetadata(
        null,
        {
          where: { id: 21 },
          data: {
            displayName: 'original',
            columns: [],
            description: 'original edit',
          },
        },
        ctx,
      ),
    ).toBe(true);
    expect(ctx.viewRepository.updateOne).toHaveBeenCalledWith(21, {
      name: 'original',
      properties: '{"displayName":"original","description":"original edit"}',
    });
    expect(await resolver.deleteView(null, { where: { id: 21 } }, ctx)).toBe(
      true,
    );
    expect(ctx.viewRepository.deleteOne).toHaveBeenCalledWith(21);
  });
  it.each(['columns', 'calculatedFields', 'nestedColumns', 'relationships'])(
    'does not use an allowed model to modify foreign %s',
    async (field) => {
      const id =
        field === 'nestedColumns' ? 41 : field === 'relationships' ? 51 : 32;
      await expect(
        resolver.updateModelMetadata(
          null,
          {
            where: { id: 11 },
            data: {
              displayName: 'must not write',
              description: '',
              columns: [],
              calculatedFields: [],
              nestedColumns: [],
              relationships: [],
              [field]: [{ id }],
            },
          },
          ctx,
        ),
      ).rejects.toThrow('not found');
      expect(ctx.modelRepository.updateOne).not.toHaveBeenCalled();
      expect(ctx.modelColumnRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(['createCalculatedField', 'updateCalculatedField'])(
    '%s checks every relationship in a lineage even when its final column is allowed',
    async (method) => {
      await expect(
        resolver[method](
          null,
          {
            where: { id: 31 },
            data: {
              modelId: 11,
              name: 'original',
              expression: 'SUM',
              lineage: [51, 31],
            },
          },
          ctx,
        ),
      ).rejects.toThrow('Relation not found');
      expect(ctx.modelService[method]).not.toHaveBeenCalled();
      expect(ctx.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
    },
  );
  it('refuses calculated-field, relation and MDL references from another project', async () => {
    await expect(
      resolver.deleteCalculatedField(null, { where: { id: 32 } }, ctx),
    ).rejects.toThrow('Column not found');
    await expect(
      resolver.updateRelation(
        null,
        { where: { id: 51 }, data: { type: 'ONE_TO_ONE' } } as any,
        ctx,
      ),
    ).rejects.toThrow('Relation not found');
    await expect(
      resolver.deleteRelation(null, { where: { id: 51 } }, ctx),
    ).rejects.toThrow('Relation not found');
    await expect(
      resolver.getMDL(null, { hash: 'foreign-hash' }, ctx),
    ).rejects.toThrow('Deployment not found');
    expect(ctx.modelService.updateRelation).not.toHaveBeenCalled();
    expect(ctx.modelService.deleteRelation).not.toHaveBeenCalled();
    expect(ctx.deployRepository.findOneBy).toHaveBeenCalledWith({
      hash: 'foreign-hash',
      projectId,
    });
  });
  const historicalDeployment = () => {
    const nativeObjectRefs = [
      { nativeType: 'model', nativeId: 111, nativeName: 'oldModel' },
      { nativeType: 'view', nativeId: 121, nativeName: 'oldView' },
    ];
    const manifest = {
      catalog: 'original',
      schema: 'original',
      models: [{ name: 'oldModel' }],
      views: [{ name: 'oldView', properties: { viewId: '121' } }],
    };
    const row = {
      id: 71,
      projectId,
      hash: 'old-hash',
      manifest,
      nativeObjectRefs,
    };
    ctx.deployRepository = repository([row]);
    return row;
  };
  it('reads the original historical manifest with its captured native IDs, not same-name current models', async () => {
    const row = historicalDeployment();
    expect(await resolver.getMDL(null, { hash: row.hash }, ctx)).toEqual({
      hash: row.hash,
      mdl: Buffer.from(JSON.stringify(row.manifest)).toString('base64'),
    });
    expect(authorize.mock.calls.map((call) => call[2].resolveResource)).toEqual(
      ['111', '121', '111', '121'].map((nativeRef) => ({
        workspaceId: config.workspaceId,
        actionKey: 'data_query.describe@v1',
        actionVersion: 1,
        nativeType: nativeRef === '111' ? 'model' : 'view',
        nativeRef,
      })),
    );
    expect(ctx.modelRepository.findAllBy).not.toHaveBeenCalled();
    expect(ctx.deployRepository.findOneBy).toHaveBeenLastCalledWith({
      id: row.id,
      hash: row.hash,
      projectId,
    });
  });
  it('does not infer legacy deployment IDs from current same-name rows', async () => {
    const row = historicalDeployment();
    row.nativeObjectRefs = null;
    await expect(
      resolver.getMDL(null, { hash: row.hash }, ctx),
    ).rejects.toMatchObject({
      status: 503,
      code: 'QUERY_EVIDENCE_UNAVAILABLE',
    });
    expect(authorize).not.toHaveBeenCalled();
  });
  it.each([
    (row) => row.nativeObjectRefs.pop(),
    (row) => {
      row.nativeObjectRefs[1].nativeId = 122;
    },
    (row) => {
      row.nativeObjectRefs[0].nativeName = 'currentSameName';
    },
    (row) => row.nativeObjectRefs.push({ ...row.nativeObjectRefs[0] }),
  ])(
    'refuses an incomplete or conflicting historical native mapping',
    async (alter) => {
      const row = historicalDeployment();
      alter(row);
      await expect(
        resolver.getMDL(null, { hash: row.hash }, ctx),
      ).rejects.toMatchObject({
        status: 503,
        code: 'QUERY_EVIDENCE_UNAVAILABLE',
      });
      expect(authorize).not.toHaveBeenCalled();
    },
  );
  it('refuses historical metadata when one captured resource is denied or later revoked', async () => {
    const row = historicalDeployment();
    authorize.mockImplementationOnce(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockRejectedValueOnce(
      new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
    );
    await expect(
      resolver.getMDL(null, { hash: row.hash }, ctx),
    ).rejects.toMatchObject({ status: 403 });
    authorize.mockReset();
    authorize.mockImplementation(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockImplementationOnce(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockImplementationOnce(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockRejectedValueOnce(
      new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
    );
    await expect(
      resolver.getMDL(null, { hash: row.hash }, ctx),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('does not disclose history after the same resource changes its authorized version', async () => {
    const row = historicalDeployment();
    authorize.mockImplementationOnce(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockImplementationOnce(async (_config, _operation, request) =>
      selected(request),
    );
    authorize.mockImplementationOnce(async (_config, _operation, request) => ({
      resource: { ...selected(request).resource, resourceVersion: 2 },
    }));
    await expect(
      resolver.getMDL(null, { hash: row.hash }, ctx),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('does not disclose history after the persisted manifest changes during authorization', async () => {
    const row = historicalDeployment();
    authorize.mockImplementationOnce(async (_config, _operation, request) => {
      row.manifest.catalog = 'changed-after-capture';
      return selected(request);
    });
    await expect(
      resolver.getMDL(null, { hash: row.hash }, ctx),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('saved-view response consumers cannot follow a response into a foreign project thread', async () => {
    const service = Object.assign(Object.create(AskingService.prototype), {
      projectService: ctx.projectService,
      threadResponseRepository: repository([
        { id: 71, threadId: 81 },
        { id: 72, threadId: 82 },
      ]),
      threadRepository: repository([
        { id: 81, projectId },
        { id: 82, projectId: 8 },
      ]),
    });
    expect(await service.getResponse(71)).toEqual({ id: 71, threadId: 81 });
    expect(await service.getResponse(72)).toBeNull();
  });
  it('the original AI preview cannot select a foreign project in a bound deployment', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'configured-by-delivery';
    try {
      await expect(
        resolver.previewSql(
          null,
          { data: { projectId: '8', sql: 'SELECT 1' } } as any,
          ctx,
        ),
      ).rejects.toThrow('Project not found');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    } finally {
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it('dashboard creation does not combine an old dashboard with a newly selected project', async () => {
    ctx.dashboardService = {
      getCurrentDashboard: jest.fn(async () => ({ id: 91, projectId: 8 })),
      createDashboardItem: jest.fn(),
    };
    ctx.askingService = { getResponse: jest.fn() };
    await expect(
      new DashboardResolver().createDashboardItem(
        null,
        { data: { responseId: 71, itemType: 'BAR' } } as any,
        ctx,
      ),
    ).rejects.toThrow('Dashboard not found');
    expect(ctx.askingService.getResponse).not.toHaveBeenCalled();
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(ctx.dashboardService.createDashboardItem).not.toHaveBeenCalled();
  });

  const asking = () => {
    const threadRepository = repository([
      { id: 81, projectId },
      { id: 82, projectId: 8 },
    ]);
    Object.assign(threadRepository, {
      listAllTimeDescOrder: jest.fn(async (id) =>
        id === projectId ? [{ id: 81, projectId }] : [],
      ),
    });
    const threadResponseRepository = repository([
      { id: 71, threadId: 81, question: 'original', sql: 'SELECT 1' },
      { id: 72, threadId: 82, sql: 'SELECT 2' },
    ]);
    Object.assign(threadResponseRepository, {
      getResponsesWithThread: jest.fn(async () => [{ id: 71, threadId: 81 }]),
    });
    return Object.assign(Object.create(AskingService.prototype), {
      projectService: ctx.projectService,
      threadRepository,
      threadResponseRepository,
      deployService: {
        getLastDeployment: jest.fn(async () => ({ hash: 'bound' })),
      },
      askingTaskTracker: { createAskingTask: jest.fn() },
    });
  };

  it.each([
    'getThreadRecommendationQuestions',
    'generateThreadRecommendationQuestions',
    'getResponsesWithThread',
    'deleteThread',
  ])(
    '%s refuses foreign threads before reading answers or modifying state',
    async (method) => {
      const service = asking();
      await expect(service[method](82)).rejects.toThrow('Thread 82 not found');
      expect(
        service.threadResponseRepository.getResponsesWithThread,
      ).not.toHaveBeenCalled();
      expect(service.threadRepository.deleteOne).not.toHaveBeenCalled();
    },
  );
  it('foreign thread updates, response creation and follow-up history cannot enter native writes or dispatch', async () => {
    const service = asking();
    await expect(
      service.updateThread(82, { summary: 'foreign' }),
    ).rejects.toThrow('Thread 82 not found');
    await expect(
      service.createThreadResponse({ question: 'foreign' }, 82),
    ).rejects.toThrow('Thread 82 not found');
    await expect(
      service.createAskingTask(
        { question: 'foreign' },
        { threadId: 82, language: 'en' },
      ),
    ).rejects.toThrow('Thread 82 not found');
    expect(service.threadRepository.updateOne).not.toHaveBeenCalled();
    expect(service.threadResponseRepository.createOne).not.toHaveBeenCalled();
    expect(service.askingTaskTracker.createAskingTask).not.toHaveBeenCalled();
  });
  it.each([
    ['rerunAskingTask', {}],
    ['updateThreadResponse', { sql: 'SELECT 3' }],
    ['generateThreadResponseBreakdown', { language: 'en' }],
    ['generateThreadResponseAnswer', undefined],
    ['generateThreadResponseChart', { language: 'en' }],
    ['adjustThreadResponseChart', {}],
    ['changeThreadResponseAnswerDetailStatus', 'FINISHED'],
    ['adjustThreadResponseWithSQL', { sql: 'SELECT 3' }],
    ['adjustThreadResponseAnswer', { projectId }],
    ['rerunAdjustThreadResponseAnswer', projectId],
  ])(
    '%s resolves answer ownership before native execution',
    async (method, payload) => {
      const service = asking();
      await expect(service[method as string](72, payload)).rejects.toThrow(
        'Thread response 72 not found',
      );
      expect(service.threadResponseRepository.updateOne).not.toHaveBeenCalled();
      expect(service.threadResponseRepository.createOne).not.toHaveBeenCalled();
    },
  );
  it('preserves the original in-project thread list/read/edit and answer SQL clone', async () => {
    const service = asking();
    expect(await service.listThreads()).toEqual([{ id: 81, projectId }]);
    expect(await service.getResponsesWithThread(81)).toEqual([
      { id: 71, threadId: 81 },
    ]);
    await service.updateThread(81, { summary: 'original edit' });
    expect(service.threadRepository.updateOne).toHaveBeenCalledWith(81, {
      summary: 'original edit',
    });
    await service.createThreadResponse(
      { question: 'follow-up', sql: 'SELECT 3' },
      81,
    );
    expect(service.threadResponseRepository.createOne).toHaveBeenCalledWith(
      {
        threadId: 81,
        question: 'follow-up',
        sql: 'SELECT 3',
        askingTaskId: undefined,
      },
      { tx: expect.anything() },
    );
    await service.adjustThreadResponseWithSQL(71, { sql: 'SELECT 3' });
    expect(service.threadResponseRepository.createOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 81,
        question: 'original',
        sql: 'SELECT 3',
      }),
    );
  });

  describe('original native text answer consumes a disclosed query history', () => {
    const originalDelivery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    beforeEach(() => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    });
    afterEach(() => {
      if (originalDelivery === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalDelivery;
    });
    const fixture = async () => {
      const service = asking();
      const expected = await service.getResponse(71);
      let current = expected;
      service.threadResponseRepository.findOneBy.mockImplementation(
        async () => current,
      );
      service.threadResponseRepository.claimNativeAnswer = jest.fn(
        async (snapshot, answerDetail) => {
          if (JSON.stringify(snapshot) !== JSON.stringify(current)) return null;
          current = { ...current, answerDetail };
          return current;
        },
      );
      service.wrenAIAdaptor = {
        createTextBasedAnswer: jest.fn(async (input) => ({
          queryId: input.queryId,
        })),
        getTextBasedAnswerResult: jest.fn(async () => ({
          status: 'PREPROCESSING',
        })),
      };
      service.textBasedAnswerBackgroundTracker = { addTask: jest.fn() };
      return {
        service,
        input: {
          language: 'zh-TW',
          nativeQuery: {
            historyId: 'original-query-history',
            expected,
            data: { columns: [{ name: 'value', type: 'int' }], data: [[7]] },
          },
        },
      };
    };
    it('passes the exact current HUMAN query data to original AI and joins the same original task', async () => {
      const { service, input } = await fixture();
      const first = await service.generateThreadResponseAnswer(71, input);
      expect(first.answerDetail).toEqual({
        queryHistoryId: 'original-query-history',
        queryId: expect.any(String),
        status: 'PREPROCESSING',
      });
      expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith({
        queryId: first.answerDetail.queryId,
        query: 'original',
        sql: 'SELECT 1',
        sqlData: input.nativeQuery.data,
        threadId: '81',
        configurations: { language: 'zh-TW' },
      });
      await service.generateThreadResponseAnswer(71, input);
      expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
        1,
      );
    });
    it('never retries an AI create after a lost response and retains the original query history', async () => {
      const { service, input } = await fixture();
      service.wrenAIAdaptor.createTextBasedAnswer.mockRejectedValue(
        new Error('lost acknowledgement'),
      );
      await expect(
        service.generateThreadResponseAnswer(71, input),
      ).rejects.toThrow('lost acknowledgement');
      expect(
        (await service.generateThreadResponseAnswer(71, input)).answerDetail,
      ).toEqual({
        queryHistoryId: 'original-query-history',
        queryId: expect.any(String),
        status: 'PREPROCESSING',
      });
      expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
        1,
      );
      expect(
        service.textBasedAnswerBackgroundTracker.addTask,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          answerDetail: expect.objectContaining({
            queryId: expect.any(String),
          }),
        }),
      );
    });
    it('persists the exact native ID before dispatch and never adopts a foreign acknowledgement', async () => {
      const { service, input } = await fixture();
      service.wrenAIAdaptor.createTextBasedAnswer.mockImplementation(
        async (request) => {
          const stored = await service.getResponse(71);
          expect(stored.answerDetail.queryId).toBe(request.queryId);
          expect(
            service.textBasedAnswerBackgroundTracker.addTask,
          ).toHaveBeenCalledWith(stored);
          return { queryId: 'foreign-native-id' };
        },
      );
      await expect(
        service.generateThreadResponseAnswer(71, input),
      ).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      const stored = await service.getResponse(71);
      expect(stored.answerDetail.queryId).not.toBe('foreign-native-id');
      expect(await service.generateThreadResponseAnswer(71, input)).toEqual(
        stored,
      );
      expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
        1,
      );
    });
    it('converges a lost create acknowledgement through the original text tracker without rerunning SQL or POST', async () => {
      const { service, input } = await fixture();
      let tick: () => Promise<void>;
      const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
        callback,
      ) => {
        tick = callback;
        return 1;
      }) as any);
      const queryService: any = { preview: jest.fn() };
      const tracker = new TextBasedAnswerBackgroundTracker({
        wrenAIAdaptor: service.wrenAIAdaptor,
        threadResponseRepository: service.threadResponseRepository,
        projectService: {} as any,
        deployService: {} as any,
        queryService,
      });
      interval.mockRestore();
      service.textBasedAnswerBackgroundTracker = tracker;
      service.wrenAIAdaptor.createTextBasedAnswer.mockRejectedValue(
        new Error('lost acknowledgement'),
      );
      await expect(
        service.generateThreadResponseAnswer(71, input),
      ).rejects.toThrow('lost acknowledgement');
      const stored = await service.getResponse(71);
      service.wrenAIAdaptor.getTextBasedAnswerResult.mockRejectedValueOnce(
        new Error('native ID not observable'),
      );
      await expect(
        service.generateThreadResponseAnswer(71, input),
      ).rejects.toThrow('native ID not observable');
      service.wrenAIAdaptor.getTextBasedAnswerResult.mockResolvedValue({
        status: 'SUCCEEDED',
      });
      expect(await service.generateThreadResponseAnswer(71, input)).toEqual(
        stored,
      );
      await tick();
      await new Promise((resolve) => setImmediate(resolve));
      const updated = await service.getResponse(71);
      expect(updated.answerDetail).toEqual(
        expect.objectContaining({
          queryId: stored.answerDetail.queryId,
          queryHistoryId: input.nativeQuery.historyId,
          status: 'STREAMING',
        }),
      );
      expect(
        service.wrenAIAdaptor.getTextBasedAnswerResult.mock.calls.every(
          ([id]) => id === stored.answerDetail.queryId,
        ),
      ).toBe(true);
      expect(service.wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledTimes(
        1,
      );
      expect(queryService.preview).not.toHaveBeenCalled();
      expect(tracker.getTasks()[71]).toBeUndefined();
    });
    it.each(['missing', 'changed-sql', 'concurrent-replacement'])(
      'refuses %s before sending original AI data',
      async (failure) => {
        const { service, input } = await fixture();
        if (failure === 'changed-sql')
          input.nativeQuery.expected = {
            ...input.nativeQuery.expected,
            sql: 'SELECT 2',
          };
        if (failure === 'concurrent-replacement')
          service.threadResponseRepository.claimNativeAnswer.mockResolvedValue(
            null,
          );
        await expect(
          service.generateThreadResponseAnswer(
            71,
            failure === 'missing' ? undefined : input,
          ),
        ).rejects.toThrow();
        expect(
          service.wrenAIAdaptor.createTextBasedAnswer,
        ).not.toHaveBeenCalled();
        expect(
          service.textBasedAnswerBackgroundTracker.addTask,
        ).not.toHaveBeenCalled();
      },
    );
  });
  describe('original native charts consume the same disclosed query history', () => {
    const originalDelivery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    beforeEach(() => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    });
    afterEach(() => {
      if (originalDelivery === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalDelivery;
    });
    const fixture = async (adjustment = false) => {
      const service = asking();
      const expected = {
        ...(await service.getResponse(71)),
        chartDetail: adjustment
          ? {
              queryId: 'previous-chart',
              status: 'FINISHED',
              chartSchema: { mark: 'bar' },
            }
          : null,
      };
      let current = expected;
      service.threadResponseRepository.findOneBy.mockImplementation(
        async () => current,
      );
      service.threadResponseRepository.claimNativeChart = jest.fn(
        async (snapshot, chartDetail) => {
          if (JSON.stringify(snapshot) !== JSON.stringify(current)) return null;
          current = { ...current, chartDetail };
          return current;
        },
      );
      service.wrenAIAdaptor = {
        generateChart: jest.fn(async (input) => ({
          queryId: input.queryId,
        })),
        adjustChart: jest.fn(async (input) => ({ queryId: input.queryId })),
        getChartResult: jest.fn(async () => ({ status: 'GENERATING' })),
        getChartAdjustmentResult: jest.fn(async () => ({
          status: 'GENERATING',
        })),
      };
      service.chartBackgroundTracker = { addTask: jest.fn() };
      service.chartAdjustmentBackgroundTracker = { addTask: jest.fn() };
      const input = {
        language: 'zh-TW',
        nativeQuery: {
          historyId: 'original-chart-history',
          expected,
          data: { columns: [{ name: 'value', type: 'int' }], data: [[7]] },
        },
      };
      const option = { chartType: 'LINE', xAxis: 'value' };
      const run = (config = input) =>
        adjustment
          ? service.adjustThreadResponseChart(71, option, config)
          : service.generateThreadResponseChart(71, config);
      return { service, input, option, run };
    };
    it.each([false, true])(
      'passes disclosed data to the original chart API and rejoins it, adjustment=%s',
      async (adjustment) => {
        const { service, input, option, run } = await fixture(adjustment);
        const first = await run();
        const create = adjustment
          ? service.wrenAIAdaptor.adjustChart
          : service.wrenAIAdaptor.generateChart;
        expect(create).toHaveBeenCalledWith({
          queryId: first.chartDetail.queryId,
          query: 'original',
          sql: 'SELECT 1',
          data: input.nativeQuery.data,
          configurations: { language: 'zh-TW' },
          ...(adjustment
            ? { adjustmentOption: option, chartSchema: { mark: 'bar' } }
            : {}),
        });
        expect(first.chartDetail.queryHistoryId).toBe(
          input.nativeQuery.historyId,
        );
        expect(first.chartDetail.queryId).toMatch(
          /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
        );
        await run();
        expect(create).toHaveBeenCalledTimes(1);
        expect(
          service.threadResponseRepository.updateOne,
        ).not.toHaveBeenCalled();
      },
    );
    it.each([false, true])(
      'keeps the original claim without repeating a lost create, adjustment=%s',
      async (adjustment) => {
        const { service, run } = await fixture(adjustment);
        const create = adjustment
          ? service.wrenAIAdaptor.adjustChart
          : service.wrenAIAdaptor.generateChart;
        create.mockRejectedValue(
          new Error('lost native chart acknowledgement'),
        );
        await expect(run()).rejects.toThrow(
          'lost native chart acknowledgement',
        );
        expect((await run()).chartDetail).toEqual(
          expect.objectContaining({
            queryHistoryId: 'original-chart-history',
            queryId: expect.any(String),
            status: 'GENERATING',
          }),
        );
        expect(create).toHaveBeenCalledTimes(1);
        const tracker = adjustment
          ? service.chartAdjustmentBackgroundTracker
          : service.chartBackgroundTracker;
        expect(tracker.addTask).toHaveBeenCalledWith(
          expect.objectContaining({
            chartDetail: expect.objectContaining({
              queryId: expect.any(String),
            }),
          }),
        );
      },
    );
    it.each([
      'missing',
      'changed-sql',
      'changed-chart',
      'concurrent-replacement',
    ])('refuses %s before creating a native chart', async (failure) => {
      const { service, input } = await fixture();
      if (failure === 'changed-sql')
        input.nativeQuery.expected = {
          ...input.nativeQuery.expected,
          sql: 'SELECT 2',
        };
      if (failure === 'changed-chart')
        input.nativeQuery.expected = {
          ...input.nativeQuery.expected,
          chartDetail: { status: 'FINISHED' },
        };
      if (failure === 'concurrent-replacement')
        service.threadResponseRepository.claimNativeChart.mockResolvedValue(
          null,
        );
      await expect(
        service.generateThreadResponseChart(
          71,
          failure === 'missing' ? { language: 'en' } : input,
        ),
      ).rejects.toThrow();
      expect(service.wrenAIAdaptor.generateChart).not.toHaveBeenCalled();
    });
    it.each([false, true])(
      'persists the native ID before dispatch and refuses a foreign chart acknowledgement, adjustment=%s',
      async (adjustment) => {
        const { service, run } = await fixture(adjustment);
        const create = adjustment
          ? service.wrenAIAdaptor.adjustChart
          : service.wrenAIAdaptor.generateChart;
        const tracker = adjustment
          ? service.chartAdjustmentBackgroundTracker
          : service.chartBackgroundTracker;
        create.mockImplementation(async (request) => {
          const stored = await service.getResponse(71);
          expect(stored.chartDetail.queryId).toBe(request.queryId);
          expect(tracker.addTask).toHaveBeenCalledWith(stored);
          return { queryId: 'foreign-native-id' };
        });
        await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
        const stored = await service.getResponse(71);
        expect(stored.chartDetail.queryId).not.toBe('foreign-native-id');
        expect(await run()).toEqual(stored);
        expect(create).toHaveBeenCalledTimes(1);
      },
    );
    it.each([false, true])(
      'converges the lost native chart acknowledgement via the original tracker, adjustment=%s',
      async (adjustment) => {
        const { service, run } = await fixture(adjustment);
        let tick: () => Promise<void>;
        const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
          callback,
        ) => {
          tick = callback;
          return 1;
        }) as any);
        const Constructor = adjustment
          ? ChartAdjustmentBackgroundTracker
          : ChartBackgroundTracker;
        const tracker = new Constructor({
          wrenAIAdaptor: service.wrenAIAdaptor,
          threadResponseRepository: service.threadResponseRepository,
          telemetry: { sendEvent: jest.fn() } as any,
        });
        interval.mockRestore();
        if (adjustment) service.chartAdjustmentBackgroundTracker = tracker;
        else service.chartBackgroundTracker = tracker;
        const create = adjustment
          ? service.wrenAIAdaptor.adjustChart
          : service.wrenAIAdaptor.generateChart;
        const observe = adjustment
          ? service.wrenAIAdaptor.getChartAdjustmentResult
          : service.wrenAIAdaptor.getChartResult;
        create.mockRejectedValue(new Error('lost acknowledgement'));
        await expect(run()).rejects.toThrow('lost acknowledgement');
        const stored = await service.getResponse(71);
        observe.mockResolvedValueOnce({ status: 'UNKNOWN' });
        await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
        observe.mockResolvedValue({
          status: 'FINISHED',
          response: {
            reasoning: 'original chart',
            chartType: 'line',
            chartSchema: { mark: 'line' },
          },
        });
        expect(await run()).toEqual(stored);
        await tick();
        expect((await service.getResponse(71)).chartDetail).toEqual(
          expect.objectContaining({
            queryId: stored.chartDetail.queryId,
            queryHistoryId: 'original-chart-history',
            status: 'FINISHED',
            chartSchema: { mark: 'line' },
          }),
        );
        expect(
          observe.mock.calls.every(([id]) => id === stored.chartDetail.queryId),
        ).toBe(true);
        expect(create).toHaveBeenCalledTimes(1);
        expect(tracker.getTasks()[71]).toBeUndefined();
        expect(
          service.threadResponseRepository.updateOne,
        ).not.toHaveBeenCalled();
      },
    );
    it('does not reuse an existing history for a different adjustment or generation', async () => {
      const { service, input, run } = await fixture(true);
      await run();
      await expect(
        service.adjustThreadResponseChart(71, { chartType: 'PIE' }, input),
      ).rejects.toThrow('NATIVE_OBJECT_CHANGED');
      await expect(
        service.generateThreadResponseChart(71, input),
      ).rejects.toThrow();
      expect(service.wrenAIAdaptor.adjustChart).toHaveBeenCalledTimes(1);
      expect(service.wrenAIAdaptor.generateChart).not.toHaveBeenCalled();
    });
  });
  it('thread recommendation builds its MDL from the same selected project before original dispatch', async () => {
    const service = asking();
    service.threadRecommendQuestionBackgroundTracker = {
      isExist: jest.fn(() => false),
      addTask: jest.fn(),
    };
    service.mdlService = {
      makeCurrentModelMDL: jest.fn(async () => ({ manifest: {} })),
    };
    service.wrenAIAdaptor = {
      generateRecommendationQuestions: jest.fn(async () => ({
        queryId: 'native-query',
      })),
    };
    await service.generateThreadRecommendationQuestions(81);
    expect(service.mdlService.makeCurrentModelMDL).toHaveBeenCalledWith({
      id: projectId,
    });
    expect(
      service.wrenAIAdaptor.generateRecommendationQuestions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: String(projectId) }),
    );
    expect(service.threadRepository.updateOne).toHaveBeenCalledWith(
      81,
      expect.objectContaining({ queryId: 'native-query' }),
    );
    expect(
      service.threadRecommendQuestionBackgroundTracker.addTask,
    ).toHaveBeenCalledTimes(1);
    expect(ctx.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
  });
  it('instant recommendations retain the native current-project retrieval scope', async () => {
    const service = asking();
    service.deployService.getLastDeployment.mockResolvedValue({
      manifest: { models: [] },
    });
    service.wrenAIAdaptor = {
      generateRecommendationQuestions: jest.fn(async () => ({
        queryId: 'native-recommendation',
      })),
    };
    await service.createInstantRecommendedQuestions({
      previousQuestions: ['original question'],
    });
    expect(service.deployService.getLastDeployment).toHaveBeenCalledWith(
      projectId,
    );
    expect(
      service.wrenAIAdaptor.generateRecommendationQuestions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: String(projectId),
        previousQuestions: ['original question'],
      }),
    );
  });
  it('project recommendations retain the exact selected MDL/project and native regeneration input', async () => {
    const service = Object.assign(Object.create(ProjectService.prototype), {
      getCurrentProject: ctx.projectService.getCurrentProject,
      mdlService: {
        makeCurrentModelMDL: jest.fn(async () => ({
          manifest: { models: [] },
        })),
      },
      wrenAIAdaptor: {
        generateRecommendationQuestions: jest.fn(async () => ({
          queryId: 'native-recommendation',
        })),
      },
      projectRepository: {
        updateOne: jest.fn(async () => ({ id: projectId })),
      },
      projectRecommendQuestionBackgroundTracker: { addTask: jest.fn() },
    });
    await service.generateProjectRecommendationQuestions();
    expect(service.mdlService.makeCurrentModelMDL).toHaveBeenCalledWith({
      id: projectId,
    });
    expect(
      service.wrenAIAdaptor.generateRecommendationQuestions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: String(projectId),
        regenerate: true,
      }),
    );
    expect(service.projectRepository.updateOne).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ queryId: 'native-recommendation' }),
    );
  });
  it('the original MDL builder consumes the selected project instead of re-reading another current project', async () => {
    const projectRepository = {
      getCurrentProject: jest.fn(async () => ({
        id: 8,
        catalog: 'foreign',
        schema: 'foreign',
      })),
    };
    const modelRepository = repository([]);
    const service = new MDLService({
      projectRepository,
      modelRepository,
      modelColumnRepository: { findColumnsByModelIds: jest.fn(async () => []) },
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn(async () => []),
      },
      relationRepository: { findRelationInfoBy: jest.fn(async () => []) },
      viewRepository: repository([]),
    } as any);
    const { manifest } = await service.makeCurrentModelMDL({
      id: projectId,
      type: 'DUCKDB',
      catalog: 'bound',
      schema: 'bound',
    } as any);
    expect(manifest.catalog).toBe('bound');
    expect(modelRepository.findAllBy).toHaveBeenCalledWith({ projectId });
    expect(projectRepository.getCurrentProject).not.toHaveBeenCalled();
  });
  it('captures the same native rows used by the original MDL builder without changing its manifest', async () => {
    diagramContext();
    const service = new MDLService(ctx as any);
    const { manifest, nativeObjectRefs } = await service.makeCurrentModelMDL({
      id: projectId,
      type: 'DUCKDB',
      catalog: 'bound',
      schema: 'bound',
    } as any);
    expect(nativeObjectRefs).toEqual([
      { nativeType: 'model', nativeId: 11, nativeName: 'model11' },
      { nativeType: 'model', nativeId: 13, nativeName: 'model13' },
      { nativeType: 'view', nativeId: 21, nativeName: 'originalView' },
    ]);
    expect(manifest.models.map((model) => model.name)).toEqual([
      'model11',
      'model13',
    ]);
    expect(manifest.views).toEqual([
      expect.objectContaining({
        name: 'originalView',
        properties: expect.objectContaining({ viewId: '21' }),
      }),
    ]);
    expect(manifest).not.toHaveProperty('nativeObjectRefs');
    expect(ctx.projectRepository.getCurrentProject).not.toHaveBeenCalled();
  });

  const dashboard = () => {
    const dashboardRepository = repository([
      { id: 81, projectId },
      { id: 82, projectId: 8 },
    ]);
    const dashboardItemRepository = repository([
      { id: 91, dashboardId: 81, layout: { y: 0, h: 1 } },
      { id: 92, dashboardId: 82, detail: { sql: 'SELECT 2' } },
    ]);
    const service = new DashboardService({
      projectService: ctx.projectService,
      dashboardRepository,
      dashboardItemRepository,
    } as any);
    return { service, dashboardRepository, dashboardItemRepository };
  };
  it.each(['getDashboardItem', 'deleteDashboardItem', 'updateDashboardItem'])(
    '%s refuses an item from a foreign dashboard',
    async (method) => {
      const { service, dashboardItemRepository } = dashboard();
      await expect(
        service[method](92, { displayName: 'foreign' }),
      ).rejects.toThrow('Dashboard with id 82 not found');
      expect(dashboardItemRepository.updateOne).not.toHaveBeenCalled();
      expect(dashboardItemRepository.deleteOne).not.toHaveBeenCalled();
    },
  );
  it('dashboard list, creation and schedule consume project ownership', async () => {
    const { service, dashboardRepository, dashboardItemRepository } =
      dashboard();
    await expect(service.getDashboardItems(82)).rejects.toThrow(
      'Dashboard with id 82 not found',
    );
    await expect(
      service.createDashboardItem({ dashboardId: 82 } as any),
    ).rejects.toThrow('Dashboard with id 82 not found');
    await expect(
      service.setDashboardSchedule(82, { cacheEnabled: false } as any),
    ).rejects.toThrow('Dashboard with id 82 not found');
    expect(dashboardItemRepository.findAllBy).not.toHaveBeenCalled();
    expect(dashboardItemRepository.createOne).not.toHaveBeenCalled();
    expect(dashboardRepository.updateOne).not.toHaveBeenCalled();
  });
  it('a mixed dashboard layout batch refuses every write before its foreign item', async () => {
    const { service, dashboardItemRepository } = dashboard();
    await expect(
      service.updateDashboardItemLayouts([
        { itemId: 91, x: 0, y: 0, w: 1, h: 1 },
        { itemId: 92, x: 1, y: 0, w: 1, h: 1 },
      ]),
    ).rejects.toThrow('Dashboard with id 82 not found');
    expect(dashboardItemRepository.updateOne).not.toHaveBeenCalled();
    expect(ctx.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
  });
  it('dashboard preview cannot execute SQL from a foreign item', async () => {
    ctx.dashboardService = dashboard().service;
    await expect(
      new DashboardResolver().previewItemSQL(
        null,
        { data: { itemId: 92 } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard with id 82 not found');
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });
  it('preserves original in-project dashboard item edits, layouts, schedule and deletion', async () => {
    const { service, dashboardRepository, dashboardItemRepository } =
      dashboard();
    expect(await service.getDashboardItem(91)).toMatchObject({
      dashboardId: 81,
    });
    await service.updateDashboardItem(91, { displayName: 'original edit' });
    expect(dashboardItemRepository.updateOne).toHaveBeenCalledWith(91, {
      displayName: 'original edit',
    });
    await service.updateDashboardItemLayouts([
      { itemId: 91, x: 0, y: 0, w: 1, h: 1 },
    ]);
    await service.setDashboardSchedule(81, { cacheEnabled: false } as any);
    expect(dashboardRepository.updateOne).toHaveBeenCalledWith(
      81,
      expect.objectContaining({ cacheEnabled: false }),
    );
    expect(await service.deleteDashboardItem(91)).toBe(true);
    expect(dashboardItemRepository.deleteOne).toHaveBeenCalledWith(91);
  });
});

describe('original project resolver native delivery and identity boundary', () => {
  const config: any = {
    projectId: 7,
    tenantId: 'a153ac6a-c04e-4d35-bb3e-15c01a9c38b7',
    workspaceId: '87c27723-e475-4e0b-a0e9-50e5d755fe63',
    bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
    nativeInstanceRef: 'fixture-instance',
    nativeScopeRef: '7',
  };
  const project = {
    id: config.projectId,
    type: 'POSTGRES',
    sampleDataset: 'fixture',
    displayName: 'Original data source',
    language: 'en',
  };
  const scope = (permission: string) => ({
    scope: {
      bindingId: config.bindingId,
      generation: 2,
      tenantId: config.tenantId,
      workspaceId: config.workspaceId,
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
      permission,
      checkedRevision: 'fresh-public-scope',
    },
  });
  let previous: string | undefined;
  let ctx: any;
  const calls = jest.mocked(bindingServiceCall);
  const invoke = (kind: 'read' | 'write') =>
    kind === 'read'
      ? originalResolvers.Query.settings(null, {}, ctx)
      : originalResolvers.Mutation.updateCurrentProject(
          null,
          { data: { language: 'zh-TW' } },
          ctx,
        );
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    jest.mocked(loadQueryDelivery).mockReset().mockResolvedValue(config);
    calls.mockReset().mockImplementation(async (_config, operation, input) => {
      expect(operation).toBe('human-action');
      expect(input).toHaveProperty('authorizeScope');
      return scope((input.authorizeScope as { permission: string }).permission);
    });
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'first-person-token',
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue(project),
        getGeneralConnectionInfo: jest.fn().mockReturnValue({}),
        generateProjectRecommendationQuestions: jest.fn(),
      },
      projectRepository: { updateOne: jest.fn() },
      config: { wrenProductVersion: 'fixture-original-version' },
    };
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });
  it.each(['read', 'write'] as const)(
    'keeps original never-configured native %s without fabricated identity or public permission',
    async (kind) => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete ctx.nativeIdentityScope;
      delete ctx.nativeHumanToken;
      const result = await invoke(kind);
      if (kind === 'read')
        expect(result).toMatchObject({
          language: project.language,
          dataSource: {
            type: project.type,
            properties: { displayName: project.displayName },
          },
        });
      else {
        expect(result).toBe(true);
        expect(ctx.projectRepository.updateOne).toHaveBeenCalledWith(7, {
          language: 'zh-TW',
        });
      }
      expect(loadQueryDelivery).not.toHaveBeenCalled();
      expect(calls).not.toHaveBeenCalled();
    },
  );
  it.each(
    (['read', 'write'] as const).flatMap((kind) =>
      [
        'identity-only',
        'token-only',
        'empty-identity',
        'empty-token',
        'both',
        'empty-both',
      ].map((fault) => ({ kind, fault })),
    ),
  )(
    'refuses missing delivery for original $kind with $fault instead of entering standalone native code',
    async ({ kind, fault }) => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      if (fault === 'identity-only' || fault === 'empty-identity')
        delete ctx.nativeHumanToken;
      if (fault === 'token-only' || fault === 'empty-token')
        delete ctx.nativeIdentityScope;
      if (fault === 'empty-identity' || fault === 'empty-both')
        ctx.nativeIdentityScope = '';
      if (fault === 'empty-token' || fault === 'empty-both')
        ctx.nativeHumanToken = '';
      jest
        .mocked(loadQueryDelivery)
        .mockImplementation(
          jest.requireActual('./apollo/server/services/nativeQueryAdmission')
            .loadQueryDelivery,
        );
      await expect(invoke(kind)).rejects.toMatchObject({
        message: 'QUERY_ADMISSION_UNAVAILABLE',
        ...(kind === 'write' && {
          extensions: { other: { nativeWrite: { outcome: 'NOT_STARTED' } } },
        }),
      });
      expect(loadQueryDelivery).toHaveBeenCalledTimes(1);
      expect(calls).not.toHaveBeenCalled();
      expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(
    (['read', 'write'] as const).flatMap((kind) =>
      [
        'missing-identity',
        'missing-token',
        'empty-identity',
        'empty-token',
        'invalid-identity',
        'empty-delivery',
      ].map((fault) => ({ kind, fault })),
    ),
  )(
    'refuses configured $fault before original $kind work',
    async ({ kind, fault }) => {
      if (fault === 'missing-identity') delete ctx.nativeIdentityScope;
      if (fault === 'missing-token') delete ctx.nativeHumanToken;
      if (fault === 'empty-identity') ctx.nativeIdentityScope = '';
      if (fault === 'empty-token') ctx.nativeHumanToken = '';
      if (fault === 'invalid-identity') ctx.nativeIdentityScope = 'not-trusted';
      if (fault === 'empty-delivery') {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '';
        jest
          .mocked(loadQueryDelivery)
          .mockImplementation(
            jest.requireActual('./apollo/server/services/nativeQueryAdmission')
              .loadQueryDelivery,
          );
      }
      await expect(invoke(kind)).rejects.toBeInstanceOf(NativeQueryRefusal);
      expect(calls).not.toHaveBeenCalled();
      expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(
    (['read', 'write'] as const).flatMap((kind) =>
      ['identity', 'token', 'delivery'].map((fault) => ({ kind, fault })),
    ),
  )(
    'refuses a $fault switch during native project loading before dispatching original $kind',
    async ({ kind, fault }) => {
      ctx.projectService.getCurrentProject.mockImplementationOnce(async () => {
        if (fault === 'identity') ctx.nativeIdentityScope = 'b'.repeat(64);
        if (fault === 'token') ctx.nativeHumanToken = 'second-person-token';
        if (fault === 'delivery')
          jest.mocked(loadQueryDelivery).mockResolvedValue({
            ...config,
            bindingId: 'd75d1c3d-c74e-4d37-b08b-56513146225d',
          });
        return project;
      });
      await expect(invoke(kind)).rejects.toMatchObject({
        message: 'QUERY_REFERENCE_CHANGED',
        ...(kind === 'write' && {
          extensions: { other: { nativeWrite: { outcome: 'NOT_STARTED' } } },
        }),
      });
      expect(calls).toHaveBeenCalledTimes(1);
      expect(ctx.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(['read', 'write'] as const)(
    'refuses a foreign current project before original %s work',
    async (kind) => {
      ctx.projectService.getCurrentProject.mockResolvedValue({
        ...project,
        id: 8,
      });
      await expect(invoke(kind)).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(
        ctx.projectService.getGeneralConnectionInfo,
      ).not.toHaveBeenCalled();
      expect(ctx.projectRepository.updateOne).not.toHaveBeenCalled();
    },
  );
  it.each(['identity', 'token'])(
    'does not disclose original metadata after %s changes while final authorization is pending',
    async (fault) => {
      calls.mockImplementation(async (_config, _operation, input) => {
        if (calls.mock.calls.length === 2) {
          if (fault === 'identity') ctx.nativeIdentityScope = 'b'.repeat(64);
          else ctx.nativeHumanToken = 'second-person-token';
        }
        return scope(
          (input.authorizeScope as { permission: string }).permission,
        );
      });
      await expect(invoke('read')).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(ctx.projectService.getGeneralConnectionInfo).toHaveBeenCalledTimes(
        1,
      );
      expect(calls.mock.calls.map((entry) => entry[3])).toEqual([
        'first-person-token',
        'first-person-token',
      ]);
    },
  );
  it.each(['identity', 'token'])(
    'retains UNKNOWN after one original write when %s changes during final authorization, without re-dispatch',
    async (fault) => {
      calls.mockImplementation(async (_config, _operation, input) => {
        if (calls.mock.calls.length === 2) {
          if (fault === 'identity') ctx.nativeIdentityScope = 'b'.repeat(64);
          else ctx.nativeHumanToken = 'second-person-token';
        }
        return scope(
          (input.authorizeScope as { permission: string }).permission,
        );
      });
      await expect(invoke('write')).rejects.toMatchObject({
        message: 'NATIVE_EXECUTION_UNKNOWN',
        extensions: {
          other: {
            nativeWrite: {
              outcome: 'UNKNOWN',
              scope: nativePreviewScope(config, 'a'.repeat(64)),
              generation: 2,
            },
          },
        },
      });
      expect(ctx.projectRepository.updateOne).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls.map((entry) => entry[3])).toEqual([
        'first-person-token',
        'first-person-token',
      ]);
    },
  );
});

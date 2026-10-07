import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { AskingService } from './apollo/server/services/askingService';
import { DashboardResolver } from './apollo/server/resolvers/dashboardResolver';
import { DashboardService } from './apollo/server/services/dashboardService';
import { MDLService } from './apollo/server/services/mdlService';

describe('native bound-project business consumers', () => {
  const resolver = new ModelResolver();
  const projectId = 7;
  let ctx: any;
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
    ctx = {
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      modelRepository: repository([
        { id: 11, projectId },
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
      deployService: { getMDLByHash: jest.fn() },
    };
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
    expect(ctx.deployService.getMDLByHash).not.toHaveBeenCalled();
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
    expect(service.threadRepository.updateOne).toHaveBeenCalledWith(
      81,
      expect.objectContaining({ queryId: 'native-query' }),
    );
    expect(
      service.threadRecommendQuestionBackgroundTracker.addTask,
    ).toHaveBeenCalledTimes(1);
    expect(ctx.projectService.getCurrentProject).toHaveBeenCalledTimes(1);
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

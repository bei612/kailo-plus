import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { AskingService } from './apollo/server/services/askingService';
import { DashboardResolver } from './apollo/server/resolvers/dashboardResolver';

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
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    findAllBy: jest.fn(async () => []),
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
});

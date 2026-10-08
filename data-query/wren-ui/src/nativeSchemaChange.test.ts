import { ProjectResolver } from './apollo/server/resolvers/projectResolver';
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

describe('original schema-change metadata consumer', () => {
  const resolver = new ProjectResolver();
  const config: any = {
    projectId: 7,
    nativeScopeRef: '7',
    nativeInstanceRef: 'fixture-instance',
    bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
    workspaceId: '87c27723-e475-4e0b-a0e9-50e5d755fe63',
  };
  const authorize = jest.mocked(bindingServiceCall);
  let ctx: any;
  beforeEach(() => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    authorize
      .mockReset()
      .mockImplementation(async (_config, _operation, request: any) => ({
        resource: {
          resourceId: '09c6b43b-1edf-467d-8e81-e47a3f506c4f',
          resourceVersion: 1,
          nativeType: request.resolveResource.nativeType,
          nativeRef: request.resolveResource.nativeRef,
          nativeInstanceRef: config.nativeInstanceRef,
          nativeScopeRef: config.nativeScopeRef,
        },
      }));
    ctx = {
      nativeHumanToken: 'fixture-person',
      nativeIdentityScope: 'a'.repeat(64),
      projectService: { getCurrentProject: jest.fn(async () => ({ id: 7 })) },
      schemaChangeRepository: {
        findLastSchemaChange: jest.fn(async () => ({
          projectId: 7,
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
      modelRepository: {
        findAllBy: jest.fn(async () => [
          {
            id: 11,
            projectId: 7,
            referenceName: 'orders_model',
            displayName: 'Orders',
            sourceTableName: 'orders',
          },
        ]),
      },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn(async () => [
          {
            id: 31,
            modelId: 11,
            sourceColumnName: 'amount',
            displayName: 'Amount',
            isCalculated: false,
          },
        ]),
      },
      relationRepository: { findRelationInfoBy: jest.fn(async () => []) },
    };
  });
  const read = () => resolver.getSchemaChange(null, null, ctx);
  it('retains original detector output and uses describe read before and after dependency reads', async () => {
    const result: any = await read();
    expect(result.lastSchemaChangeTime).toBe('fixture-time');
    expect(result.deletedColumns).toEqual([
      expect.objectContaining({
        modelId: 11,
        displayName: 'Orders',
        columns: [
          {
            sourceColumnName: 'amount',
            displayName: 'Amount',
            type: 'INTEGER',
          },
        ],
      }),
    ]);
    expect(authorize).toHaveBeenCalledTimes(2);
    for (const call of authorize.mock.calls) {
      expect(call[3]).toBe('fixture-person');
      expect(call[2]).toMatchObject({
        resolveResource: {
          actionKey: 'data_query.describe@v1',
          nativeType: 'model',
          nativeRef: '11',
        },
      });
    }
  });
  it('refuses a denied model before reading dependent columns', async () => {
    authorize.mockRejectedValue(new NativeQueryRefusal(403, 'denied', true));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
  });
  it('preserves original relationship and calculated-field impact output', async () => {
    const models = await ctx.modelRepository.findAllBy();
    ctx.modelRepository.findAllBy.mockResolvedValue([
      ...models,
      {
        id: 12,
        projectId: 7,
        referenceName: 'customers_model',
        displayName: 'Customers',
        sourceTableName: 'customers',
      },
    ]);
    const columns = await ctx.modelColumnRepository.findColumnsByModelIds();
    const calculated = {
      id: 33,
      modelId: 11,
      isCalculated: true,
      lineage: '[31]',
      displayName: 'Total',
    };
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([
      ...columns,
      { id: 32, modelId: 12, sourceColumnName: 'id' },
      calculated,
    ]);
    ctx.relationRepository.findRelationInfoBy.mockResolvedValue([
      {
        id: 51,
        projectId: 7,
        fromModelId: 11,
        fromColumnId: 31,
        toModelId: 12,
        toColumnId: 32,
        fromModelName: 'orders_model',
        toModelName: 'customers_model',
      },
    ]);
    const result: any = await read();
    expect(result.deletedColumns[0].relationships).toEqual([
      { id: 51, referenceName: 'customers_model', displayName: 'Customers' },
    ]);
    expect(result.deletedColumns[0].calculatedFields).toEqual([calculated]);
    expect(authorize).toHaveBeenCalledTimes(4);
  });
  it('does not turn revocation while reading columns into a successful old result', async () => {
    ctx.modelColumnRepository.findColumnsByModelIds.mockImplementation(
      async () => {
        authorize.mockRejectedValue(
          new NativeQueryRefusal(403, 'denied', true),
        );
        return [
          {
            id: 31,
            modelId: 11,
            sourceColumnName: 'amount',
            displayName: 'Amount',
          },
        ];
      },
    );
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });
  it.each(['model', 'column', 'relation', 'change'])(
    'refuses cross-project or foreign %s rows',
    async (kind) => {
      if (kind === 'model')
        ctx.modelRepository.findAllBy.mockResolvedValue([
          { id: 11, projectId: 8 },
        ]);
      if (kind === 'column')
        ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([
          { id: 31, modelId: 99 },
        ]);
      if (kind === 'relation')
        ctx.relationRepository.findRelationInfoBy.mockResolvedValue([
          {
            projectId: 7,
            fromModelId: 11,
            fromColumnId: 31,
            toModelId: 99,
            toColumnId: 32,
          },
        ]);
      if (kind === 'change')
        ctx.schemaChangeRepository.findLastSchemaChange.mockResolvedValue({
          projectId: 8,
        });
      await expect(read()).rejects.toMatchObject({ status: 403 });
    },
  );
  it('does not make unbounded repository reads for an empty model directory', async () => {
    ctx.modelRepository.findAllBy.mockResolvedValue([]);
    await expect(read()).resolves.toEqual({
      deletedColumns: null,
      lastSchemaChangeTime: 'fixture-time',
    });
    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
    expect(ctx.relationRepository.findRelationInfoBy).not.toHaveBeenCalled();
  });
  it.each(['token', 'scope', 'project'])(
    'refuses missing or foreign %s before reading schema changes',
    async (kind) => {
      if (kind === 'token') ctx.nativeHumanToken = undefined;
      if (kind === 'scope') ctx.nativeIdentityScope = undefined;
      if (kind === 'project')
        ctx.projectService.getCurrentProject.mockResolvedValue({ id: 8 });
      await expect(read()).rejects.toBeInstanceOf(NativeQueryRefusal);
      expect(
        ctx.schemaChangeRepository.findLastSchemaChange,
      ).not.toHaveBeenCalled();
    },
  );
  it('keeps the original no-change shape', async () => {
    ctx.schemaChangeRepository.findLastSchemaChange.mockResolvedValue(null);
    await expect(read()).resolves.toEqual({
      deletedTables: null,
      deletedColumns: null,
      modifiedColumns: null,
      lastSchemaChangeTime: null,
    });
  });
});

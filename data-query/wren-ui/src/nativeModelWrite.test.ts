import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import originalResolvers from './apollo/server/resolvers';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { updateModelPrimaryKey } from './apollo/server/utils/model';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe.each(['createModel', 'updateModel'] as const)(
  'original %s model, column and nested-column write consumers',
  (method) => {
    const projectId = 3;
    const modelId = 11;
    const sourceTableName = 'original.orders';
    const fieldNames =
      method === 'createModel'
        ? ['id', 'profile']
        : ['id', 'profile', 'new_profile'];
    const args: any = {
      data: { sourceTableName, fields: fieldNames, primaryKey: 'id' },
      ...(method === 'updateModel' ? { where: { id: modelId } } : {}),
    };
    const sourceTable = {
      name: sourceTableName,
      properties: { original: 'retained' },
      columns: [
        { name: 'id', type: 'BIGINT', notNull: true },
        {
          name: 'profile',
          type: 'STRUCT<city VARCHAR>',
          properties: { description: 'original profile' },
          nestedColumns: [
            { name: 'profile.city', type: 'VARCHAR', properties: {} },
          ],
        },
        {
          name: 'new_profile',
          type: 'STRUCT<country VARCHAR>',
          nestedColumns: [
            { name: 'new_profile.country', type: 'VARCHAR', properties: {} },
          ],
        },
      ],
    };
    let previous: string | undefined;
    let delivery: any;
    let generation: number;
    let revoked: boolean;
    let denyBody: boolean;
    let nativeProjectId: number;
    let context: any;
    let model: any;
    let columns: any[];
    let events: string[];
    let afterLastRead: () => void;
    let afterWrite: (stage: string) => void;
    const modelRepository = { findOneBy: jest.fn(), createOne: jest.fn() };
    const modelColumnRepository = {
      findAllBy: jest.fn(),
      findColumnsByModelIds: jest.fn(),
      resetModelPrimaryKey: jest.fn(),
      setModelPrimaryKey: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      updateOne: jest.fn(),
    };
    const modelNestedColumnRepository = {
      findAllBy: jest.fn(),
      deleteAllBy: jest.fn(),
      createMany: jest.fn(),
    };
    const writes = () => [
      modelRepository.createOne,
      modelColumnRepository.resetModelPrimaryKey,
      modelColumnRepository.setModelPrimaryKey,
      modelColumnRepository.deleteMany,
      modelColumnRepository.createMany,
      modelColumnRepository.updateOne,
      modelNestedColumnRepository.deleteAllBy,
      modelNestedColumnRepository.createMany,
    ];
    const originalStages = () =>
      method === 'createModel'
        ? ['create-model', 'create-columns', 'create-nested']
        : [
            'reset-primary',
            'set-primary',
            'delete-columns',
            'create-columns',
            'create-nested',
            'update-column',
            'delete-nested',
            'create-nested',
          ];
    const invoke = (input = args) =>
      originalResolvers.Mutation[method](undefined, input, context);
    const failure = async (operation = () => invoke()) => {
      try {
        await operation();
      } catch (error) {
        return error as any;
      }
      throw new Error('Original model write unexpectedly succeeded');
    };
    const writeStage = (stage: string) => {
      events.push(stage);
      afterWrite(stage);
    };
    beforeEach(() => {
      previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-test-delivery';
      delivery = {
        projectId,
        bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
        tenantId: 'fixture-tenant',
        workspaceId: 'fixture-workspace',
        nativeInstanceRef: 'fixture-instance',
        nativeScopeRef: String(projectId),
      };
      generation = 2;
      revoked = false;
      denyBody = false;
      nativeProjectId = projectId;
      afterLastRead = () => {};
      afterWrite = () => {};
      events = [];
      model = {
        id: modelId,
        projectId,
        sourceTableName,
        referenceName: 'original_orders',
        properties: '{}',
      };
      columns = [
        { id: 31, sourceColumnName: 'id', type: 'BIGINT' },
        { id: 32, sourceColumnName: 'profile', type: 'BIGINT' },
        { id: 40, sourceColumnName: 'obsolete', type: 'VARCHAR' },
      ].map((column) => ({
        ...column,
        modelId,
        referenceName: column.sourceColumnName,
        isCalculated: false,
        properties: '{}',
      }));
      Object.values(modelRepository).forEach((mock) => mock.mockReset());
      Object.values(modelColumnRepository).forEach((mock) => mock.mockReset());
      Object.values(modelNestedColumnRepository).forEach((mock) =>
        mock.mockReset(),
      );
      modelRepository.findOneBy.mockImplementation(async (where) =>
        where.id === model.id && where.projectId === model.projectId
          ? structuredClone(model)
          : undefined,
      );
      modelRepository.createOne.mockImplementation(async (value) => {
        writeStage('create-model');
        model = { id: modelId, ...value };
        return structuredClone(model);
      });
      modelColumnRepository.findAllBy.mockImplementation(async () => {
        const output = structuredClone(columns);
        events.push('last-native-read');
        afterLastRead();
        return output;
      });
      modelColumnRepository.findColumnsByModelIds.mockImplementation(async () =>
        structuredClone(columns),
      );
      modelColumnRepository.resetModelPrimaryKey.mockImplementation(async () =>
        writeStage('reset-primary'),
      );
      modelColumnRepository.setModelPrimaryKey.mockImplementation(async () =>
        writeStage('set-primary'),
      );
      modelColumnRepository.deleteMany.mockImplementation(async (ids) => {
        writeStage('delete-columns');
        columns = columns.filter(({ id }) => !ids.includes(id));
      });
      modelColumnRepository.createMany.mockImplementation(async (values) => {
        writeStage('create-columns');
        const created = values.map((value, index) => ({
          id: method === 'createModel' ? 31 + index : 61 + index,
          ...value,
        }));
        columns = method === 'createModel' ? created : [...columns, ...created];
        return structuredClone(created);
      });
      modelColumnRepository.updateOne.mockImplementation(async (id, value) => {
        writeStage('update-column');
        const row = columns.find((column) => column.id === id);
        Object.assign(row, value);
        return structuredClone(row);
      });
      modelNestedColumnRepository.findAllBy.mockResolvedValue([]);
      modelNestedColumnRepository.deleteAllBy.mockImplementation(async () =>
        writeStage('delete-nested'),
      );
      modelNestedColumnRepository.createMany.mockImplementation(async () =>
        writeStage('create-nested'),
      );
      const projectService = {
        getCurrentProject: jest.fn(async () => ({ id: nativeProjectId })),
        getProjectDataSourceTables: jest.fn(async () => {
          const output = structuredClone([sourceTable]);
          if (method === 'createModel') {
            events.push('last-native-read');
            afterLastRead();
          }
          return output;
        }),
      };
      context = {
        nativeHumanToken: 'verified-test-person',
        nativeIdentityScope: 'a'.repeat(64),
        projectService,
        modelRepository,
        modelColumnRepository,
        modelNestedColumnRepository,
        relationRepository: { findRelationsBy: jest.fn(async () => []) },
        telemetry: { sendEvent: jest.fn() },
      };
      jest
        .mocked(loadQueryDelivery)
        .mockReset()
        .mockImplementation(async () => structuredClone(delivery));
      jest
        .mocked(bindingServiceCall)
        .mockReset()
        .mockImplementation(async (config, operation, request: any, bearer) => {
          expect(operation).toBe('human-action');
          expect(bearer).toBe('verified-test-person');
          if (request.authorizeScope) {
            events.push('fresh-manage');
            expect(request.authorizeScope.permission).toBe('manage');
            if (revoked)
              throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
            return {
              scope: {
                ...config,
                generation,
                permission: 'manage',
                checkedRevision: 'current-native-management',
              },
            };
          }
          expect(request.resolveResource?.actionKey).toBe(
            'data_query.describe@v1',
          );
          expect(request.resolveResource.nativeType).toBe('model');
          expect(request.resolveResource.nativeRef).toBe(String(modelId));
          if (denyBody) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return {
            resource: {
              resourceId: '623b269a-69cb-4b62-8e52-a770426d78b4',
              resourceVersion: 2,
              nativeType: 'model',
              nativeRef: String(modelId),
              nativeInstanceRef: config.nativeInstanceRef,
              nativeScopeRef: config.nativeScopeRef,
            },
          };
        });
    });
    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });

    it('retains original fields, primary key, nested columns and complete native response', async () => {
      expect(await invoke()).toMatchObject({
        id: modelId,
        projectId,
        referenceName: 'original_orders',
        sourceTableName,
      });
      expect(
        events.filter((event) => originalStages().includes(event)),
      ).toEqual(originalStages());
      for (const stage of originalStages()) {
        for (let index = 0; index < events.length; index++)
          if (events[index] === stage)
            expect(events[index - 1]).toBe('fresh-manage');
      }
      expect(context).not.toHaveProperty('nativeProjectCheck');
      if (method === 'createModel') {
        expect(modelRepository.createOne).toHaveBeenCalledWith({
          projectId,
          displayName: sourceTableName,
          referenceName: 'original_orders',
          sourceTableName,
          cached: false,
          refreshTime: null,
          properties: JSON.stringify(sourceTable.properties),
        });
        expect(modelColumnRepository.createMany.mock.calls[0][0]).toEqual([
          expect.objectContaining({
            modelId,
            sourceColumnName: 'id',
            referenceName: 'id',
            type: 'BIGINT',
            isPk: true,
            notNull: true,
          }),
          expect.objectContaining({
            modelId,
            sourceColumnName: 'profile',
            type: 'STRUCT<city VARCHAR>',
            isPk: false,
            properties: JSON.stringify(sourceTable.columns[1].properties),
          }),
        ]);
        expect(modelNestedColumnRepository.createMany).toHaveBeenCalledWith([
          expect.objectContaining({
            modelId,
            columnId: 32,
            sourceColumnName: 'profile.city',
            columnPath: ['profile', 'city'],
            referenceName: 'profile.city',
            type: 'VARCHAR',
          }),
        ]);
      } else {
        expect(modelColumnRepository.resetModelPrimaryKey).toHaveBeenCalledWith(
          modelId,
        );
        expect(modelColumnRepository.setModelPrimaryKey).toHaveBeenCalledWith(
          modelId,
          'id',
        );
        expect(modelColumnRepository.deleteMany).toHaveBeenCalledWith([40]);
        expect(modelColumnRepository.createMany).toHaveBeenCalledWith([
          expect.objectContaining({ sourceColumnName: 'new_profile' }),
        ]);
        expect(modelColumnRepository.updateOne).toHaveBeenCalledWith(32, {
          type: 'STRUCT<city VARCHAR>',
        });
        expect(modelNestedColumnRepository.deleteAllBy).toHaveBeenCalledWith({
          columnId: 32,
        });
      }
      expect(
        jest
          .mocked(bindingServiceCall)
          .mock.calls.some((call) => call[2].resolveResource),
      ).toBe(true);
    });

    it.each(['revoked', 'generation', 'delivery', 'identity', 'scope'])(
      'refuses %s during the last original read before the first native write',
      async (change) => {
        afterLastRead = () => {
          if (change === 'revoked') revoked = true;
          else if (change === 'generation') generation++;
          else if (change === 'delivery')
            delivery.workspaceId = 'other-fixture-workspace';
          else if (change === 'identity')
            context.nativeHumanToken = 'changed-test-person';
          else context.nativeIdentityScope = 'b'.repeat(64);
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      },
    );

    it('refuses the native project lookup selecting a foreign project before writing', async () => {
      context.projectService.getCurrentProject
        .mockResolvedValueOnce({ id: projectId })
        .mockResolvedValueOnce({ id: projectId + 1 });
      await expect(invoke()).rejects.toThrow();
      writes().forEach((write) => expect(write).not.toHaveBeenCalled());
    });

    it('refuses a raw bound resolver without the original request closure', async () => {
      await expect(
        new ModelResolver()[method](undefined, args, context),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      writes().forEach((write) => expect(write).not.toHaveBeenCalled());
    });

    it('keeps the entirely never-configured original independent operation', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      expect(await invoke()).toMatchObject({ id: modelId });
      expect(
        events.filter((event) => originalStages().includes(event)),
      ).toEqual(originalStages());
      expect(bindingServiceCall).not.toHaveBeenCalled();
    });

    it.each(['delivery', 'identity', 'scope'])(
      'refuses %s arriving during the last standalone read without falling back',
      async (change) => {
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        delete context.nativeHumanToken;
        delete context.nativeIdentityScope;
        afterLastRead = () => {
          if (change === 'delivery')
            process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
              'controlled-test-delivery';
          else if (change === 'identity')
            context.nativeHumanToken = 'new-test-person';
          else context.nativeIdentityScope = 'b'.repeat(64);
        };
        await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      },
    );

    it.each(['lost-response', 'forged-not-started'])(
      'retains UNKNOWN for %s after the first native dispatch and never retries',
      async (cause) => {
        const write =
          method === 'createModel'
            ? modelRepository.createOne
            : modelColumnRepository.resetModelPrimaryKey;
        write.mockImplementation(async () => {
          const error: any = new Error('Original native response unavailable');
          if (cause === 'forged-not-started')
            error.extensions = {
              other: { nativeWrite: { outcome: 'NOT_STARTED' } },
            };
          throw error;
        });
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(write).toHaveBeenCalledTimes(1);
        expect(modelColumnRepository.createMany).not.toHaveBeenCalled();
        expect(modelColumnRepository.setModelPrimaryKey).not.toHaveBeenCalled();
      },
    );

    it('does not expose the original complete response after source model read is revoked', async () => {
      afterWrite = () => {
        denyBody = true;
      };
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(
        events.filter((event) => originalStages().includes(event)),
      ).toEqual(originalStages());
    });

    it.each(['revoked', 'generation', 'identity', 'scope', 'delivery'])(
      'keeps the partial operation UNKNOWN when %s changes after first dispatch',
      async (change) => {
        afterWrite = (stage) => {
          if (stage !== originalStages()[0]) return;
          if (change === 'revoked') revoked = true;
          else if (change === 'generation') generation++;
          else if (change === 'identity')
            context.nativeHumanToken = 'changed-test-person';
          else if (change === 'scope')
            context.nativeIdentityScope = 'b'.repeat(64);
          else delivery.workspaceId = 'other-fixture-workspace';
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(
          events.filter((event) => originalStages().includes(event)),
        ).toEqual([originalStages()[0]]);
      },
    );

    it.each(
      method === 'createModel'
        ? ['create-columns']
        : [
            'set-primary',
            'delete-columns',
            'create-columns',
            'create-nested',
            'update-column',
            'delete-nested',
          ],
    )(
      'stops later native writes when manage is revoked after %s',
      async (stage) => {
        afterWrite = (actual) => {
          if (actual === stage) revoked = true;
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        const stages = originalStages();
        expect(events.filter((event) => stages.includes(event))).toEqual(
          stages.slice(0, stages.indexOf(stage) + 1),
        );
      },
    );

    it('keeps later configuration arriving after an independent write UNKNOWN', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      afterWrite = (stage) => {
        if (stage === originalStages()[0])
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
            'controlled-test-delivery';
      };
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(
        events.filter((event) => originalStages().includes(event)),
      ).toEqual([originalStages()[0]]);
    });

    if (method === 'updateModel') {
      it('retains original reset-only primary key semantics for an empty primary key', async () => {
        expect(
          await invoke({ ...args, data: { ...args.data, primaryKey: '' } }),
        ).toMatchObject({ id: modelId });
        expect(
          modelColumnRepository.resetModelPrimaryKey,
        ).toHaveBeenCalledTimes(1);
        expect(modelColumnRepository.setModelPrimaryKey).not.toHaveBeenCalled();
      });

      it('rejects a missing in-project model before primary key reset or any column write', async () => {
        model.projectId = projectId + 1;
        await expect(invoke()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
        expect(modelRepository.findOneBy).toHaveBeenCalledWith({
          id: modelId,
          projectId,
        });
      });
    }
  },
);

it('preserves the original standalone primary-key helper signature and reset/set order', async () => {
  const repository: any = {
    resetModelPrimaryKey: jest.fn(async () => {}),
    setModelPrimaryKey: jest.fn(async () => {}),
  };
  await updateModelPrimaryKey(repository, 11, 'id');
  expect(repository.resetModelPrimaryKey).toHaveBeenCalledWith(11);
  expect(repository.setModelPrimaryKey).toHaveBeenCalledWith(11, 'id');
  expect(
    repository.resetModelPrimaryKey.mock.invocationCallOrder[0],
  ).toBeLessThan(repository.setModelPrimaryKey.mock.invocationCallOrder[0]);
});

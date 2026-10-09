import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { ModelService } from './apollo/server/services/modelService';
import originalResolvers from './apollo/server/resolvers';
import { RelationType } from './apollo/server/types';
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

describe.each(['createRelation', 'updateRelation', 'deleteRelation'] as const)(
  'original %s native first-write consumer',
  (method) => {
    const projectId = 3;
    const relationId = 51;
    const input = {
      fromModelId: 11,
      fromColumnId: 31,
      toModelId: 12,
      toColumnId: 32,
      type: RelationType.MANY_TO_ONE,
    };
    const args =
      method === 'createRelation'
        ? { data: input }
        : method === 'updateRelation'
          ? { where: { id: relationId }, data: { type: input.type } }
          : { where: { id: relationId } };
    let previous: string | undefined;
    let delivery: any;
    let generation: number;
    let revoked: boolean;
    let denyBody: boolean;
    let nativeProjectId: number;
    let context: any;
    let models: any[];
    let columns: any[];
    let relation: any;
    let afterLastRead: () => void;
    let afterFirstWrite: () => void;
    let events: string[];
    const modelRepository = {
      findOneBy: jest.fn(),
      findAllByIds: jest.fn(),
    };
    const modelColumnRepository = {
      findOneBy: jest.fn(),
      findColumnsByIds: jest.fn(),
      findColumnsByModelIds: jest.fn(),
      findAllBy: jest.fn(),
      deleteMany: jest.fn(),
    };
    const relationRepository = {
      findOneBy: jest.fn(),
      findExistedRelationBetweenModels: jest.fn(),
      findRelationsBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    const writes = () => [
      relationRepository.createOne,
      relationRepository.updateOne,
      relationRepository.deleteOne,
      modelColumnRepository.deleteMany,
    ];
    const invoke = () =>
      originalResolvers.Mutation[method](undefined, args as any, context);
    const failure = async (operation = invoke) => {
      try {
        await operation();
      } catch (error) {
        return error as any;
      }
      throw new Error('Original native relation unexpectedly succeeded');
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
      afterFirstWrite = () => {};
      events = [];
      models = [11, 12].map((id) => ({
        id,
        projectId,
        sourceTableName: `original${id}`,
        referenceName: `original${id}`,
        properties: '{}',
      }));
      columns = [31, 32, 61].map((id, index) => ({
        id,
        modelId: index === 1 ? 12 : 11,
        referenceName: `original${id}`,
        sourceColumnName: `original${id}`,
        type: 'BIGINT',
        properties: '{}',
        isCalculated: id === 61,
        lineage: id === 61 ? JSON.stringify([relationId, 31]) : undefined,
      }));
      relation = {
        id: relationId,
        projectId,
        name: 'Original31Original32',
        fromColumnId: input.fromColumnId,
        toColumnId: input.toColumnId,
        joinType: input.type,
      };
      Object.values(modelRepository).forEach((mock) => mock.mockReset());
      Object.values(modelColumnRepository).forEach((mock) => mock.mockReset());
      Object.values(relationRepository).forEach((mock) => mock.mockReset());
      modelRepository.findOneBy.mockImplementation(async ({ id, projectId }) =>
        structuredClone(
          models.find(
            (model) =>
              model.id === id &&
              (projectId === undefined || model.projectId === projectId),
          ),
        ),
      );
      modelRepository.findAllByIds.mockImplementation(async (ids) => {
        const rows = structuredClone(
          models.filter(({ id }) => ids.includes(id)),
        );
        if (method === 'deleteRelation') {
          events.push('last-native-read');
          afterLastRead();
        }
        return rows;
      });
      modelColumnRepository.findOneBy.mockImplementation(async ({ id }) =>
        structuredClone(columns.find((column) => column.id === id)),
      );
      modelColumnRepository.findColumnsByIds.mockImplementation(async (ids) =>
        structuredClone(columns.filter(({ id }) => ids.includes(id))),
      );
      modelColumnRepository.findColumnsByModelIds.mockImplementation(
        async (ids) =>
          structuredClone(
            columns.filter(({ modelId }) => ids.includes(modelId)),
          ),
      );
      modelColumnRepository.findAllBy.mockImplementation(async () =>
        structuredClone(columns.filter((column) => column.isCalculated)),
      );
      relationRepository.findOneBy.mockImplementation(async (where) => {
        const row =
          relation.id === where.id &&
          (where.projectId === undefined ||
            relation.projectId === where.projectId)
            ? structuredClone(relation)
            : undefined;
        if (method === 'updateRelation' && where.projectId === undefined) {
          events.push('last-native-read');
          afterLastRead();
        }
        return row;
      });
      relationRepository.findExistedRelationBetweenModels.mockImplementation(
        async () => {
          events.push('last-native-read');
          afterLastRead();
          return [];
        },
      );
      relationRepository.findRelationsBy.mockResolvedValue([]);
      relationRepository.createOne.mockImplementation(async (value) => {
        events.push('first-native-write');
        afterFirstWrite();
        return { id: relationId, ...value };
      });
      relationRepository.updateOne.mockImplementation(async (_id, value) => {
        events.push('first-native-write');
        afterFirstWrite();
        return { ...relation, ...value };
      });
      modelColumnRepository.deleteMany.mockImplementation(async () => {
        events.push('first-native-write');
        afterFirstWrite();
      });
      relationRepository.deleteOne.mockImplementation(async () => {
        events.push('relation-delete');
      });
      const projectService = {
        getCurrentProject: jest.fn(async () => ({ id: nativeProjectId })),
      };
      const service = new ModelService({
        projectService,
        modelRepository,
        modelColumnRepository,
        relationRepository,
        viewRepository: {},
        mdlService: {},
        wrenEngineAdaptor: {},
        queryService: {},
      } as any);
      context = {
        nativeHumanToken: 'verified-test-person',
        nativeIdentityScope: 'a'.repeat(64),
        projectService,
        modelService: service,
        modelRepository,
        modelColumnRepository,
        relationRepository,
        modelNestedColumnRepository: { findAllBy: jest.fn(async () => []) },
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
          if (denyBody) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return {
            resource: {
              resourceId: '623b269a-69cb-4b62-8e52-a770426d78b4',
              resourceVersion: 2,
              nativeType: request.resolveResource.nativeType,
              nativeRef: request.resolveResource.nativeRef,
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

    it('retains the original write, complete response and final native permission consumer', async () => {
      const output = await invoke();
      if (method === 'deleteRelation') {
        expect(output).toBe(true);
        expect(modelColumnRepository.deleteMany).toHaveBeenCalledWith([61]);
        expect(relationRepository.deleteOne).toHaveBeenCalledWith(relationId);
      } else {
        expect(output).toMatchObject({
          projectId,
          fromColumnId: 31,
          toColumnId: 32,
          joinType: input.type,
        });
        if (method === 'createRelation')
          expect(relationRepository.createOne).toHaveBeenCalledWith({
            projectId,
            name: 'Original11Original31Original12Original32',
            fromColumnId: 31,
            toColumnId: 32,
            joinType: input.type,
          });
        else
          expect(relationRepository.updateOne).toHaveBeenCalledWith(
            relationId,
            { joinType: input.type },
          );
      }
      expect(
        events.slice(
          events.indexOf('last-native-read'),
          events.indexOf('first-native-write') + 1,
        ),
      ).toEqual(['last-native-read', 'fresh-manage', 'first-native-write']);
      expect(context).not.toHaveProperty('nativeProjectCheck');
      if (method !== 'deleteRelation')
        expect(
          jest
            .mocked(bindingServiceCall)
            .mock.calls.some((call) => call[2].resolveResource),
        ).toBe(true);
    });

    it.each(['revoked', 'generation', 'delivery', 'identity'])(
      'refuses %s during the service final read before any write',
      async (change) => {
        afterLastRead = () => {
          if (change === 'revoked') revoked = true;
          else if (change === 'generation') generation++;
          else if (change === 'delivery')
            delivery.workspaceId = 'other-fixture-workspace';
          else context.nativeHumanToken = 'changed-test-person';
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      },
    );

    it('refuses bound raw resolver dispatch without the captured server closure', async () => {
      await expect(
        new ModelResolver()[method](undefined, args as any, context),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      writes().forEach((write) => expect(write).not.toHaveBeenCalled());
    });

    it('keeps the entirely unconfigured independent original function', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      const output = await invoke();
      if (method === 'deleteRelation') expect(output).toBe(true);
      else expect(output).toMatchObject({ id: relationId });
      expect(bindingServiceCall).not.toHaveBeenCalled();
    });

    it.each(['delivery', 'identity'])(
      'refuses %s arriving during the last independent native read',
      async (change) => {
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        delete context.nativeHumanToken;
        delete context.nativeIdentityScope;
        afterLastRead = () => {
          if (change === 'delivery')
            process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
              'controlled-test-delivery';
          else context.nativeHumanToken = 'new-test-person';
        };
        await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      },
    );

    it.each(['lost-response', 'forged-not-started'])(
      'retains UNKNOWN for %s after native dispatch without retrying',
      async (cause) => {
        const write =
          method === 'createRelation'
            ? relationRepository.createOne
            : method === 'updateRelation'
              ? relationRepository.updateOne
              : modelColumnRepository.deleteMany;
        write.mockImplementation(async () => {
          const error: any = new Error('Original write response unavailable');
          if (cause === 'forged-not-started')
            error.extensions = {
              other: { nativeWrite: { outcome: 'NOT_STARTED' } },
            };
          throw error;
        });
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(write).toHaveBeenCalledTimes(1);
        if (method === 'deleteRelation')
          expect(relationRepository.deleteOne).not.toHaveBeenCalled();
      },
    );

    if (method === 'createRelation') {
      it('refuses the service current project selecting another native project', async () => {
        context.projectService.getCurrentProject
          .mockResolvedValueOnce({ id: projectId })
          .mockResolvedValueOnce({ id: projectId })
          .mockResolvedValueOnce({ id: projectId + 1 });
        await expect(invoke()).rejects.toThrow();
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      });
      it('refuses models returned by the service from a different project', async () => {
        modelRepository.findAllByIds.mockImplementation(async () =>
          models.map((model) => ({ ...model, projectId: projectId + 1 })),
        );
        await expect(invoke()).rejects.toThrow();
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      });
    }
    if (method === 'updateRelation') {
      it('checks the service reread relation project, not just the earlier resolver row', async () => {
        relationRepository.findOneBy.mockImplementation(async (where) => ({
          ...relation,
          projectId: where.projectId ?? projectId + 1,
        }));
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      });
    }
    if (method !== 'deleteRelation') {
      it('does not expose a written relationship if original model body authorization is denied', async () => {
        afterFirstWrite = () => {
          denyBody = true;
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        const write =
          method === 'createRelation'
            ? relationRepository.createOne
            : relationRepository.updateOne;
        expect(write).toHaveBeenCalledTimes(1);
      });
    }
    if (method === 'deleteRelation') {
      it.each(['revoked', 'generation', 'identity'])(
        'keeps partial deletion UNKNOWN when %s changes after calculated-field deletion',
        async (change) => {
          afterFirstWrite = () => {
            if (change === 'revoked') revoked = true;
            else if (change === 'generation') generation++;
            else context.nativeHumanToken = 'changed-test-person';
          };
          const error = await failure();
          expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
          expect(modelColumnRepository.deleteMany).toHaveBeenCalledTimes(1);
          expect(relationRepository.deleteOne).not.toHaveBeenCalled();
        },
      );
      it('retains the original relation-only deletion when no calculated field references it', async () => {
        columns = columns.filter((column) => !column.isCalculated);
        expect(await invoke()).toBe(true);
        expect(modelColumnRepository.deleteMany).not.toHaveBeenCalled();
        expect(relationRepository.deleteOne).toHaveBeenCalledTimes(1);
      });
      it('refuses a related calculated field owned by another project before either deletion', async () => {
        columns.find((column) => column.id === 61).modelId = 99;
        models.push({ ...models[0], id: 99, projectId: projectId + 1 });
        await expect(invoke()).rejects.toThrow();
        writes().forEach((write) => expect(write).not.toHaveBeenCalled());
      });
      it('does not relabel a second native deletion failure as NOT_STARTED after a partial write', async () => {
        relationRepository.deleteOne.mockImplementation(async () => {
          const error: any = new Error(
            'Original relation deletion response unavailable',
          );
          error.extensions = {
            other: { nativeWrite: { outcome: 'NOT_STARTED' } },
          };
          throw error;
        });
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(modelColumnRepository.deleteMany).toHaveBeenCalledTimes(1);
        expect(relationRepository.deleteOne).toHaveBeenCalledTimes(1);
      });
    }
  },
);

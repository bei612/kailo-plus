import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import originalResolvers from './apollo/server/resolvers';
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

describe.each(['view', 'name-validation'])(
  'original View metadata %s write consumer',
  (lastRead) => {
    const projectId = 3;
    const viewId = 11;
    let previous: string | undefined;
    let context: any;
    let delivery: any;
    let generation: number;
    let revoked: boolean;
    let events: string[];
    let afterRead: (stage: string) => void;
    let afterWrite: () => void;
    const viewRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      updateOne: jest.fn(),
    };
    const input = () => ({
      displayName: lastRead === 'name-validation' ? 'edited_view' : null,
      description: '',
      columns: [{ referenceName: 'original_column', description: '' }],
    });
    const invoke = (data = input()) =>
      originalResolvers.Mutation.updateViewMetadata(
        undefined,
        { where: { id: viewId }, data } as any,
        context,
      );
    const failure = async () => {
      try {
        await invoke();
      } catch (error) {
        return error as any;
      }
      throw new Error('Original native view metadata unexpectedly succeeded');
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
      events = [];
      afterRead = () => {};
      afterWrite = () => {};
      Object.values(viewRepository).forEach((mock) => mock.mockReset());
      viewRepository.findOneBy.mockImplementation(async (where) => {
        expect(where).toEqual({ id: viewId, projectId });
        events.push('read-view');
        afterRead('view');
        return {
          id: viewId,
          projectId,
          name: 'original_view',
          statement: 'select original_column from original_model',
          properties: JSON.stringify({
            original: 'retained',
            description: 'old',
            columns: [
              {
                name: 'original_column',
                properties: { original: 'retained', description: 'old' },
              },
            ],
          }),
        };
      });
      viewRepository.findAllBy.mockImplementation(async (where) => {
        expect(where).toEqual({ projectId });
        events.push('read-name-validation');
        afterRead('name-validation');
        return [{ id: viewId, name: 'original_view' }];
      });
      viewRepository.updateOne.mockImplementation(async () => {
        events.push('write-view');
        afterWrite();
      });
      context = {
        nativeHumanToken: 'verified-test-person',
        nativeIdentityScope: 'a'.repeat(64),
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: projectId })),
        },
        viewRepository,
        queryService: { validate: jest.fn(), preview: jest.fn() },
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
          expect(request).toEqual({
            bindingId: config.bindingId,
            authorizeScope: { permission: 'manage' },
          });
          events.push('fresh-manage');
          if (revoked) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return {
            scope: {
              ...config,
              generation,
              permission: 'manage',
              checkedRevision: 'current-view-management',
            },
          };
        });
    });

    afterEach(() => {
      if (previous === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
    });

    it('retains the original name, blank metadata removal, unrelated properties and Boolean response without SQL', async () => {
      expect(await invoke()).toBe(true);
      expect(viewRepository.updateOne).toHaveBeenCalledTimes(1);
      expect(viewRepository.updateOne).toHaveBeenCalledWith(viewId, {
        name: lastRead === 'name-validation' ? 'edited_view' : 'original_view',
        properties: JSON.stringify({
          original: 'retained',
          description: null,
          columns: [
            {
              name: 'original_column',
              properties: { original: 'retained', description: null },
            },
          ],
          ...(lastRead === 'name-validation'
            ? { displayName: 'edited_view' }
            : {}),
        }),
      });
      expect(events[events.indexOf('write-view') - 1]).toBe('fresh-manage');
      expect(context).not.toHaveProperty('nativeProjectCheck');
      expect(context.queryService.validate).not.toHaveBeenCalled();
      expect(context.queryService.preview).not.toHaveBeenCalled();
    });

    it.each(['revoked', 'generation', 'delivery', 'identity', 'scope'])(
      'refuses %s during the last original native read before its only write',
      async (change) => {
        afterRead = (stage) => {
          if (stage !== lastRead) return;
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
        expect(viewRepository.updateOne).not.toHaveBeenCalled();
      },
    );

    it('refuses a bound raw resolver without the captured original permission closure', async () => {
      await expect(
        new ModelResolver().updateViewMetadata(
          undefined,
          { where: { id: viewId }, data: input() },
          context,
        ),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(viewRepository.updateOne).not.toHaveBeenCalled();
    });

    it('keeps an entirely unconfigured independent native editor and original return shape', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      expect(await invoke()).toBe(true);
      expect(viewRepository.updateOne).toHaveBeenCalledTimes(1);
      expect(bindingServiceCall).not.toHaveBeenCalled();
    });

    it.each(['delivery', 'identity', 'scope'])(
      'refuses %s appearing at the last independent read instead of adopting the independent write',
      async (change) => {
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        delete context.nativeHumanToken;
        delete context.nativeIdentityScope;
        afterRead = (stage) => {
          if (stage !== lastRead) return;
          if (change === 'delivery')
            process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
              'controlled-test-delivery';
          else if (change === 'identity')
            context.nativeHumanToken = 'new-test-person';
          else context.nativeIdentityScope = 'b'.repeat(64);
        };
        await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
        expect(viewRepository.updateOne).not.toHaveBeenCalled();
      },
    );

    it.each(['lost-response', 'forged-not-started'])(
      'keeps %s after native write dispatch UNKNOWN without a retry',
      async (cause) => {
        viewRepository.updateOne.mockImplementation(async () => {
          const error: any = new Error(
            'Original native view metadata response unavailable',
          );
          if (cause === 'forged-not-started')
            error.extensions = {
              other: { nativeWrite: { outcome: 'NOT_STARTED' } },
            };
          throw error;
        });
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(viewRepository.updateOne).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['revoked', 'generation', 'identity', 'scope'])(
      'keeps %s after its actual native write UNKNOWN without inventing a failed write',
      async (change) => {
        afterWrite = () => {
          if (change === 'revoked') revoked = true;
          else if (change === 'generation') generation++;
          else if (change === 'identity')
            context.nativeHumanToken = 'changed-test-person';
          else context.nativeIdentityScope = 'b'.repeat(64);
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(viewRepository.updateOne).toHaveBeenCalledTimes(1);
      },
    );
  },
);

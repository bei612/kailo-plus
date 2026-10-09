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

describe.each([
  ['deleteModel', 'modelRepository'],
  ['deleteView', 'viewRepository'],
])('original %s final native deletion boundary', (method, repositoryName) => {
  const projectId = 3;
  const nativeId = 7;
  const resolver = new ModelResolver();
  let previous: string | undefined;
  let context: any;
  let delivery: any;
  let generation: number;
  let revoked: boolean;
  let afterRow: () => void;
  const repository = {
    findOneBy: jest.fn(),
    deleteOne: jest.fn(),
  };
  const invoke = () =>
    originalResolvers.Mutation[method](
      undefined,
      { where: { id: nativeId } },
      context,
    );
  const failure = async () => {
    try {
      await invoke();
    } catch (error) {
      return error as any;
    }
    throw new Error('Original native deletion unexpectedly succeeded');
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
    afterRow = () => {};
    context = {
      nativeHumanToken: 'verified-test-person',
      nativeIdentityScope: 'a'.repeat(64),
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      [repositoryName]: repository,
    };
    repository.findOneBy.mockReset().mockImplementation(async (where) => {
      expect(where.id).toBe(nativeId);
      afterRow();
      return { id: nativeId, projectId: where.projectId };
    });
    repository.deleteOne.mockReset().mockResolvedValue(undefined);
    jest
      .mocked(loadQueryDelivery)
      .mockReset()
      .mockImplementation(async () => structuredClone(delivery));
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockImplementation(async (config, operation, input, bearer) => {
        expect(operation).toBe('human-action');
        expect(bearer).toBe('verified-test-person');
        expect(input).toEqual({
          bindingId: config.bindingId,
          authorizeScope: { permission: 'manage' },
        });
        if (revoked) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        return {
          scope: {
            ...config,
            generation,
            permission: 'manage',
            checkedRevision: 'current-native-management',
          },
        };
      });
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });

  it('keeps the original admitted deletion and rechecks after the row read', async () => {
    expect(await invoke()).toBe(true);
    expect(repository.findOneBy).toHaveBeenCalledWith({
      id: nativeId,
      projectId,
    });
    expect(repository.deleteOne).toHaveBeenCalledTimes(1);
    expect(repository.deleteOne).toHaveBeenCalledWith(nativeId);
    expect(bindingServiceCall).toHaveBeenCalledTimes(3);
  });

  it('refuses a second current-project selection before deleting its row', async () => {
    context.projectService.getCurrentProject
      .mockResolvedValueOnce({ id: projectId })
      .mockResolvedValueOnce({ id: projectId + 1 });
    const error = await failure();
    expect(error.code).toBe('QUERY_SCOPE_DENIED');
    expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
    expect(repository.deleteOne).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'generation', 'delivery', 'identity'])(
    'refuses %s changes during the last native row read without a delete',
    async (change) => {
      afterRow = () => {
        if (change === 'revoked') revoked = true;
        else if (change === 'generation') generation++;
        else if (change === 'delivery')
          delivery = { ...delivery, workspaceId: 'another-fixture-workspace' };
        else context.nativeHumanToken = 'changed-test-person';
      };
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
      expect(repository.deleteOne).not.toHaveBeenCalled();
    },
  );

  it.each(['lost-response', 'forged-not-started'])(
    'retains UNKNOWN for %s after native deletion dispatch and never retries',
    async (cause) => {
      repository.deleteOne.mockImplementation(async () => {
        const error: any = new Error('Native delete response unavailable');
        if (cause === 'forged-not-started')
          error.extensions = {
            other: { nativeWrite: { outcome: 'NOT_STARTED' } },
          };
        throw error;
      });
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(repository.deleteOne).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a bound direct resolver without its trusted dispatch closure', async () => {
    await expect(
      resolver[method](undefined, { where: { id: nativeId } }, context),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    expect(repository.deleteOne).not.toHaveBeenCalled();
  });

  it('keeps the entirely unconfigured independent original deletion', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete context.nativeHumanToken;
    delete context.nativeIdentityScope;
    expect(await invoke()).toBe(true);
    expect(repository.deleteOne).toHaveBeenCalledTimes(1);
    expect(bindingServiceCall).not.toHaveBeenCalled();
  });

  it('refuses configuration arriving during an independent row read', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete context.nativeHumanToken;
    delete context.nativeIdentityScope;
    afterRow = () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-test-delivery';
    };
    await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    expect(repository.deleteOne).not.toHaveBeenCalled();
  });
});

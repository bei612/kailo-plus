import originalResolvers from './apollo/server/resolvers';
import { LearningResolver } from './apollo/server/resolvers/learningResolver';
import { GeneralErrorCodes } from './apollo/server/utils/error';
import { loadQueryDelivery } from './apollo/server/services/nativeQueryAdmission';
import { authorizeNativeScope } from './apollo/server/services/nativeHumanQuery';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./apollo/server/services/nativeHumanQuery', () => ({
  ...jest.requireActual('./apollo/server/services/nativeHumanQuery'),
  authorizeNativeScope: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

// DD-138(7): help and learning guidance come only from Kailo; the original
// learning record is closed on the server in both query modes.
describe('the original learning record is closed', () => {
  const forbidden = {
    extensions: { code: GeneralErrorCodes.KAILO_FEATURE_UNAVAILABLE },
  };
  let previous: string | undefined;
  let ctx: any;
  const untouched = () => {
    for (const method of Object.values(ctx.learningRepository))
      expect(method).not.toHaveBeenCalled();
    expect(ctx.projectService.getCurrentProject).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    ctx = {
      kailoUser: { key: 'a'.repeat(64), admin: true },
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-human',
      projectService: { getCurrentProject: jest.fn(async () => ({ id: 3 })) },
      learningRepository: {
        findAll: jest.fn(async () => [{ paths: ['start'] }]),
        findAllBy: jest.fn(async () => [{ paths: ['start'] }]),
        createOne: jest.fn(),
        updateOne: jest.fn(),
        saveNativePath: jest.fn(),
      },
    };
    jest
      .mocked(loadQueryDelivery)
      .mockReset()
      .mockResolvedValue({
        projectId: 3,
        bindingId: 'binding',
        nativeInstanceRef: 'instance',
        nativeScopeRef: '3',
      } as any);
    jest
      .mocked(authorizeNativeScope)
      .mockReset()
      .mockResolvedValue({ generation: 1 } as any);
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });

  test.each(['STANDALONE', 'GOVERNED'])(
    'the resolver refuses read and write without a learning row (%s)',
    async (mode) => {
      if (mode === 'GOVERNED')
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
      else delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      const resolver = new LearningResolver();
      await expect(
        resolver.getLearningRecord(null, null, ctx),
      ).rejects.toMatchObject(forbidden);
      await expect(
        resolver.saveLearningRecord(null, { data: { path: 'start' } }, ctx),
      ).rejects.toMatchObject(forbidden);
      untouched();
    },
  );

  test('the GraphQL operations are refused, an admin included', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    await expect(
      (originalResolvers.Query as any).learningRecord(undefined, {}, ctx),
    ).rejects.toMatchObject(forbidden);
    await expect(
      (originalResolvers.Mutation as any).saveLearningRecord(
        undefined,
        { data: { path: 'start' } },
        ctx,
      ),
    ).rejects.toMatchObject(forbidden);
    untouched();
  });
});

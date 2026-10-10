import { LearningResolver } from './apollo/server/resolvers/learningResolver';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { authorizeNativeScope } from './apollo/server/services/nativeHumanQuery';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./apollo/server/services/nativeHumanQuery', () => ({
  ...jest.requireActual('./apollo/server/services/nativeHumanQuery'),
  authorizeNativeScope: jest.fn(),
}));

describe('original learning records consume the verified native person', () => {
  const resolver = new LearningResolver();
  let previous: string | undefined;
  let ctx: any;
  let epoch: number;
  let config: any;
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
      'controlled-learning-delivery';
    config = {
      projectId: 3,
      bindingId: 'binding',
      nativeInstanceRef: 'instance',
      nativeScopeRef: 'project',
    };
    epoch = 1;
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-human',
      projectService: { getCurrentProject: jest.fn(async () => ({ id: 3 })) },
      learningRepository: {
        findAll: jest.fn(() => {
          throw new Error('global read forbidden');
        }),
        findAllBy: jest.fn(async ({ userId }) => [
          { userId, paths: ['start'] },
        ]),
        saveNativePath: jest.fn(async (_project, userId, path, beforeWrite) => {
          await beforeWrite();
          return { userId, paths: [path] };
        }),
      },
    };
    jest
      .mocked(loadQueryDelivery)
      .mockReset()
      .mockImplementation(async () => structuredClone(config));
    jest
      .mocked(authorizeNativeScope)
      .mockReset()
      .mockImplementation(async () => ({ generation: epoch }) as any);
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });
  test('two verified people never select the global first row', async () => {
    await resolver.getLearningRecord(null, null, ctx);
    const first = ctx.learningRepository.findAllBy.mock.calls[0][0].userId;
    ctx.nativeIdentityScope = 'b'.repeat(64);
    await resolver.getLearningRecord(null, null, ctx);
    expect(ctx.learningRepository.findAllBy.mock.calls[1][0].userId).not.toBe(
      first,
    );
    expect(ctx.learningRepository.findAll).not.toHaveBeenCalled();
  });
  test('read refuses a generation switch after repository read', async () => {
    ctx.learningRepository.findAllBy.mockImplementation(async () => {
      epoch++;
      return [];
    });
    await expect(resolver.getLearningRecord(null, null, ctx)).rejects.toThrow();
  });
  test('missing verified identity cannot fall back to standalone data', async () => {
    delete ctx.nativeIdentityScope;
    await expect(resolver.getLearningRecord(null, null, ctx)).rejects.toThrow();
    expect(ctx.learningRepository.findAllBy).not.toHaveBeenCalled();
  });
  test('project mismatch is refused before accessing learning rows', async () => {
    config.projectId = 9;
    await expect(
      resolver.saveLearningRecord(null, { data: { path: 'start' } }, ctx),
    ).rejects.toThrow();
    expect(ctx.learningRepository.saveNativePath).not.toHaveBeenCalled();
  });
  test('revocation while waiting for native transaction prevents its write', async () => {
    let wrote = false;
    ctx.learningRepository.saveNativePath.mockImplementation(
      async (_project, _user, _path, beforeWrite) => {
        jest
          .mocked(authorizeNativeScope)
          .mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
        await beforeWrite();
        wrote = true;
      },
    );
    await expect(
      resolver.saveLearningRecord(null, { data: { path: 'start' } }, ctx),
    ).rejects.toThrow();
    expect(wrote).toBe(false);
  });
  test('write uses the original project, personal partition and path', async () => {
    const result = await resolver.saveLearningRecord(
      null,
      { data: { path: 'start' } },
      ctx,
    );
    expect(result.paths).toEqual(['start']);
    expect(ctx.learningRepository.saveNativePath.mock.calls[0][0]).toBe(3);
    expect(ctx.learningRepository.saveNativePath.mock.calls[0][1]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      jest
        .mocked(authorizeNativeScope)
        .mock.calls.every((call) => call[2] === 'discover'),
    ).toBe(true);
  });
  test('a committed write followed by revocation is not labeled unstarted or successful', async () => {
    let committed: any;
    ctx.learningRepository.saveNativePath.mockImplementation(
      async (_project, userId, path, beforeWrite) => {
        await beforeWrite();
        epoch++;
        committed = { userId, paths: [path, path] };
        return committed;
      },
    );
    await expect(
      resolver.saveLearningRecord(null, { data: { path: 'start' } }, ctx),
    ).rejects.toMatchObject({
      extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
    });
    ctx.learningRepository.findAllBy.mockImplementation(async ({ userId }) =>
      committed.userId === userId ? [committed] : [],
    );
    expect(await resolver.getLearningRecord(null, null, ctx)).toEqual({
      paths: ['start'],
    });
    expect(ctx.learningRepository.saveNativePath).toHaveBeenCalledTimes(1);
  });
});

import { SqlPairResolver } from './apollo/server/resolvers/sqlPairResolver';
import { SqlPairService } from './apollo/server/services/sqlPairService';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { authorizeNativeScope } from './apollo/server/services/nativeHumanQuery';
import { QuestionsStatus } from './apollo/server/models/adaptor';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./apollo/server/services/nativeHumanQuery', () => ({
  ...jest.requireActual('./apollo/server/services/nativeHumanQuery'),
  authorizeNativeScope: jest.fn(),
}));

describe('original SQL question generation consumes native project and person', () => {
  let previous: string | undefined;
  let config: any;
  let ctx: any;
  let ai: any;
  let epoch: number;
  const resolver = new SqlPairResolver();
  const run = () =>
    resolver.generateQuestion(null, { data: { sql: 'select 1' } }, ctx);
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
      'controlled-question-delivery';
    config = {
      projectId: 3,
      bindingId: 'binding',
      nativeInstanceRef: 'instance',
      nativeScopeRef: '3',
    };
    epoch = 1;
    ai = {
      generateQuestions: jest.fn(async () => ({ queryId: 'original-task' })),
      getQuestionsResult: jest.fn(async () => ({
        status: QuestionsStatus.SUCCEEDED,
        questions: ['Question?'],
      })),
    };
    const service = new SqlPairService({
      sqlPairRepository: {} as any,
      wrenAIAdaptor: ai,
      ibisAdaptor: {} as any,
    });
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-human',
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: 3, language: 'EN' })),
      },
      sqlPairService: service,
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
    jest.useRealTimers();
  });
  test('the actual resolver and service authorize the verified person and same project', async () => {
    expect(await run()).toBe('Question?');
    expect(ai.generateQuestions).toHaveBeenCalledTimes(1);
    expect(ai.generateQuestions.mock.calls[0][0]).toMatchObject({
      projectId: 3,
      sqls: ['select 1'],
    });
    expect(
      jest
        .mocked(authorizeNativeScope)
        .mock.calls.every(
          (call) => call[1] === 'verified-human' && call[2] === 'manage',
        ),
    ).toBe(true);
    expect(ai.getQuestionsResult).toHaveBeenCalledWith('original-task');
  });
  test('direct service calls without native context fail closed in binding mode', async () => {
    await expect(
      ctx.sqlPairService.generateQuestions({ id: 3 }, ['select 1']),
    ).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
    expect(ai.generateQuestions).not.toHaveBeenCalled();
  });
  test('missing trusted person never dispatches', async () => {
    delete ctx.nativeIdentityScope;
    await expect(run()).rejects.toThrow();
    expect(ai.generateQuestions).not.toHaveBeenCalled();
  });
  test('a different current project cannot borrow configured project authority', async () => {
    ctx.projectService.getCurrentProject.mockResolvedValue({
      id: 9,
      language: 'EN',
    });
    await expect(run()).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(ai.generateQuestions).not.toHaveBeenCalled();
  });
  test('generation changing before dispatch refuses without model traffic', async () => {
    jest
      .mocked(authorizeNativeScope)
      .mockImplementation(async () => ({ generation: epoch++ }) as any);
    await expect(run()).rejects.toThrow('QUERY_REFERENCE_CHANGED');
    expect(ai.generateQuestions).not.toHaveBeenCalled();
  });
  test('revocation after POST hides results and never reissues the task', async () => {
    ai.generateQuestions.mockImplementation(async () => {
      jest
        .mocked(authorizeNativeScope)
        .mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
      return { queryId: 'original-task' };
    });
    await expect(run()).rejects.toMatchObject({
      extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
    });
    expect(ai.generateQuestions).toHaveBeenCalledTimes(1);
    expect(ai.getQuestionsResult).not.toHaveBeenCalled();
  });
  test('generation changing during result read prevents result exposure', async () => {
    ai.getQuestionsResult.mockImplementation(async () => {
      epoch++;
      return { status: QuestionsStatus.SUCCEEDED, questions: ['secret'] };
    });
    await expect(run()).rejects.toMatchObject({
      extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
    });
  });
  test('revocation while polling prevents another read', async () => {
    ai.getQuestionsResult.mockImplementation(async () => {
      epoch++;
      return { status: QuestionsStatus.GENERATING };
    });
    const pending = expect(run()).rejects.toMatchObject({
      extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
    });
    await pending;
    expect(ai.getQuestionsResult).toHaveBeenCalledTimes(1);
  });
  test.each([
    { status: 'UNRECOGNIZED' },
    { status: QuestionsStatus.SUCCEEDED, questions: [] },
  ])('missing terminal evidence remains unknown: %j', async (result) => {
    ai.getQuestionsResult.mockResolvedValue(result);
    await expect(run()).rejects.toMatchObject({
      extensions: { other: { nativeWrite: { outcome: 'UNKNOWN' } } },
    });
  });
  test('an observed native failure retains its real terminal failure', async () => {
    ai.getQuestionsResult.mockResolvedValue({
      status: QuestionsStatus.FAILED,
      error: { message: 'actual provider refusal' },
    });
    await expect(run()).rejects.toMatchObject({
      extensions: { code: 'GENERATE_QUESTIONS_ERROR' },
    });
  });
  test('original unbound calls remain available without fabricated platform context', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete ctx.nativeIdentityScope;
    delete ctx.nativeHumanToken;
    expect(await run()).toBe('Question?');
    expect(authorizeNativeScope).not.toHaveBeenCalled();
  });
});

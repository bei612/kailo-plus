import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { AskResultStatus, AskResultType } from './apollo/server/models/adaptor';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));

describe('original Asking saved-view readers', () => {
  const config = {
    bindingId: '8b066261-f827-462e-95c1-1d596fce1849',
    projectId: 3,
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: '3',
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
  } as NativeQueryDelivery;
  const resolution = {
    resource: {
      resourceId: 'f0d7d739-666c-4cdb-927b-4bad718c94e2',
      resourceVersion: 4,
      nativeType: 'view',
      nativeRef: '7',
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
    },
  };
  const originalView = {
    id: 7,
    projectId: 3,
    name: 'native_view',
    statement: 'SELECT customer FROM native_model',
    cached: false,
    properties: JSON.stringify({ displayName: 'Original view' }),
  };
  const originalResponse = {
    id: 21,
    threadId: 11,
    viewId: 7,
    question: 'Original question',
    sql: 'SELECT customer FROM native_view',
    askingTaskId: 17,
    answerDetail: { content: 'Original answer' },
    chartDetail: { chartSchema: { title: 'Original chart' } },
  };
  const originalTask = {
    projectId: 3,
    queryId: 'owned-query',
    status: AskResultStatus.FINISHED,
    type: AskResultType.TEXT_TO_SQL,
    response: [{ type: 'view', viewId: 7, sql: originalResponse.sql }],
    traceId: 'native-trace',
    error: null,
  };
  const consumers = [
    'task',
    'candidate',
    'response-view',
    'thread',
    'response',
  ];
  const calls = jest.mocked(bindingServiceCall);
  let resolver: AskingResolver;
  let ctx: any;
  beforeEach(() => {
    jest.mocked(loadQueryDelivery).mockReset().mockResolvedValue(config);
    calls.mockReset().mockResolvedValue(resolution);
    resolver = new AskingResolver();
    ctx = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'human-a',
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: 3 })),
      },
      askingService: {
        getAskingTask: jest.fn(async () => ({ ...originalTask })),
        getAskingTaskById: jest.fn(async () => ({ ...originalTask })),
        getResponse: jest.fn(async () => ({ ...originalResponse })),
        getResponsesWithThread: jest.fn(async () => [{ ...originalResponse }]),
      },
      viewRepository: {
        findOneBy: jest.fn(async (where) =>
          where.id === originalView.id &&
          where.projectId === originalView.projectId
            ? { ...originalView }
            : null,
        ),
      },
      sqlPairRepository: { findOneBy: jest.fn() },
      telemetry: { sendEvent: jest.fn() },
    };
  });

  function invoke(consumer: string, context = ctx) {
    switch (consumer) {
      case 'task':
        return resolver.getAskingTask(
          {},
          { taskId: originalTask.queryId },
          context,
        );
      case 'candidate':
        return resolver
          .getResultCandidateNestedResolver()
          .view(
            { view: { ...originalView, statement: 'forged parent SQL' } },
            {},
            context,
          );
      case 'response-view':
        return resolver
          .getThreadResponseNestedResolver()
          .view(originalResponse as any, {}, context);
      case 'thread':
        return resolver.getThread({}, { threadId: 11 }, context);
      case 'response':
        return resolver.getResponse({}, { responseId: 21 }, context);
      default:
        throw new Error('Unknown reader');
    }
  }

  it.each(consumers)(
    '%s preserves original data only after exact current HUMAN Resource authorization',
    async (consumer) => {
      const result = await invoke(consumer);
      expect(result).toBeTruthy();
      if (consumer === 'candidate' || consumer === 'response-view')
        expect(result).toEqual({
          ...originalView,
          displayName: 'Original view',
        });
      if (consumer === 'task')
        expect((result as any).candidates).toEqual([
          {
            type: 'view',
            sql: originalResponse.sql,
            view: originalView,
            sqlPair: null,
          },
        ]);
      if (consumer === 'response') expect(result).toEqual(originalResponse);
      if (consumer === 'thread')
        expect((result as any).responses[0]).toMatchObject(originalResponse);
      expect(JSON.stringify(result)).not.toContain('forged parent SQL');
      expect(calls).toHaveBeenCalledTimes(2);
      for (const call of calls.mock.calls) {
        expect(call[2]).toEqual({
          bindingId: config.bindingId,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.describe@v1',
            actionVersion: 1,
            nativeType: 'view',
            nativeRef: '7',
          },
        });
        expect(call[3]).toBe('human-a');
      }
      expect(ctx.viewRepository.findOneBy).toHaveBeenCalledTimes(2);
      for (const call of ctx.viewRepository.findOneBy.mock.calls)
        expect(call[0]).toEqual({ id: 7, projectId: 3 });
    },
  );

  it.each(consumers)(
    '%s refuses denied cached/native view content before body lookup or telemetry',
    async (consumer) => {
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true),
      );
      await expect(invoke(consumer)).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(ctx.viewRepository.findOneBy).not.toHaveBeenCalled();
      expect(ctx.telemetry.sendEvent).not.toHaveBeenCalled();
    },
  );

  it.each(consumers)(
    '%s refuses permission revoked while reading without disclosing a partial answer',
    async (consumer) => {
      calls
        .mockResolvedValueOnce(resolution)
        .mockRejectedValueOnce(
          new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true),
        );
      await expect(invoke(consumer)).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(ctx.telemetry.sendEvent).not.toHaveBeenCalled();
    },
  );

  it.each(['token', 'identity', 'binding-project', 'task-project'])(
    'refuses %s mismatch before declaring a native cached task usable',
    async (failure) => {
      if (failure === 'token') delete ctx.nativeHumanToken;
      if (failure === 'identity') ctx.nativeIdentityScope = 'untrusted-scope';
      if (failure === 'binding-project')
        jest
          .mocked(loadQueryDelivery)
          .mockResolvedValue({ ...config, projectId: 8 });
      if (failure === 'task-project')
        ctx.askingService.getAskingTask.mockResolvedValue({
          ...originalTask,
          projectId: 8,
        });
      await expect(invoke('task')).rejects.toThrow(
        failure === 'token' || failure === 'identity'
          ? 'NATIVE_AUTHENTICATION_REQUIRED'
          : 'QUERY_SCOPE_DENIED',
      );
      expect(calls).not.toHaveBeenCalled();
      expect(ctx.viewRepository.findOneBy).not.toHaveBeenCalled();
      expect(ctx.telemetry.sendEvent).not.toHaveBeenCalled();
    },
  );

  it.each(['version', 'resource', 'view', 'deleted', 'scope'])(
    'refuses %s changes before returning a cached candidate',
    async (changed) => {
      if (
        changed === 'version' ||
        changed === 'resource' ||
        changed === 'scope'
      )
        calls.mockResolvedValueOnce(resolution).mockResolvedValueOnce({
          resource: {
            ...resolution.resource,
            ...(changed === 'version'
              ? { resourceVersion: 5 }
              : changed === 'resource'
                ? { resourceId: config.bindingId }
                : { nativeScopeRef: '8' }),
          },
        });
      if (changed === 'view' || changed === 'deleted')
        ctx.viewRepository.findOneBy
          .mockResolvedValueOnce({ ...originalView })
          .mockResolvedValueOnce(
            changed === 'deleted'
              ? null
              : { ...originalView, statement: 'SELECT changed' },
          );
      await expect(invoke('task')).rejects.toThrow(
        changed === 'scope'
          ? 'QUERY_SCOPE_DENIED'
          : 'QUERY_EVIDENCE_UNAVAILABLE',
      );
      expect(ctx.telemetry.sendEvent).not.toHaveBeenCalled();
    },
  );

  it('does not share credentials or cached view permission between independent people', async () => {
    calls.mockImplementation(async (_config, _route, _body, token) => {
      if (token !== 'human-a')
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true);
      return resolution;
    });
    await expect(invoke('candidate')).resolves.toMatchObject(originalView);
    const other = {
      ...ctx,
      nativeHumanToken: 'human-b',
      nativeIdentityScope: 'b'.repeat(64),
    };
    await expect(invoke('candidate', other)).rejects.toThrow(
      'QUERY_SCOPE_DENIED',
    );
    expect(calls.mock.calls.map((call) => call[3])).toEqual([
      'human-a',
      'human-a',
      'human-b',
    ]);
  });

  it('rejects a forged or missing parent native view ID instead of returning parent content', async () => {
    const reader = resolver.getResultCandidateNestedResolver().view;
    await expect(
      reader({ view: { statement: 'forged parent SQL' } }, {}, ctx),
    ).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
    await expect(
      reader({ view: { ...originalView, projectId: 8 } }, {}, ctx),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(ctx.viewRepository.findOneBy).not.toHaveBeenCalled();
    expect(await reader({ view: null }, {}, ctx)).toBeNull();
  });

  it('keeps original thread ownership ahead of nested view Resource lookup', async () => {
    ctx.askingService.getResponse.mockResolvedValue({
      ...originalResponse,
      viewId: 8,
    });
    await expect(invoke('response-view')).rejects.toThrow(
      'Thread response not found',
    );
    expect(calls).not.toHaveBeenCalled();
    expect(ctx.viewRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('protects the native response askingTask field through the same exact view reader', async () => {
    calls.mockRejectedValue(
      new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED', true),
    );
    await expect(
      resolver
        .getThreadResponseNestedResolver()
        .askingTask(originalResponse as any, {}, ctx),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(ctx.askingService.getAskingTaskById).toHaveBeenCalledWith(17);
    expect(ctx.viewRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('validates current identity for zero-view tasks, and preserves null responses and empty threads', async () => {
    ctx.askingService.getAskingTask.mockResolvedValue({
      ...originalTask,
      response: [],
    });
    expect(((await invoke('task')) as any).candidates).toEqual([]);
    expect(calls).not.toHaveBeenCalled();
    ctx.askingService.getResponsesWithThread.mockResolvedValue([]);
    expect(await invoke('thread')).toEqual({});
    ctx.askingService.getResponse.mockResolvedValue(null);
    expect(await invoke('response')).toBeNull();
    delete ctx.nativeHumanToken;
    await expect(invoke('task')).rejects.toThrow(
      'NATIVE_AUTHENTICATION_REQUIRED',
    );
  });
});

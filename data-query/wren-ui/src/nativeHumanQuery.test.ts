import {
  NativeHumanQuery,
  nativePreviewScope,
} from './apollo/server/services/nativeHumanQuery';
import { NativeQueryService } from './apollo/server/services/nativeQueryService';
import { ApiHistoryRepository } from './apollo/server/repositories/apiHistoryRepository';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { getQueryPreviewText } from './utils/language';
import referenceHandler from './pages/api/platform-query-reference';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe('native saved-view HUMAN query consumer', () => {
  const key = 'eb9081b2-1e2b-44e9-85c5-15b09e43c4a1';
  const binding = '8b066261-f827-462e-95c1-1d596fce1849';
  const resource = 'f0d7d739-666c-4cdb-927b-4bad718c94e2';
  const reference = {
    resourceId: resource,
    nativeObjectRef: JSON.stringify({ viewId: 7, limit: 10 }),
    nativeRevision: 'a'.repeat(64),
    displayName: 'saved view',
    mediaType: 'application/json',
  };
  const submission = {
    actionExecutionId: '1c52c02c-0136-4652-a8d5-2af3921edbfc',
    operationId: '5f4ccbf4-a794-48f2-8bd1-39b453e623f7',
    actionKey: 'data_query.query@v1',
    gateState: 'ALLOWED',
    dispatchState: 'DISPATCHED',
  };
  const receipt = { submission, inputReference: reference };
  const config = {
    bindingId: binding,
    projectId: 3,
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: '3',
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
    humanAction: {
      resultExposurePolicyId: 'f50e30ee-a9c6-4406-8620-7e45262f3145',
      resultExposurePolicyVersion: 1,
    },
  } as NativeQueryDelivery;
  const resolution = {
    resource: {
      resourceId: resource,
      resourceVersion: 4,
      nativeType: 'view',
      nativeRef: '7',
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
    },
  };
  const calls = jest.mocked(bindingServiceCall);
  let freeze: jest.Mock, history: jest.Mock, service: NativeHumanQuery;
  beforeEach(() => {
    calls.mockReset();
    freeze = jest.fn().mockResolvedValue(reference);
    history = jest.fn();
    service = new NativeHumanQuery(
      config,
      {
        reference: freeze,
        modelReference: freeze,
      } as unknown as NativeQueryService,
      { findOneBy: history } as unknown as ApiHistoryRepository,
    );
  });
  it('submits only a saved reference through the original action and never treats dispatch as data', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(freeze).toHaveBeenCalledWith(resource, 7, 10, undefined);
    expect(calls.mock.calls[1][2]).toEqual({
      bindingId: binding,
      resolveResource: {
        workspaceId: config.workspaceId,
        actionKey: 'data_query.query@v1',
        actionVersion: 1,
        nativeType: 'view',
        nativeRef: '7',
      },
    });
    const command = calls.mock.calls[2][2].command as any;
    expect(command.resourceId).toBe(resource);
    expect(command.resourceVersion).toBe(4);
    expect(command.componentAction.inputReference).toEqual(reference);
    expect(command.idempotencyKey).toBe(key);
    expect(command.actionKey).toBe('data_query.query@v1');
    expect(history).not.toHaveBeenCalled();
  });
  it('observes the same key without re-freezing a mutable view or repeating a query', async () => {
    calls.mockResolvedValue(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('selects different registered native objects without a configured global Resource and never reselects UNKNOWN', async () => {
    const cases = [
      { kind: 'view' as const, id: 7, resourceId: resource },
      { kind: 'model' as const, id: 8, resourceId: binding },
    ];
    for (const item of cases) {
      const frozen = {
        ...reference,
        resourceId: item.resourceId,
        nativeObjectRef: JSON.stringify({
          [item.kind === 'view' ? 'viewId' : 'modelId']: item.id,
          limit: 10,
        }),
      };
      const output = { ...receipt, inputReference: frozen };
      freeze.mockResolvedValueOnce(frozen);
      calls.mockReset();
      calls
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          resource: {
            ...resolution.resource,
            resourceId: item.resourceId,
            nativeType: item.kind,
            nativeRef: String(item.id),
          },
        })
        .mockResolvedValue(output);
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect((calls.mock.calls[2][2].command as any).resourceId).toBe(
        item.resourceId,
      );
      calls.mockClear();
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][2]).toEqual({
        bindingId: binding,
        idempotencyKey: item.resourceId,
      });
    }
    expect(freeze).toHaveBeenCalledTimes(2);
  });

  it.each([
    'missing',
    'resourceId',
    'resourceVersion',
    'nativeType',
    'nativeRef',
    'nativeInstanceRef',
    'nativeScopeRef',
  ])(
    'does not freeze or submit with %s invalid registered-resource facts',
    async (field) => {
      const changed =
        field === 'missing'
          ? null
          : {
              resource: {
                ...resolution.resource,
                [field]: field === 'resourceVersion' ? 0 : 'foreign-object',
              },
            };
      calls.mockResolvedValueOnce(null).mockResolvedValueOnce(changed);
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(freeze).not.toHaveBeenCalled();
    },
  );

  it('refuses forbidden resource resolution and a submission receipt for another resolved Resource', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(freeze).not.toHaveBeenCalled();
    calls.mockReset();
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce({
        ...receipt,
        inputReference: { ...reference, resourceId: binding },
      });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
  });
  it('does not submit after an unavailable or denied observation', async () => {
    calls.mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });
  it('returns original history only for the same AE, operation, binding and a second current admission', async () => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    calls.mockResolvedValue(completed);
    history.mockResolvedValue({ responsePayload: { columns: [], data: [] } });
    expect(
      (await service.preview('verified-native-token', 7, 10, key)).data,
    ).toEqual({ columns: [], data: [] });
    expect(history).toHaveBeenCalledWith({
      id: 'native-result',
      projectId: 3,
      governanceBindingId: binding,
      governanceActionExecutionId: submission.actionExecutionId,
      governanceOperationId: submission.operationId,
      governanceState: 'SUCCEEDED',
    });
    expect(calls).toHaveBeenCalledTimes(2);
    calls.mockReset();
    calls
      .mockResolvedValueOnce(completed)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
  });
  it('rejects another saved view or resource instead of exposing the result', async () => {
    calls.mockResolvedValue({
      ...receipt,
      inputReference: { ...reference, resourceId: 'invalid-reference' },
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    calls.mockResolvedValue(receipt);
    await expect(
      service.preview('verified-native-token', 8, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });
  it('requires an actual HUMAN token and delivered resource selection', async () => {
    await expect(service.preview(undefined, 7, 10, key)).rejects.toThrow(
      'NATIVE_HUMAN_ADMISSION_UNAVAILABLE',
    );
    const disabled = new NativeHumanQuery(
      { ...config, humanAction: undefined },
      {} as NativeQueryService,
      {} as ApiHistoryRepository,
    );
    await expect(
      disabled.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    expect(calls).not.toHaveBeenCalled();
  });

  it('admits the original model preview and reconciles its frozen model reference without issuing SQL', async () => {
    const modelReference = {
      ...reference,
      nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
    };
    const modelReceipt = { ...receipt, inputReference: modelReference };
    freeze.mockResolvedValue(modelReference);
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        resource: { ...resolution.resource, nativeType: 'model' },
      })
      .mockResolvedValue(modelReceipt);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(
      (calls.mock.calls[2][2].command as any).componentAction.inputReference,
    ).toEqual(modelReference);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    await expect(
      service.preview('verified-native-token', 8, 10, key, 'model'),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });

  it('routes the actual model resolver through HUMAN admission rather than direct engine preview', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-native-token',
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
      },
      modelRepository: {
        findOneBy: jest.fn().mockResolvedValue({ id: 7, projectId: 3 }),
      },
      queryService: { preview: jest.fn() },
    };
    const modelReceipt = {
      ...receipt,
      inputReference: {
        ...reference,
        nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
      },
    };
    calls.mockResolvedValue(modelReceipt);
    const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
    expect(
      await new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: scope,
          },
        },
        ctx,
      ),
    ).toEqual({ ...modelReceipt, previewScope: scope });
    expect(ctx.modelRepository.findOneBy).toHaveBeenCalledWith({
      id: 7,
      projectId: 3,
    });
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(1);
    await expect(
      new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: 'forged',
          },
        },
        ctx,
      ),
    ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  describe('original Asking saved-view preview consumer', () => {
    const view = {
      id: 7,
      projectId: 3,
      name: 'native_view',
      statement: 'SELECT customer FROM native_model',
    };
    let ctx: any, where: any, observed: any, command: any;
    let completed: boolean;
    beforeEach(() => {
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      completed = false;
      observed = null;
      command = null;
      const response = { id: 21, threadId: 11, viewId: 7, sql: view.statement };
      ctx = {
        nativeIdentityScope: 'a'.repeat(64),
        nativeHumanToken: 'verified-native-token',
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: 3 })),
        },
        askingService: {
          getResponse: jest.fn(async () => ({ ...response })),
        },
        viewRepository: {
          findOneBy: jest.fn(async () => ({ ...view })),
        },
        deployRepository: {
          findLastProjectDeployLog: jest.fn(async () => ({
            id: 12,
            projectId: 3,
            hash: 'b'.repeat(40),
            status: 'SUCCESS',
          })),
        },
        queryService: { preview: jest.fn() },
      };
      where = {
        responseId: 21,
        limit: 10,
        idempotencyKey: key,
        idempotencyScope: nativePreviewScope(config, ctx.nativeIdentityScope),
      };
      require('./common').components.apiHistoryRepository.findOneBy = history;
      history.mockResolvedValue({
        responsePayload: {
          columns: [{ name: 'customer' }],
          data: [['native']],
        },
      });
      calls.mockImplementation(async (_config, _operation, input, token) => {
        expect(token).toBe('verified-native-token');
        const payload = input as any;
        if (payload.resolveResource) return resolution;
        if (payload.command) {
          command = payload.command;
          observed = {
            submission,
            inputReference: command.componentAction.inputReference,
            ...(completed
              ? {
                  terminalStatus: 'COMPLETED',
                  nativeType: 'wren.api_history',
                  nativeId: 'native-result',
                }
              : {}),
          };
        }
        return observed;
      });
    });
    it.each([false, true])(
      'uses real original view reference/admission/result consumers without direct SQL (completed=%s)',
      async (isCompleted) => {
        completed = isCompleted;
        const result = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(result).toMatchObject({
          responseId: 21,
          viewId: 7,
          previewScope: where.idempotencyScope,
          inputReference: {
            resourceId: resource,
            nativeObjectRef: expect.any(String),
            nativeRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(JSON.parse(result.inputReference.nativeObjectRef)).toEqual({
          viewId: 7,
          deploymentId: 12,
          deploymentHash: 'b'.repeat(40),
          limit: 10,
        });
        expect(command).toMatchObject({
          actionKey: 'data_query.query@v1',
          idempotencyKey: key,
          resourceId: resource,
          resourceVersion: 4,
        });
        expect(JSON.stringify(command)).not.toContain(view.statement);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        if (completed) {
          expect(result.data).toEqual({
            columns: [{ name: 'customer' }],
            data: [['native']],
          });
          expect(history).toHaveBeenCalledWith({
            id: 'native-result',
            projectId: 3,
            governanceBindingId: binding,
            governanceActionExecutionId: submission.actionExecutionId,
            governanceOperationId: submission.operationId,
            governanceState: 'SUCCEEDED',
          });
        } else {
          expect(result).not.toHaveProperty('data');
          expect(result).not.toHaveProperty('terminalStatus');
          expect(history).not.toHaveBeenCalled();
        }
        const replay = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(replay).toEqual(result);
        expect(
          ctx.deployRepository.findLastProjectDeployLog,
        ).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['scope', 'missing', 'generated', 'changed-sql', 'denied'])(
      'refuses %s before submitting a view query',
      async (failure) => {
        if (failure === 'scope') where.idempotencyScope = 'forged';
        if (failure === 'missing')
          ctx.askingService.getResponse.mockResolvedValue(null);
        if (failure === 'generated')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: null,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'changed-sql')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: 7,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'denied')
          calls.mockRejectedValue(
            new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
          );
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['response', 'view', 'revoked'])(
      'refuses %s changes after a completed query without returning its native rows',
      async (changed) => {
        completed = true;
        const original = ctx.askingService.getResponse.getMockImplementation();
        ctx.askingService.getResponse.mockImplementation(async () => {
          const value = await original();
          if (command && changed === 'response') value.sql = 'SELECT changed';
          return value;
        });
        const originalView =
          ctx.viewRepository.findOneBy.getMockImplementation();
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          const value = await originalView();
          if (command && changed === 'view') value.statement = 'SELECT changed';
          return value;
        });
        const originalCall = calls.getMockImplementation();
        calls.mockImplementation(async (...args) => {
          if (
            command &&
            changed === 'revoked' &&
            (args[2] as any).resolveResource
          )
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return originalCall(...args);
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command.actionKey).toBe('data_query.query@v1');
        expect(history).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each([false, true])(
      'refuses a changed view before command submission even if it changes back (ABA=%s)',
      async (changesBack) => {
        completed = true;
        let reads = 0;
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          reads++;
          // The initial authorized snapshot is S1. The actual reference read
          // sees S2; an eventual re-read alone would miss S1 -> S2 -> S1.
          return {
            ...view,
            statement:
              reads >= 3 && (!changesBack || reads === 3)
                ? 'SELECT private FROM another_model'
                : view.statement,
          };
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
        expect(reads).toBe(3);
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('does not reuse a previously frozen view statement for a changed Asking intent under the same key', async () => {
      let statement = 'SELECT previous FROM native_model';
      ctx.askingService.getResponse.mockImplementation(async () => ({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: statement,
      }));
      ctx.viewRepository.findOneBy.mockImplementation(async () => ({
        ...view,
        statement,
      }));
      const first = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(first).not.toHaveProperty('data');
      const frozen = first.inputReference.nativeRevision;
      statement = view.statement;
      await expect(
        new AskingResolver().previewData(null, { where }, ctx),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command.componentAction.inputReference.nativeRevision).toBe(
        frozen,
      );
      expect(
        ctx.deployRepository.findLastProjectDeployLog,
      ).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not substitute a saved-view reference for a partial CTE', async () => {
      ctx.askingService.getResponse.mockResolvedValue({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: view.statement,
        breakdownDetail: {
          steps: [
            {
              cteName: 'partial',
              summary: 'First step',
              sql: 'SELECT private FROM forbidden_model',
            },
          ],
        },
      });
      await expect(
        new AskingResolver().previewBreakdownData(
          null,
          {
            where: { ...where, stepIndex: 0 },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command).toBeNull();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not abandon the original preview when an unrelated answer finishes streaming', async () => {
      completed = true;
      const original = ctx.askingService.getResponse.getMockImplementation();
      ctx.askingService.getResponse.mockImplementation(async () => ({
        ...(await original()),
        answerDetail: {
          content: command
            ? 'Original answer finished'
            : 'Original answer streaming',
        },
      }));
      const result = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(result.data).toEqual({
        columns: [{ name: 'customer' }],
        data: [['native']],
      });
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(JSON.stringify(command)).not.toContain('Original answer');
    });
  });

  it('retains one person across credential rotation and separates another person or native binding', () => {
    const first = nativePreviewScope(config, 'a'.repeat(64));
    expect(
      nativePreviewScope(
        { ...config, serviceClientSecretFile: '/rotated-credential' },
        'a'.repeat(64),
      ),
    ).toBe(first);
    expect(nativePreviewScope(config, 'b'.repeat(64))).not.toBe(first);
    expect(
      nativePreviewScope({ ...config, bindingId: resource }, 'a'.repeat(64)),
    ).not.toBe(first);
    expect(() => nativePreviewScope(config, undefined)).toThrow(
      'NATIVE_AUTHENTICATION_REQUIRED',
    );
  });

  it('refuses forged or previous-person scope at the actual preview resolver before any Core or native call', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'b'.repeat(64),
      nativeHumanToken: 'verified-native-token',
    };
    for (const idempotencyScope of [
      undefined,
      'forged',
      nativePreviewScope(config, 'a'.repeat(64)),
    ]) {
      await expect(
        new ModelResolver().previewViewData(
          null,
          {
            where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    }
    expect(calls).not.toHaveBeenCalled();
    calls.mockResolvedValue(receipt);
    const idempotencyScope = nativePreviewScope(
      config,
      ctx.nativeIdentityScope,
    );
    expect(
      await new ModelResolver().previewViewData(
        null,
        {
          where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
        },
        ctx,
      ),
    ).toEqual({ ...receipt, previewScope: idempotencyScope });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('exports only the resolved native view resource through the actual reference handler', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers: { 'x-kailo-native-human-token': 'verified-native-token' },
          query: { viewId: '7', limit: '10' },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(reference);
      expect(nativeReference).toHaveBeenCalledWith(resource, 7, 10);
      expect(calls).toHaveBeenCalledTimes(2);
      for (const call of calls.mock.calls) {
        expect(call[2]).toEqual({
          bindingId: binding,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.query@v1',
            actionVersion: 1,
            nativeType: 'view',
            nativeRef: '7',
          },
        });
        expect(call[3]).toBe('verified-native-token');
      }
    } finally {
      nativeReference.mockRestore();
    }
  });

  it.each([
    'missing-token',
    'forged-resource',
    'denied',
    'revoked',
    'changed-resource',
    'changed-version',
  ])('does not disclose an exported reference for %s', async (failure) => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    if (failure === 'denied')
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
      );
    if (failure === 'revoked')
      calls
        .mockResolvedValueOnce(resolution)
        .mockRejectedValueOnce(
          new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
        );
    if (failure === 'changed-resource' || failure === 'changed-version')
      calls.mockResolvedValueOnce(resolution).mockResolvedValueOnce({
        resource: {
          ...resolution.resource,
          ...(failure === 'changed-resource'
            ? { resourceId: binding }
            : { resourceVersion: 5 }),
        },
      });
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers:
            failure === 'missing-token'
              ? {}
              : { 'x-kailo-native-human-token': 'verified-native-token' },
          query: {
            viewId: '7',
            limit: '10',
            ...(failure === 'forged-resource' ? { resourceId: resource } : {}),
          },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(
        failure === 'missing-token'
          ? 401
          : failure === 'forged-resource'
            ? 400
            : failure.startsWith('changed-')
              ? 409
              : 403,
      );
      expect(response.json).not.toHaveBeenCalledWith(reference);
      if (['missing-token', 'forged-resource', 'denied'].includes(failure))
        expect(nativeReference).not.toHaveBeenCalled();
    } finally {
      nativeReference.mockRestore();
    }
  });

  it('uses Chinese by default and a single English locale for necessary preview guidance', () => {
    expect(getQueryPreviewText().check).toBe('检查原查询');
    expect(getQueryPreviewText('en').check).toBe('Check query');
    expect(Object.values(getQueryPreviewText('en')).join(' ')).not.toMatch(
      /[\u4e00-\u9fff]/,
    );
    expect(getQueryPreviewText('zh-CN').pending).not.toContain(' / ');
  });
});

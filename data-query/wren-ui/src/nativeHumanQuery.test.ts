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
import { getQueryPreviewText } from './utils/language';

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
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
    humanAction: {
      resourceId: resource,
      resourceVersion: 1,
      resultExposurePolicyId: 'f50e30ee-a9c6-4406-8620-7e45262f3145',
      resultExposurePolicyVersion: 1,
    },
  } as NativeQueryDelivery;
  const calls = jest.mocked(bindingServiceCall);
  let freeze: jest.Mock, history: jest.Mock, service: NativeHumanQuery;
  beforeEach(() => {
    calls.mockReset();
    freeze = jest.fn().mockResolvedValue(reference);
    history = jest.fn();
    service = new NativeHumanQuery(
      config,
      { reference: freeze } as unknown as NativeQueryService,
      { findOneBy: history } as unknown as ApiHistoryRepository,
    );
  });
  it('submits only a saved reference through the original action and never treats dispatch as data', async () => {
    calls.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(freeze).toHaveBeenCalledWith(resource, 7, 10);
    const command = calls.mock.calls[1][2].command as any;
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
      inputReference: { ...reference, resourceId: binding },
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

  it('uses Chinese by default and a single English locale for necessary preview guidance', () => {
    expect(getQueryPreviewText().check).toBe('检查原查询');
    expect(getQueryPreviewText('en').check).toBe('Check query');
    expect(Object.values(getQueryPreviewText('en')).join(' ')).not.toMatch(
      /[\u4e00-\u9fff]/,
    );
    expect(getQueryPreviewText('zh-CN').pending).not.toContain(' / ');
  });
});

import { ApiHistoryRepository } from '../repositories/apiHistoryRepository';
import { NativeQueryService } from './nativeQueryService';
import { queryReceiptState } from '@/utils/queryReceipt';
import {
  bindingServiceCall,
  canonical,
  digest,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';

export function nativePreviewScope(
  config: NativeQueryDelivery,
  identityScope: string | undefined,
): string {
  if (!identityScope || !/^[a-f0-9]{64}$/.test(identityScope)) {
    throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
  }
  // Stable across credential rotation: do not abandon this person's UNKNOWN.
  // This is not authorization; the original Core admission still runs per call.
  return digest([
    identityScope,
    config.bindingId,
    config.nativeInstanceRef,
    config.nativeScopeRef,
  ]);
}

export async function resolveNativeResource(
  config: NativeQueryDelivery,
  token: string,
  kind: 'model' | 'view',
  id: number,
  actionKey: 'data_query.query@v1' | 'data_query.describe@v1',
  filterDenied = false,
) {
  if (!token || !Number.isSafeInteger(id) || id <= 0)
    throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
  let resolved;
  try {
    resolved = await bindingServiceCall(
      config,
      'human-action',
      {
        bindingId: config.bindingId,
        resolveResource: {
          workspaceId: config.workspaceId,
          actionKey,
          actionVersion: 1,
          nativeType: kind,
          nativeRef: String(id),
        },
      },
      token,
    );
  } catch (error) {
    // Only an authoritative denial hides an object from the original list.
    // Outages, malformed responses and stale facts must not become an empty list.
    if (
      filterDenied &&
      error instanceof NativeQueryRefusal &&
      error.status === 403 &&
      error.resourcePermissionDenied
    )
      return null;
    throw error;
  }
  const resource = resolved?.resource;
  if (
    !resource ||
    typeof resource.resourceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      resource.resourceId,
    ) ||
    !Number.isSafeInteger(resource.resourceVersion) ||
    resource.resourceVersion <= 0 ||
    resource.nativeType !== kind ||
    resource.nativeRef !== String(id) ||
    resource.nativeInstanceRef !== config.nativeInstanceRef ||
    resource.nativeScopeRef !== config.nativeScopeRef
  )
    throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
  return resource;
}

export async function canReadNativeMetadata(
  config: NativeQueryDelivery,
  token: string | undefined,
  kind: 'model' | 'view',
  id: number,
): Promise<boolean> {
  if (!token)
    throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
  return (
    (await resolveNativeResource(
      config,
      token,
      kind,
      id,
      'data_query.describe@v1',
      true,
    )) !== null
  );
}

// Request-scoped consumer: the token is neither cached nor written to native history.
export class NativeHumanQuery {
  constructor(
    private readonly config: NativeQueryDelivery,
    private readonly queries: NativeQueryService,
    private readonly history: ApiHistoryRepository,
  ) {}

  async preview(
    token: string | undefined,
    viewId: number,
    limit: number,
    key: string,
    kind: 'view' | 'model' = 'view',
    expectedStatement?: string,
  ) {
    const selection = this.config.humanAction;
    if (!token || !selection)
      throw new NativeQueryRefusal(503, 'NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    if (
      !Number.isSafeInteger(viewId) ||
      viewId <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      typeof key !== 'string' ||
      (expectedStatement !== undefined &&
        (kind !== 'view' ||
          typeof expectedStatement !== 'string' ||
          !expectedStatement.trim())) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    ) {
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    }
    const observe = () =>
      bindingServiceCall(
        this.config,
        'human-action',
        {
          bindingId: this.config.bindingId,
          idempotencyKey: key,
        },
        token,
      );
    // A retry first reads the original AE. It never freezes a changed view over
    // an existing key, or repeats the native SQL in this request handler.
    let receipt = await observe();
    let selectedResource: string | undefined;
    if (!receipt) {
      const resource = await resolveNativeResource(
        this.config,
        token,
        kind,
        viewId,
        'data_query.query@v1',
      );
      selectedResource = resource.resourceId;
      const reference =
        kind === 'model'
          ? await this.queries.modelReference(
              resource.resourceId,
              viewId,
              limit,
            )
          : await this.queries.reference(
              resource.resourceId,
              viewId,
              limit,
              expectedStatement,
            );
      receipt = await bindingServiceCall(
        this.config,
        'human-action',
        {
          bindingId: this.config.bindingId,
          command: {
            actionKey: 'data_query.query@v1',
            idempotencyKey: key,
            workspaceId: this.config.workspaceId,
            resourceId: resource.resourceId,
            resourceVersion: resource.resourceVersion,
            componentAction: {
              actionVersion: 1,
              inputReference: reference,
              resultExposurePolicyId: selection.resultExposurePolicyId,
              resultExposurePolicyVersion:
                selection.resultExposurePolicyVersion,
            },
          },
        },
        token,
      );
    }
    const check = (value: any) => {
      if (
        !value ||
        !queryReceiptState(value).valid ||
        value.submission?.actionKey !== 'data_query.query@v1' ||
        typeof value.submission.actionExecutionId !== 'string' ||
        typeof value.submission.operationId !== 'string' ||
        typeof value.inputReference?.resourceId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.inputReference.resourceId,
        ) ||
        (selectedResource !== undefined &&
          value.inputReference.resourceId !== selectedResource)
      ) {
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      }
      let frozen: any;
      try {
        frozen = JSON.parse(value.inputReference.nativeObjectRef);
      } catch {
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      }
      if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen))
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      if (
        frozen[kind === 'model' ? 'modelId' : 'viewId'] !== viewId ||
        (kind === 'model' ? 'viewId' : 'modelId') in frozen ||
        frozen.limit !== limit
      )
        throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
      // Observation of an existing key is not permission to substitute a
      // previously frozen statement for the Asking response's current intent.
      // Use the same native revision as execute, without storing SQL in Core.
      if (
        expectedStatement !== undefined &&
        value.inputReference.nativeRevision !==
          digest({
            bindingId: this.config.bindingId,
            projectId: this.config.projectId,
            connection: this.config.projectConnectionDigest,
            selection: frozen,
            sql: expectedStatement,
          })
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    check(receipt);
    if (receipt.terminalStatus !== 'COMPLETED') return receipt;
    if (
      receipt.nativeType !== 'wren.api_history' ||
      typeof receipt.nativeId !== 'string'
    ) {
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    }
    const record = await this.history.findOneBy({
      id: receipt.nativeId,
      projectId: this.config.projectId,
      governanceBindingId: this.config.bindingId,
      governanceActionExecutionId: receipt.submission.actionExecutionId,
      governanceOperationId: receipt.submission.operationId,
      governanceState: 'SUCCEEDED',
    });
    if (
      !record?.responsePayload ||
      !Array.isArray(record.responsePayload.columns) ||
      !Array.isArray(record.responsePayload.data)
    ) {
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    }
    // Reading native rows does not confer permission. Re-admit immediately
    // before disclosure, including revocation/config generation changes.
    const after = await observe();
    check(after);
    if (canonical(after) !== canonical(receipt))
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    return { ...receipt, data: record.responsePayload };
  }
}

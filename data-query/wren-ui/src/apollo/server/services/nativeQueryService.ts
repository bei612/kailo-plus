import { randomUUID } from 'crypto';
import {
  ApiHistory,
  ApiHistoryRepository,
  ApiType,
} from '../repositories/apiHistoryRepository';
import {
  Deploy,
  deploymentObjects,
  IDeployLogRepository,
  NativeDeploymentObject,
} from '../repositories/deployLogRepository';
import { IProjectRepository } from '../repositories/projectRepository';
import { IViewRepository } from '../repositories/viewRepository';
import { IModelRepository } from '../repositories/modelRepository';
import { IModelColumnRepository } from '../repositories/modelColumnRepository';
import { getPreviewColumnsStr } from '../utils/model';
import { Manifest, TableReference } from '../mdl/type';
import {
  IQueryService,
  PreviewDataResponse,
  PreviewOptions,
} from './queryService';
import { verifyPostgresReader } from './nativeBindingService';
import { toIbisConnectionInfo } from '../dataSource';
import { DataSourceName } from '../types';
import {
  authorizeQuery,
  digest,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';

export type GovernedQueryInput = {
  sql: string;
  deploymentId: number;
  deploymentHash: string;
  limit: number;
  cache?: Pick<PreviewOptions, 'cacheEnabled' | 'refresh'>;
};

// One native schema for the real MCP list and the approved capability input.
// Agents may supply SQL directly to this native service; HUMAN workflows use
// only the reference alternative, so Core/Temporal never persist SQL bodies.
export const queryInputSchema = {
  type: 'object' as const,
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['sql', 'deploymentId', 'deploymentHash', 'limit'],
      properties: {
        sql: { type: 'string', minLength: 1 },
        deploymentId: { type: 'integer', minimum: 1 },
        deploymentHash: { type: 'string', pattern: '^[a-f0-9]{40}$' },
        limit: { type: 'integer', minimum: 1 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'resourceId',
        'nativeObjectRef',
        'nativeRevision',
        'displayName',
        'mediaType',
      ],
      properties: {
        resourceId: { type: 'string', format: 'uuid' },
        nativeObjectRef: { type: 'string', minLength: 1 },
        nativeRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        displayName: { type: 'string' },
        mediaType: { const: 'application/json' },
      },
    },
  ],
};

const invalid = () => new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
const scopeDenied = () => new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
const unavailable = () =>
  new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nativeType = 'wren.api_history';

// Native cache options belong to the original frozen SQL intent, never to
// untrusted tool input or a separate cache/permission authority.
function nativeQueryCacheShape(
  cache: unknown,
): cache is GovernedQueryInput['cache'] {
  return (
    !!cache &&
    typeof cache === 'object' &&
    !Array.isArray(cache) &&
    Object.keys(cache).sort().join(',') === 'cacheEnabled,refresh' &&
    typeof (cache as Record<string, unknown>).cacheEnabled === 'boolean' &&
    typeof (cache as Record<string, unknown>).refresh === 'boolean'
  );
}
export function nativeQuerySelectionShape(selection: Record<string, any>) {
  const history = Object.hasOwn(selection, 'historyId');
  const cache = Object.hasOwn(selection, 'cache');
  const fields = [
    'deploymentHash',
    'deploymentId',
    'limit',
    Object.hasOwn(selection, 'modelId') ? 'modelId' : 'viewId',
    ...(history ? ['historyId'] : []),
    ...(cache ? ['cache'] : []),
  ];
  return (
    Object.keys(selection).sort().join(',') === fields.sort().join(',') &&
    (!cache || (history && nativeQueryCacheShape(selection.cache)))
  );
}

// These are native planner facts from the frozen deployment/history. Core
// resolves and authorizes them within the same original execution binding.
export function nativeSourceResources(objects: NativeDeploymentObject[]) {
  return objects.map((object) => ({
    nativeType: object.nativeType,
    nativeRef: String(object.nativeId),
  }));
}

function queryInput(raw: unknown): GovernedQueryInput {
  const value = raw as GovernedQueryInput;
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'deploymentHash,deploymentId,limit,sql' ||
    typeof value.sql !== 'string' ||
    !value.sql.trim() ||
    !Number.isSafeInteger(value.deploymentId) ||
    value.deploymentId <= 0 ||
    !Number.isSafeInteger(value.limit) ||
    value.limit <= 0 ||
    typeof value.deploymentHash !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.deploymentHash)
  ) {
    throw invalid();
  }
  return value;
}

// The original native query history supplies native identity and terminal
// evidence. There is no invented database job, cancellation or replay engine.
export class NativeQueryService {
  constructor(
    private readonly config: NativeQueryDelivery,
    private readonly projects: IProjectRepository,
    private readonly deployments: IDeployLogRepository,
    private readonly history: ApiHistoryRepository,
    private readonly queries: IQueryService,
    private readonly views?: IViewRepository,
    private readonly models?: IModelRepository,
    private readonly modelColumns?: IModelColumnRepository,
  ) {}

  private async verifyCurrentNativeReader() {
    const project = await this.projects.findOneBy({
      id: this.config.projectId,
    });
    if (
      !project ||
      digest({
        type: project.type,
        connectionInfo: project.connectionInfo,
        catalog: project.catalog,
        schema: project.schema,
      }) !== this.config.projectConnectionDigest
    )
      throw new NativeQueryRefusal(412, 'QUERY_NATIVE_SCOPE_CHANGED');
    if (project.type === DataSourceName.POSTGRES) {
      const connection = toIbisConnectionInfo(
        project.type,
        project.connectionInfo,
      );
      await verifyPostgresReader(
        connection.connectionUrl,
        this.config.requestTimeoutMs,
      );
    }
  }

  private async modelQuery(modelId: number) {
    if (!this.models || !this.modelColumns) throw unavailable();
    const model = await this.models.findOneBy({
      id: modelId,
      projectId: this.config.projectId,
    });
    if (!model) throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const columns = await this.modelColumns.findColumnsByModelIds([model.id]);
    return {
      name: model.referenceName,
      sql: `select ${getPreviewColumnsStr(columns)} from "${model.referenceName}"`,
    };
  }

  async modelReference(resourceId: string, modelId: number, limit: number) {
    if (
      !uuid.test(resourceId) ||
      !Number.isSafeInteger(modelId) ||
      modelId <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0
    )
      throw invalid();
    const model = await this.modelQuery(modelId);
    const deployment = await this.deployments.findLastProjectDeployLog(
      this.config.projectId,
    );
    if (
      !deployment ||
      deployment.status !== 'SUCCESS' ||
      deployment.projectId !== this.config.projectId ||
      !/^[a-f0-9]{40}$/.test(deployment.hash)
    )
      throw unavailable();
    const selection = {
      modelId,
      deploymentId: deployment.id,
      deploymentHash: deployment.hash,
      limit,
    };
    return {
      resourceId,
      nativeObjectRef: JSON.stringify(selection),
      nativeRevision: digest({
        bindingId: this.config.bindingId,
        projectId: this.config.projectId,
        connection: this.config.projectConnectionDigest,
        selection,
        sql: model.sql,
      }),
      displayName: model.name,
      mediaType: 'application/json',
    };
  }

  // Original dashboard metadata includes SQL/chart definitions, not query
  // results. Resolve its real planner/deployment sources without allocating
  // another native task or issuing SQL before the HUMAN read checks.
  async metadataSources(sql: string) {
    if (typeof sql !== 'string' || !sql.trim()) throw invalid();
    const deployment = await this.deployments.findLastProjectDeployLog(
      this.config.projectId,
    );
    if (
      !deployment ||
      deployment.status !== 'SUCCESS' ||
      deployment.projectId !== this.config.projectId ||
      !/^[a-f0-9]{40}$/.test(deployment.hash)
    )
      throw new NativeQueryRefusal(412, 'QUERY_DEPLOYMENT_CHANGED');
    const { objects } = await this.querySourceObjects(deployment, { sql });
    return {
      objects,
      revision: digest({
        deployment,
        sql,
        objects,
      }),
    };
  }

  async sqlSelection(
    key: string,
    sql: string,
    limit: number,
    previewScope: string,
    action: 'data_query.query@v1' | 'data_query.dry_run@v1',
    threadId?: string,
    expectedDeploymentHash?: string,
    cache?: GovernedQueryInput['cache'],
  ) {
    if (
      !uuid.test(key) ||
      typeof sql !== 'string' ||
      !sql.trim() ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      (threadId !== undefined && (!threadId || typeof threadId !== 'string')) ||
      !/^[a-f0-9]{64}$/.test(previewScope) ||
      (expectedDeploymentHash !== undefined &&
        !/^[a-f0-9]{40}$/.test(expectedDeploymentHash)) ||
      (cache !== undefined && !nativeQueryCacheShape(cache))
    )
      throw invalid();
    const prior = await this.history.findOneBy({
      governanceBindingId: this.config.bindingId,
      governanceKey: key,
    });
    if (
      prior &&
      (prior.apiType !== ApiType.RUN_SQL ||
        prior.projectId !== this.config.projectId ||
        prior.requestPayload?.previewScope !== previewScope ||
        prior.requestPayload.sql !== sql ||
        (prior.threadId ?? undefined) !== threadId ||
        prior.requestPayload.limit !== limit ||
        prior.requestPayload.action !== action ||
        digest(prior.requestPayload.cache ?? null) !== digest(cache ?? null))
    )
      throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    const deployment = prior
      ? await this.deployments.findOneBy({
          id: prior.governanceDeploymentId,
          hash: prior.governanceDeploymentHash,
          projectId: this.config.projectId,
          status: 'SUCCESS',
        })
      : await this.deployments.findLastProjectDeployLog(this.config.projectId);
    if (
      !deployment ||
      deployment.status !== 'SUCCESS' ||
      deployment.projectId !== this.config.projectId ||
      (expectedDeploymentHash !== undefined &&
        deployment.hash !== expectedDeploymentHash)
    )
      throw new NativeQueryRefusal(412, 'QUERY_DEPLOYMENT_CHANGED');
    const input = queryInput({
      sql,
      limit,
      deploymentId: deployment.id,
      deploymentHash: deployment.hash,
    });
    const { objects } = await this.querySourceObjects(deployment, input);
    if (!objects.length) throw scopeDenied();
    if (prior && digest(prior.requestPayload.nativeSources) !== digest(objects))
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    return {
      id: prior?.id ?? randomUUID(),
      key,
      input,
      objects,
      previewScope,
      action,
      threadId,
      cache,
    };
  }

  async sqlReference(
    resourceId: string,
    draft: Awaited<ReturnType<NativeQueryService['sqlSelection']>>,
  ) {
    if (!uuid.test(resourceId)) throw invalid();
    const selected = draft.objects[0];
    const record = await this.history.prepareNativeSql({
      id: draft.id,
      projectId: this.config.projectId,
      apiType: ApiType.RUN_SQL,
      threadId: draft.threadId,
      headers: {},
      // Native input accepted, not an execution. The original history schema
      // requires HTTP metadata; only reserve/claim adds AE and UNKNOWN.
      statusCode: 202,
      durationMs: 0,
      requestPayload: {
        action: draft.action,
        ...draft.input,
        previewScope: draft.previewScope,
        nativeSources: draft.objects,
        ...(draft.cache ? { cache: draft.cache } : {}),
      },
      governanceBindingId: this.config.bindingId,
      governanceKey: draft.key,
      governanceDeploymentId: draft.input.deploymentId,
      governanceDeploymentHash: draft.input.deploymentHash,
    });
    if (!record || (record.threadId ?? undefined) !== draft.threadId)
      throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    const selection = {
      historyId: record.id,
      [selected.nativeType === 'model' ? 'modelId' : 'viewId']:
        selected.nativeId,
      deploymentId: draft.input.deploymentId,
      deploymentHash: draft.input.deploymentHash,
      limit: draft.input.limit,
      ...(draft.cache ? { cache: draft.cache } : {}),
    };
    return {
      resourceId,
      nativeObjectRef: JSON.stringify(selection),
      nativeRevision: digest({
        bindingId: this.config.bindingId,
        projectId: this.config.projectId,
        connection: this.config.projectConnectionDigest,
        selection,
        sql: draft.input.sql,
      }),
      displayName: selected.nativeName,
      mediaType: 'application/json',
    };
  }

  async sqlIntent(
    reference: Record<string, unknown>,
    key: string,
    sql: string,
    limit: number,
    previewScope: string,
    action: 'data_query.query@v1' | 'data_query.dry_run@v1',
    threadId?: string,
    expectedDeploymentHash?: string,
    cache?: GovernedQueryInput['cache'],
  ) {
    let selection: Record<string, any>;
    try {
      selection = JSON.parse(String(reference.nativeObjectRef));
    } catch {
      throw unavailable();
    }
    if (!selection || typeof selection !== 'object' || Array.isArray(selection))
      throw unavailable();
    const model = Object.hasOwn(selection, 'modelId');
    if (
      !nativeQuerySelectionShape(selection) ||
      digest(selection.cache ?? null) !== digest(cache ?? null) ||
      !uuid.test(selection.historyId) ||
      selection.limit !== limit ||
      (expectedDeploymentHash !== undefined &&
        selection.deploymentHash !== expectedDeploymentHash)
    )
      throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    const record = await this.history.findOneBy({
      id: selection.historyId,
      projectId: this.config.projectId,
      governanceBindingId: this.config.bindingId,
      governanceKey: key,
    });
    if (
      !record ||
      record.requestPayload?.previewScope !== previewScope ||
      record.requestPayload.sql !== sql ||
      (record.threadId ?? undefined) !== threadId ||
      record.requestPayload.limit !== limit ||
      record.requestPayload.action !== action ||
      digest(record.requestPayload.cache ?? null) !== digest(cache ?? null) ||
      !Array.isArray(record.requestPayload.nativeSources) ||
      record.requestPayload.nativeSources[0]?.nativeType !==
        (model ? 'model' : 'view') ||
      record.requestPayload.nativeSources[0]?.nativeId !==
        selection[model ? 'modelId' : 'viewId'] ||
      record.governanceDeploymentId !== selection.deploymentId ||
      record.governanceDeploymentHash !== selection.deploymentHash ||
      reference.nativeRevision !==
        digest({
          bindingId: this.config.bindingId,
          projectId: this.config.projectId,
          connection: this.config.projectConnectionDigest,
          selection,
          sql,
        })
    )
      throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    return selection;
  }

  // A browser may export an existing native view's immutable query selection.
  // This is a reference, not platform admission. Core independently verifies
  // the supplied resource's tenant/binding and current caller authorization.
  async reference(
    resourceId: string,
    viewId: number,
    limit: number,
    expectedStatement?: string,
  ) {
    if (
      !uuid.test(resourceId) ||
      !Number.isSafeInteger(viewId) ||
      viewId <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !this.views
    )
      throw invalid();
    const view = await this.views.findOneBy({
      id: viewId,
      projectId: this.config.projectId,
    });
    // An Asking consumer has already matched this exact native statement to
    // its response. Never freeze a different statement under the same view ID
    // between that read and Core command submission, even if it changes back.
    if (
      expectedStatement !== undefined &&
      view?.statement !== expectedStatement
    )
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const deployment = await this.deployments.findLastProjectDeployLog(
      this.config.projectId,
    );
    if (
      !view ||
      !view.statement?.trim() ||
      !deployment ||
      deployment.status !== 'SUCCESS' ||
      deployment.projectId !== this.config.projectId ||
      !/^[a-f0-9]{40}$/.test(deployment.hash)
    )
      throw unavailable();
    const selection = {
      viewId,
      deploymentId: deployment.id,
      deploymentHash: deployment.hash,
      limit,
    };
    return {
      resourceId,
      nativeObjectRef: JSON.stringify(selection),
      nativeRevision: digest({
        bindingId: this.config.bindingId,
        projectId: this.config.projectId,
        connection: this.config.projectConnectionDigest,
        selection,
        sql: view.statement,
      }),
      displayName: view.name,
      mediaType: 'application/json',
    };
  }

  private async referencedInput(
    raw: Record<string, unknown>,
    target: unknown,
    key?: string,
  ): Promise<GovernedQueryInput> {
    if (
      Object.keys(raw).sort().join(',') !==
        'displayName,mediaType,nativeObjectRef,nativeRevision,resourceId' ||
      typeof raw.resourceId !== 'string' ||
      !uuid.test(raw.resourceId) ||
      typeof raw.nativeObjectRef !== 'string' ||
      typeof raw.nativeRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.nativeRevision) ||
      typeof raw.displayName !== 'string' ||
      raw.mediaType !== 'application/json'
    )
      throw invalid();
    let selection: {
      viewId?: number;
      modelId?: number;
      historyId?: string;
      deploymentId: number;
      deploymentHash: string;
      limit: number;
      cache?: GovernedQueryInput['cache'];
    };
    try {
      selection = JSON.parse(raw.nativeObjectRef);
    } catch {
      throw invalid();
    }
    if (!selection || typeof selection !== 'object' || Array.isArray(selection))
      throw invalid();
    const model = 'modelId' in selection;
    const id = model ? selection.modelId : selection.viewId;
    const history = Object.hasOwn(selection, 'historyId');
    if (
      !nativeQuerySelectionShape(selection) ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      (history && !uuid.test(selection.historyId))
    )
      throw invalid();
    const authorized = target as Record<string, unknown> | undefined;
    if (
      !authorized ||
      authorized.resourceId !== raw.resourceId ||
      authorized.nativeType !== (model ? 'model' : 'view') ||
      authorized.nativeRef !== String(id) ||
      authorized.nativeInstanceRef !== this.config.nativeInstanceRef ||
      authorized.nativeScopeRef !== this.config.nativeScopeRef
    )
      throw scopeDenied();
    const record = history
      ? await this.history.findOneBy({
          id: selection.historyId,
          projectId: this.config.projectId,
          governanceBindingId: this.config.bindingId,
          governanceKey: key,
        })
      : undefined;
    if (
      history &&
      (!record ||
        record.apiType !== ApiType.RUN_SQL ||
        record.governanceDeploymentId !== selection.deploymentId ||
        record.governanceDeploymentHash !== selection.deploymentHash ||
        record.requestPayload?.limit !== selection.limit ||
        digest(record.requestPayload.cache ?? null) !==
          digest(selection.cache ?? null) ||
        !['data_query.query@v1', 'data_query.dry_run@v1'].includes(
          record.requestPayload?.action,
        ) ||
        !/^[a-f0-9]{64}$/.test(record.requestPayload?.previewScope) ||
        record.requestPayload.nativeSources?.[0]?.nativeType !==
          (model ? 'model' : 'view') ||
        record.requestPayload.nativeSources?.[0]?.nativeId !== id)
    )
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const sql = history
      ? record.requestPayload.sql
      : model
        ? (await this.modelQuery(id)).sql
        : (
            await this.views?.findOneBy({
              id,
              projectId: this.config.projectId,
            })
          )?.statement;
    if (
      !sql ||
      raw.nativeRevision !==
        digest({
          bindingId: this.config.bindingId,
          projectId: this.config.projectId,
          connection: this.config.projectConnectionDigest,
          selection,
          sql,
        })
    ) {
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    }
    return {
      ...queryInput({
        sql,
        deploymentId: selection.deploymentId,
        deploymentHash: selection.deploymentHash,
        limit: selection.limit,
      }),
      ...(selection.cache ? { cache: selection.cache } : {}),
    };
  }

  private observation(record: ApiHistory) {
    return {
      idempotencyKey: record.governanceKey,
      nativeType,
      nativeId: record.id,
      platformStatus: record.governanceState,
      nativeStatus: record.governanceState,
      lastObservedAt: new Date().toISOString(),
      cancelCapability: 'UNSUPPORTED',
      ...(record.governanceState === 'SUCCEEDED' ||
      record.governanceState === 'FAILED'
        ? { terminalAt: record.updatedAt }
        : {}),
    };
  }

  private async describedModel(
    deployment: Deploy,
    target: unknown,
    resourceId: string,
  ) {
    const authorized = target as Record<string, unknown> | undefined;
    if (
      !authorized ||
      authorized.resourceId !== resourceId ||
      authorized.nativeType !== 'model' ||
      typeof authorized.nativeRef !== 'string' ||
      authorized.nativeInstanceRef !== this.config.nativeInstanceRef ||
      authorized.nativeScopeRef !== this.config.nativeScopeRef
    )
      throw scopeDenied();
    const id = Number(authorized.nativeRef);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      String(id) !== authorized.nativeRef
    )
      throw scopeDenied();
    if (!this.models) throw unavailable();
    let captured;
    try {
      captured = deploymentObjects(
        deployment.manifest,
        deployment.nativeObjectRefs,
      );
    } catch {
      throw unavailable();
    }
    const reference = captured.find(
      (row) => row.nativeType === 'model' && row.nativeId === id,
    );
    const model = await this.models.findOneBy({
      id,
      projectId: this.config.projectId,
    });
    if (!reference || !model || model.referenceName !== reference.nativeName)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const metadata = deployment.manifest.models?.find(
      (row) => row.name === reference.nativeName,
    );
    if (
      !metadata ||
      !Array.isArray(metadata.columns) ||
      metadata.columns.some(
        (column) =>
          !column ||
          typeof column.name !== 'string' ||
          !column.name ||
          (column.type !== undefined && typeof column.type !== 'string'),
      )
    )
      throw unavailable();
    return {
      value: {
        deploymentId: deployment.id,
        deploymentHash: deployment.hash,
        models: [
          {
            name: metadata.name,
            columns: metadata.columns.map((column) => ({
              name: column.name,
              type: column.type,
            })),
          },
        ],
      },
      fingerprint: digest({
        resource: {
          resourceId,
          nativeType: authorized.nativeType,
          nativeRef: authorized.nativeRef,
          nativeInstanceRef: authorized.nativeInstanceRef,
          nativeScopeRef: authorized.nativeScopeRef,
        },
        deployment: {
          id: deployment.id,
          hash: deployment.hash,
          manifest: deployment.manifest,
          nativeObjectRefs: captured,
        },
        model: { id: model.id, referenceName: model.referenceName },
      }),
    };
  }

  private async nativeSources(deployment: Deploy, sources: TableReference[]) {
    let captured: NativeDeploymentObject[];
    try {
      captured = deploymentObjects(
        deployment.manifest,
        deployment.nativeObjectRefs,
      );
    } catch {
      throw unavailable();
    }
    if (!sources.length) throw scopeDenied();
    const objects: NativeDeploymentObject[] = [];
    for (const source of sources) {
      if (
        source.catalog !== deployment.manifest.catalog ||
        source.schema !== deployment.manifest.schema
      )
        throw scopeDenied();
      const matches = captured.filter((row) => row.nativeName === source.table);
      // Resolve from the historical builder capture, not a model with a
      // matching current name. A model/view collision is not a first match.
      if (matches.length !== 1) throw scopeDenied();
      const object = matches[0];
      if (
        objects.some(
          (prior) =>
            prior.nativeType === object.nativeType &&
            prior.nativeId === object.nativeId,
        )
      )
        throw unavailable();
      if (object.nativeType === 'model') {
        if (!this.models) throw unavailable();
        const model = await this.models.findOneBy({
          id: object.nativeId,
          projectId: this.config.projectId,
        });
        if (!model || model.referenceName !== object.nativeName)
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      } else {
        if (!this.views) throw unavailable();
        const view = await this.views.findOneBy({
          id: object.nativeId,
          projectId: this.config.projectId,
        });
        const definition = deployment.manifest.views?.find(
          (row) => row.name === object.nativeName,
        );
        if (
          !view ||
          view.name !== object.nativeName ||
          !definition?.statement?.trim() ||
          view.statement !== definition.statement
        )
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      }
      objects.push(object);
    }
    return objects.sort((left, right) =>
      left.nativeType === right.nativeType
        ? left.nativeId - right.nativeId
        : left.nativeType < right.nativeType
          ? -1
          : 1,
    );
  }

  private async querySourceObjects(
    deployment: Deploy,
    input: Pick<GovernedQueryInput, 'sql'>,
    reference?: Record<string, unknown>,
  ) {
    const sources = await this.queries.sourceObjects(input.sql, {
      manifest: deployment.manifest,
      timeoutMs: this.config.requestTimeoutMs,
      responseMaxBytes: this.config.responseMaxBytes,
    });
    // A saved view's body can name only its dependencies. Its original
    // selected object remains part of the same query intent, not a source
    // inferred from a current-name lookup or generated SQL explanation.
    if (reference) {
      let selection: Record<string, unknown>;
      let captured: NativeDeploymentObject[];
      try {
        selection = JSON.parse(String(reference.nativeObjectRef));
        captured = deploymentObjects(
          deployment.manifest,
          deployment.nativeObjectRefs,
        );
      } catch {
        throw unavailable();
      }
      if (
        !selection ||
        typeof selection !== 'object' ||
        Array.isArray(selection)
      )
        throw unavailable();
      const kind = Object.hasOwn(selection, 'modelId') ? 'model' : 'view';
      const id = selection[kind === 'model' ? 'modelId' : 'viewId'];
      const selected = captured.find(
        (row) => row.nativeType === kind && row.nativeId === id,
      );
      if (!selected)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      if (!sources.some((source) => source.table === selected.nativeName))
        sources.push({
          catalog: deployment.manifest.catalog,
          schema: deployment.manifest.schema,
          table: selected.nativeName,
        });
    }
    return {
      sources,
      objects: await this.nativeSources(deployment, sources),
    };
  }

  // The HUMAN result consumer reads the same native deployment and original
  // query record as execution. These are provenance facts, never permission.
  async completedQuerySources(
    record: ApiHistory,
    reference: Record<string, unknown>,
  ): Promise<NativeDeploymentObject[]> {
    const payload = record.requestPayload;
    if (
      record.projectId !== this.config.projectId ||
      record.governanceBindingId !== this.config.bindingId ||
      record.apiType !== ApiType.RUN_SQL ||
      record.governanceState !== 'SUCCEEDED' ||
      !['data_query.query@v1', 'data_query.dry_run@v1'].includes(
        payload?.action,
      ) ||
      !Array.isArray(payload.nativeSources)
    )
      throw unavailable();
    const input = queryInput({
      sql: payload.sql,
      deploymentId: payload.deploymentId,
      deploymentHash: payload.deploymentHash,
      limit: payload.limit,
    });
    if (
      record.governanceDeploymentId !== input.deploymentId ||
      record.governanceDeploymentHash !== input.deploymentHash
    )
      throw unavailable();
    const deployment = await this.deployments.findOneBy({
      id: input.deploymentId,
      projectId: this.config.projectId,
      hash: input.deploymentHash,
      status: 'SUCCESS',
    });
    if (!deployment)
      throw new NativeQueryRefusal(412, 'QUERY_DEPLOYMENT_CHANGED');
    const current = await this.querySourceObjects(deployment, input, reference);
    if (digest(current.objects) !== digest(payload.nativeSources))
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    // The same frozen connection can gain native write/function privileges
    // without changing its fingerprint. HUMAN completed results consume the
    // original binding's live database ACL check, not its past validation.
    await this.verifyCurrentNativeReader();
    return current.objects;
  }

  async execute(
    token: string,
    key: string,
    action:
      | 'data_query.query@v1'
      | 'data_query.dry_run@v1'
      | 'data_query.describe@v1',
    raw: unknown,
    submittedTarget?: unknown,
  ) {
    if (!uuid.test(key)) throw invalid();
    const describing = action === 'data_query.describe@v1';
    if (
      describing &&
      (!raw ||
        Array.isArray(raw) ||
        typeof raw !== 'object' ||
        Object.keys(raw).length !== 0)
    )
      throw invalid();
    const referenced =
      !!raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'nativeObjectRef' in raw;
    // Read target claims only to reconstruct Core's already-frozen envelope.
    // No native scope or identity is trusted until JOSE and original PEP pass.
    let targetClaims: Record<string, unknown>;
    try {
      targetClaims = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
    } catch {
      throw scopeDenied();
    }
    const envelope = {
      target: submittedTarget ?? { resourceId: targetClaims.target_id },
      input: raw,
    };
    const claims = await authorizeQuery(
      this.config,
      token,
      'execute',
      envelope,
    );
    if (
      claims.action_key !== action ||
      claims.action_definition_version !== 1 ||
      claims.target_type !== 'RESOURCE' ||
      typeof claims.target_id !== 'string' ||
      !uuid.test(claims.target_id) ||
      !envelope.target ||
      typeof envelope.target !== 'object' ||
      Array.isArray(envelope.target) ||
      Object.keys(envelope.target).join(',') !== 'resourceId' ||
      (envelope.target as Record<string, unknown>).resourceId !==
        claims.target_id ||
      (claims.agent_principal_id === undefined &&
        (claims.actor_principal_id !== claims.initiating_human_principal_id ||
          typeof claims.external_execution_id !== 'string' ||
          !uuid.test(claims.external_execution_id) ||
          claims.idempotency_key !== key))
    ) {
      throw scopeDenied();
    }
    if (
      referenced &&
      (raw as Record<string, unknown>).resourceId !== claims.target_id
    )
      throw scopeDenied();
    let described: Awaited<ReturnType<NativeQueryService['describedModel']>>;
    let sourceReferences: TableReference[] | undefined;
    let querySources: NativeDeploymentObject[] | undefined;
    let queryDeploymentFingerprint: string | undefined;
    const reauthorize = async () => {
      let current = await authorizeQuery(
        this.config,
        token,
        'execute',
        envelope,
        querySources && nativeSourceResources(querySources),
      );
      if (referenced)
        await this.referencedInput(
          raw as Record<string, unknown>,
          current.targetResource,
          key,
        );
      if (!describing && !querySources) {
        const { sources, objects } = await this.querySourceObjects(
          deployment,
          input,
          referenced ? (raw as Record<string, unknown>) : undefined,
        );
        // The primary target must really be part of this query. Every source
        // (including view dependencies and hidden subqueries) then passes the
        // same Core action/scope/result policy; one grant is not borrowed for
        // the others. No source list supplied by the caller is accepted.
        if (!objects.length) throw scopeDenied();
        sourceReferences = sources;
        querySources = objects;
        queryDeploymentFingerprint = digest({
          manifest: deployment.manifest,
          nativeObjectRefs: deployment.nativeObjectRefs,
        });
        // Analysis is another native round trip. Permission can be revoked
        // while it runs; re-admit before the original data-source operation.
        current = await authorizeQuery(
          this.config,
          token,
          'execute',
          envelope,
          nativeSourceResources(querySources),
        );
      }
      if (described) {
        const frozen = await this.deployments.findOneBy({
          id: described.value.deploymentId,
          projectId: this.config.projectId,
          hash: described.value.deploymentHash,
          status: 'SUCCESS',
        });
        if (
          !frozen ||
          (
            await this.describedModel(
              frozen,
              current.targetResource,
              String(claims.target_id),
            )
          ).fingerprint !== described.fingerprint
        )
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      }
      if (querySources) {
        const primary = current.targetResource as Record<string, unknown>;
        if (
          !querySources.some(
            (object) =>
              primary?.resourceId === claims.target_id &&
              object.nativeType === primary.nativeType &&
              String(object.nativeId) === primary.nativeRef &&
              primary.nativeInstanceRef === this.config.nativeInstanceRef &&
              primary.nativeScopeRef === this.config.nativeScopeRef,
          )
        )
          throw scopeDenied();
        const frozen = await this.deployments.findOneBy({
          id: input.deploymentId,
          projectId: this.config.projectId,
          hash: input.deploymentHash,
          status: 'SUCCESS',
        });
        if (
          !frozen ||
          digest({
            manifest: frozen.manifest,
            nativeObjectRefs: frozen.nativeObjectRefs,
          }) !== queryDeploymentFingerprint ||
          digest(await this.nativeSources(frozen, sourceReferences)) !==
            digest(querySources)
        )
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      }
      // Runs before the first native call, after completion and on completed
      // reentry. A role change after analysis/admission must not borrow the
      // original binding validation or cause another native query.
      await this.verifyCurrentNativeReader();
    };
    const rejectUnsentReference = async () => {
      if (referenced) {
        // Core already owns a dispatched EE. Preserve this authenticated
        // native request in the original history so observe can distinguish
        // a proven pre-query refusal from a missing/late writer. A competing
        // reservation is never overwritten or interpreted as not executed.
        const id = randomUUID();
        const hash = String(claims.normalized_parameter_hash);
        const reserved = await this.history.reserveGovernedQuery({
          id,
          projectId: this.config.projectId,
          apiType: ApiType.RUN_SQL,
          requestPayload: { action, inputReference: raw },
          headers: {},
          statusCode: 202,
          durationMs: 0,
          governanceBindingId: this.config.bindingId,
          governanceKey: key,
          governanceActionExecutionId: String(claims.action_execution_id),
          governanceOperationId: String(claims.operation_id),
          governanceParameterHash: hash,
          governanceState: 'UNKNOWN',
        });
        if (
          reserved &&
          !(await this.history.rejectUnsentGovernedQuery(id, hash))
        )
          throw unavailable();
      }
    };
    let input: GovernedQueryInput | undefined;
    try {
      input = describing
        ? undefined
        : referenced
          ? await this.referencedInput(
              raw as Record<string, unknown>,
              claims.targetResource,
              key,
            )
          : queryInput(raw);
    } catch (error) {
      if (
        error instanceof NativeQueryRefusal &&
        [400, 403, 412].includes(error.status)
      ) {
        await rejectUnsentReference();
      }
      throw error;
    }
    const project = await this.projects.findOneBy({
      id: this.config.projectId,
    });
    // Never silently follow a native UI connection/account change under an
    // already-frozen binding. This private fingerprint is not result evidence
    // or a claim that a database role has been made read-only.
    if (
      !project ||
      digest({
        type: project.type,
        connectionInfo: project.connectionInfo,
        catalog: project.catalog,
        schema: project.schema,
      }) !== this.config.projectConnectionDigest
    ) {
      await rejectUnsentReference();
      throw new NativeQueryRefusal(412, 'QUERY_NATIVE_SCOPE_CHANGED');
    }
    const existingDescription = describing
      ? await this.history.findOneBy({
          governanceBindingId: this.config.bindingId,
          governanceKey: key,
        })
      : undefined;
    const deployment = describing
      ? existingDescription
        ? await this.deployments.findOneBy({
            id: existingDescription.governanceDeploymentId,
            hash: existingDescription.governanceDeploymentHash,
            projectId: this.config.projectId,
            status: 'SUCCESS',
          })
        : await this.deployments.findLastProjectDeployLog(this.config.projectId)
      : await this.deployments.findOneBy({
          id: input.deploymentId,
          projectId: this.config.projectId,
          hash: input.deploymentHash,
          status: 'SUCCESS',
        });
    // Consume the original deployment identity/hash, not a new hash of a
    // PostgreSQL JSONB reserialization (which need not preserve key order).
    if (
      !project ||
      !deployment ||
      deployment.projectId !== project.id ||
      deployment.status !== 'SUCCESS' ||
      !/^[a-f0-9]{40}$/.test(deployment.hash)
    ) {
      await rejectUnsentReference();
      throw new NativeQueryRefusal(412, 'QUERY_DEPLOYMENT_CHANGED');
    }
    if (describing)
      described = await this.describedModel(
        deployment,
        claims.targetResource,
        String(claims.target_id),
      );
    const referenceSelection = referenced
      ? JSON.parse(String((raw as Record<string, unknown>).nativeObjectRef))
      : undefined;
    const id = referenceSelection?.historyId ?? randomUUID();
    const hash = String(claims.normalized_parameter_hash);
    const record: ApiHistory = {
      id,
      projectId: project.id,
      apiType: describing ? ApiType.GET_MODELS : ApiType.RUN_SQL,
      // Native SQL stays in the original native history, never Core/Temporal.
      requestPayload: { action, ...input },
      headers: {},
      statusCode: 202,
      durationMs: 0,
      governanceBindingId: this.config.bindingId,
      governanceKey: key,
      governanceActionExecutionId: String(claims.action_execution_id),
      governanceOperationId: String(claims.operation_id),
      governanceParameterHash: hash,
      governanceState: 'UNKNOWN',
      governanceDeploymentId: deployment.id,
      governanceDeploymentHash: deployment.hash,
    };
    const inserted = await this.history.reserveGovernedQuery(record);
    if (!inserted) {
      const prior = await this.history.findOneBy({
        governanceBindingId: this.config.bindingId,
        governanceKey: key,
      });
      if (
        !prior ||
        prior.governanceParameterHash !== hash ||
        prior.governanceActionExecutionId !== claims.action_execution_id ||
        prior.governanceOperationId !== claims.operation_id
      )
        throw scopeDenied();
      // Same intent may be observed, never executed again, even if the first
      // writer died between reservation and the database call.
      if (prior.governanceState === 'SUCCEEDED') {
        await reauthorize();
        if (
          !describing &&
          (!Array.isArray(prior.requestPayload?.nativeSources) ||
            digest(prior.requestPayload.nativeSources) !== digest(querySources))
        )
          throw unavailable();
        if (!prior.responsePayload || typeof prior.responsePayload !== 'object')
          throw unavailable();
        if (
          describing &&
          digest(prior.responsePayload) !== digest(described.value)
        )
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        return {
          execution: this.observation(prior),
          resultJson: JSON.stringify(prior.responsePayload),
          ...(!describing
            ? { sourceResources: nativeSourceResources(querySources) }
            : {}),
        };
      }
      return { execution: this.observation(prior) };
    }
    // Recheck immediately before the original engine call. Here alone we can
    // prove no native call occurred, unlike an exception from QueryService.
    try {
      await reauthorize();
      if (!describing) {
        if (
          !querySources ||
          !(await this.history.freezeGovernedQuerySources(
            id,
            hash,
            querySources,
          ))
        )
          throw unavailable();
        await reauthorize();
      }
    } catch {
      if (!(await this.history.rejectUnsentGovernedQuery(id, hash)))
        throw unavailable();
      const rejected = await this.history.findOneBy({
        id,
        governanceBindingId: this.config.bindingId,
      });
      if (!rejected || rejected.governanceState !== 'FAILED')
        throw unavailable();
      return { execution: this.observation(rejected) };
    }
    const started = Date.now();
    let value: Record<string, unknown>;
    try {
      if (describing) {
        value = described.value;
      } else {
        const result = await this.queries.preview(input.sql, {
          project,
          manifest: deployment.manifest as Manifest,
          limit: input.limit,
          dryRun: action === 'data_query.dry_run@v1',
          cacheEnabled: input.cache?.cacheEnabled ?? false,
          refresh: input.cache?.refresh,
          requestTimeoutMs: this.config.requestTimeoutMs,
          responseMaxBytes: this.config.responseMaxBytes,
        });
        if (action === 'data_query.dry_run@v1') {
          // QueryService returns true (Engine) or Ibis's successful metadata.
          if (result !== true && (!result || typeof result !== 'object'))
            throw unavailable();
          value = {
            valid: true,
            deploymentId: deployment.id,
            deploymentHash: deployment.hash,
          };
        } else {
          const preview = result as PreviewDataResponse;
          if (
            !preview ||
            !Array.isArray(preview.columns) ||
            !Array.isArray(preview.data) ||
            preview.columns.some(
              (column) =>
                typeof column.name !== 'string' ||
                typeof column.type !== 'string',
            ) ||
            preview.data.some(
              (row) =>
                !Array.isArray(row) || row.length !== preview.columns.length,
            )
          )
            throw unavailable();
          value = {
            columns: preview.columns,
            data: preview.data,
            ...(input.cache
              ? {
                  cacheHit: preview.cacheHit || false,
                  cacheCreatedAt: preview.cacheCreatedAt || null,
                  cacheOverrodeAt: preview.cacheOverrodeAt || null,
                  override: preview.override || false,
                }
              : {}),
            deploymentId: deployment.id,
            deploymentHash: deployment.hash,
          };
        }
      }
      // Serialization failure is not a successful native result either.
      JSON.stringify(value);
    } catch {
      // A transport exception cannot prove the database never executed SQL.
      // Preserve UNKNOWN and do not leak SQL, connection strings or driver logs.
      return { execution: this.observation(record) };
    }
    if (
      !(await this.history.completeGovernedQuery(
        id,
        hash,
        value,
        Date.now() - started,
      ))
    )
      throw unavailable();
    const completed = await this.history.findOneBy({
      id,
      governanceBindingId: this.config.bindingId,
    });
    if (!completed || completed.governanceState !== 'SUCCEEDED')
      throw unavailable();
    // Observation may converge after revocation, but result disclosure must
    // still pass the original fresh business authorization.
    await reauthorize();
    return {
      execution: this.observation(completed),
      resultJson: JSON.stringify(value),
      ...(!describing
        ? { sourceResources: nativeSourceResources(querySources) }
        : {}),
    };
  }

  async observe(token: string, raw: unknown) {
    const reference = raw as Record<string, unknown>;
    if (
      !reference ||
      Array.isArray(reference) ||
      Object.keys(reference).some(
        (key) =>
          ![
            'externalExecutionId',
            'idempotencyKey',
            'nativeType',
            'nativeId',
          ].includes(key),
      ) ||
      typeof reference.externalExecutionId !== 'string' ||
      !uuid.test(reference.externalExecutionId) ||
      typeof reference.idempotencyKey !== 'string' ||
      !uuid.test(reference.idempotencyKey) ||
      reference.nativeType !== nativeType ||
      (reference.nativeId !== undefined &&
        (typeof reference.nativeId !== 'string' ||
          !uuid.test(reference.nativeId)))
    )
      throw invalid();
    const claims = await authorizeQuery(
      this.config,
      token,
      'observe',
      reference,
    );
    const record = await this.history.findOneBy({
      governanceBindingId: this.config.bindingId,
      governanceKey: reference.idempotencyKey,
    });
    if (
      !record ||
      (record.governanceActionExecutionId == null &&
        record.governanceOperationId == null &&
        record.governanceState == null)
    ) {
      // Absence is not a writer fence and cannot become NOT_DELIVERED.
      // A frozen native SQL input without an admitted execution is also not
      // evidence that a delayed adapter writer cannot claim it later.
      return {
        execution: {
          idempotencyKey: reference.idempotencyKey,
          nativeType,
          platformStatus: 'UNKNOWN',
          cancelCapability: 'UNSUPPORTED',
        },
      };
    }
    const management =
      ['application_binding.create', 'application_binding.disable'].includes(
        String(claims.action_key),
      ) &&
      claims.target_type === 'APPLICATION_BINDING' &&
      claims.target_id === this.config.bindingId;
    if (
      record.projectId !== this.config.projectId ||
      (!management &&
        (record.governanceActionExecutionId !== claims.action_execution_id ||
          record.governanceOperationId !== claims.operation_id)) ||
      (reference.nativeId !== undefined && record.id !== reference.nativeId)
    )
      throw scopeDenied();
    return { execution: this.observation(record) };
  }
}

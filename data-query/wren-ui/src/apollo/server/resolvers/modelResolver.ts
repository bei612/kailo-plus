import {
  CreateModelData,
  UpdateModelData,
  UpdateModelMetadataInput,
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
  UpdateViewMetadataInput,
  PreviewSQLData,
} from '../models';
import {
  DataSourceName,
  IContext,
  RelationData,
  UpdateRelationData,
} from '../types';
import { getLogger, transformInvalidColumnName } from '@server/utils';
import { DeployResponse } from '../services/deployService';
import {
  DeployStatusEnum,
  deploymentObjects,
  NativeDeploymentObject,
} from '../repositories/deployLogRepository';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { isEmpty, isNil } from 'lodash';
import { replaceAllowableSyntax, validateDisplayName } from '../utils/regex';
import { Model, ModelColumn, View } from '../repositories';
import {
  findColumnsToUpdate,
  getPreviewColumnsStr,
  handleNestedColumns,
  replaceInvalidReferenceName,
  updateModelPrimaryKey,
} from '../utils/model';
import { CompactTable, PreviewDataResponse } from '@server/services';
import { TelemetryEvent } from '../telemetry/telemetry';
import {
  NativeHumanQuery,
  authorizeNativeScope,
  canReadNativeMetadata,
  nativePreviewScope,
  resolveNativeResource,
} from '../services/nativeHumanQuery';
import { NativeQueryService } from '../services/nativeQueryService';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
  NativeQueryDelivery,
  canonical,
  digest,
} from '../services/nativeQueryAdmission';
import { DEFAULT_PREVIEW_LIMIT } from '../services/queryService';
import { ApiHistory, ApiType } from '../repositories/apiHistoryRepository';
import { nativeWriteUnknown } from '../utils/error';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

export enum SyncStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}

export class ModelResolver {
  private async metadataConfig(
    ctx: Pick<IContext, 'nativeIdentityScope' | 'nativeHumanToken'>,
    projectId: number,
  ) {
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      ctx.nativeIdentityScope === undefined &&
      ctx.nativeHumanToken === undefined
    )
      return undefined;
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (config.projectId !== projectId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    return config;
  }

  private async readableMetadata<T extends { id: number }>(
    ctx: IContext,
    config: NativeQueryDelivery | undefined,
    kind: 'model' | 'view',
    rows: T[],
  ): Promise<T[]> {
    if (!config) {
      // A newly configured binding cannot adopt an in-flight standalone read.
      if (
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
        ctx.nativeIdentityScope !== undefined ||
        ctx.nativeHumanToken !== undefined
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      return rows;
    }
    const visible: T[] = [];
    for (const row of rows) {
      if (
        await canReadNativeMetadata(config, ctx.nativeHumanToken, kind, row.id)
      )
        visible.push(row);
    }
    return visible;
  }

  private async currentColumn(ctx: IContext, id: number, projectId: number) {
    const column = await ctx.modelColumnRepository.findOneBy({ id });
    if (
      !column ||
      !(await ctx.modelRepository.findOneBy({ id: column.modelId, projectId }))
    )
      throw new Error('Column not found');
    return column;
  }

  private async currentRelation(ctx: IContext, id: number, projectId: number) {
    const relation = await ctx.relationRepository.findOneBy({ id, projectId });
    if (!relation) throw new Error('Relation not found');
    return relation;
  }

  private async verifyMetadataWrite(
    ctx: IContext,
    projectId: number,
    alreadyDispatched = false,
  ) {
    try {
      if (ctx.nativeProjectCheck) {
        // Consume the captured current permission immediately before writing.
        await ctx.nativeProjectCheck(projectId);
      } else if (
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
        ctx.nativeIdentityScope !== undefined ||
        ctx.nativeHumanToken !== undefined
      ) {
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      }
    } catch (error) {
      // A later refusal cannot establish NOT_STARTED for a multi-write native
      // operation whose earlier write was already dispatched.
      if (alreadyDispatched) throw nativeWriteUnknown(error);
      throw error;
    }
  }

  private async currentLineage(
    ctx: IContext,
    lineage: number[],
    projectId: number,
  ) {
    if (!lineage.length) return;
    for (const relationId of lineage.slice(0, -1)) {
      await this.currentRelation(ctx, relationId, projectId);
    }
    await this.currentColumn(ctx, lineage[lineage.length - 1], projectId);
  }

  constructor() {
    // model & model column
    this.listModels = this.listModels.bind(this);
    this.getModel = this.getModel.bind(this);
    this.createModel = this.createModel.bind(this);
    this.updateModel = this.updateModel.bind(this);
    this.deleteModel = this.deleteModel.bind(this);
    this.updateModelMetadata = this.updateModelMetadata.bind(this);
    this.deploy = this.deploy.bind(this);
    this.getMDL = this.getMDL.bind(this);
    this.checkModelSync = this.checkModelSync.bind(this);

    // view
    this.listViews = this.listViews.bind(this);
    this.getView = this.getView.bind(this);
    this.validateView = this.validateView.bind(this);
    this.createView = this.createView.bind(this);
    this.deleteView = this.deleteView.bind(this);
    this.updateViewMetadata = this.updateViewMetadata.bind(this);

    // preview
    this.previewModelData = this.previewModelData.bind(this);
    this.previewViewData = this.previewViewData.bind(this);
    this.previewSql = this.previewSql.bind(this);
    this.getNativeSql = this.getNativeSql.bind(this);

    // calculated field
    this.createCalculatedField = this.createCalculatedField.bind(this);
    this.validateCalculatedField = this.validateCalculatedField.bind(this);
    this.updateCalculatedField = this.updateCalculatedField.bind(this);
    this.deleteCalculatedField = this.deleteCalculatedField.bind(this);

    // relation
    this.createRelation = this.createRelation.bind(this);
    this.updateRelation = this.updateRelation.bind(this);
    this.deleteRelation = this.deleteRelation.bind(this);
  }

  public async createRelation(
    _root: any,
    args: { data: RelationData },
    ctx: IContext,
  ) {
    const { data } = args;

    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const from = await this.currentColumn(ctx, data.fromColumnId, projectId);
    const to = await this.currentColumn(ctx, data.toColumnId, projectId);
    if (from.modelId !== data.fromModelId || to.modelId !== data.toModelId)
      throw new Error('Relation model mismatch');

    const eventName = TelemetryEvent.MODELING_CREATE_RELATION;
    try {
      const relation = await ctx.modelService.createRelation(data, (id) =>
        this.verifyMetadataWrite(ctx, id),
      );
      ctx.telemetry.sendEvent(eventName, { data });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async updateRelation(
    _root: any,
    args: { data: UpdateRelationData; where: { id: number } },
    ctx: IContext,
  ) {
    const { data, where } = args;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    await this.currentRelation(ctx, where.id, projectId);
    const eventName = TelemetryEvent.MODELING_UPDATE_RELATION;
    try {
      const relation = await ctx.modelService.updateRelation(
        data,
        where.id,
        (id) => this.verifyMetadataWrite(ctx, id),
      );
      ctx.telemetry.sendEvent(eventName, { data });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteRelation(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ) {
    const relationId = args.where.id;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    await this.currentRelation(ctx, relationId, projectId);
    await ctx.modelService.deleteRelation(relationId, (id) =>
      this.verifyMetadataWrite(ctx, id),
    );
    return true;
  }

  public async createCalculatedField(
    _root: any,
    _args: { data: CreateCalculatedFieldData },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.MODELING_CREATE_CF;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    if (
      !(await ctx.modelRepository.findOneBy({
        id: _args.data.modelId,
        projectId,
      }))
    )
      throw new Error('Model not found');
    await this.currentLineage(ctx, _args.data.lineage, projectId);
    try {
      const column = await ctx.modelService.createCalculatedField(_args.data);
      ctx.telemetry.sendEvent(eventName, { data: _args.data });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: _args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async validateCalculatedField(_root: any, args: any, ctx: IContext) {
    const { name, modelId, columnId } = args.data;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    if (!(await ctx.modelRepository.findOneBy({ id: modelId, projectId })))
      throw new Error('Model not found');
    if (
      columnId != null &&
      (await this.currentColumn(ctx, columnId, projectId)).modelId !== modelId
    )
      throw new Error('Column not found');
    return await ctx.modelService.validateCalculatedFieldNaming(
      name,
      modelId,
      columnId,
    );
  }

  public async updateCalculatedField(
    _root: any,
    _args: { data: UpdateCalculatedFieldData; where: { id: number } },
    ctx: IContext,
  ) {
    const { data, where } = _args;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    await this.currentColumn(ctx, where.id, projectId);
    await this.currentLineage(ctx, data.lineage, projectId);

    const eventName = TelemetryEvent.MODELING_UPDATE_CF;
    try {
      const column = await ctx.modelService.updateCalculatedField(
        data,
        where.id,
      );
      ctx.telemetry.sendEvent(eventName, { data });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteCalculatedField(_root: any, args: any, ctx: IContext) {
    const columnId = args.where.id;
    // check column exist and is calculated field
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const column = await this.currentColumn(ctx, columnId, projectId);
    if (!column || !column.isCalculated) {
      throw new Error('Calculated field not found');
    }
    await ctx.modelColumnRepository.deleteOne(columnId);
    return true;
  }

  public async checkModelSync(_root: any, _args: any, ctx: IContext) {
    const { id } = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    const currentHash = ctx.deployService.createMDLHash(manifest, id);
    const inProgressDeployment =
      await ctx.deployService.getInProgressDeployment(id);
    if (inProgressDeployment) {
      return { status: SyncStatusEnum.IN_PROGRESS };
    }
    const lastDeploy = await ctx.deployService.getLastDeployment(id);
    const lastDeployHash = lastDeploy?.hash;
    return currentHash == lastDeployHash
      ? { status: SyncStatusEnum.SYNCRONIZED }
      : { status: SyncStatusEnum.UNSYNCRONIZED };
  }

  public async deploy(
    _root: any,
    args: { force: boolean },
    ctx: IContext,
  ): Promise<DeployResponse> {
    const project = await ctx.projectService.getCurrentProject();
    if (!project.version && project.type !== DataSourceName.DUCKDB) {
      const version =
        await ctx.projectService.getProjectDataSourceVersion(project);
      await ctx.projectService.updateProject(project.id, {
        version,
      });
    }
    const { manifest, nativeObjectRefs } =
      await ctx.mdlService.makeCurrentModelMDL(project);
    const deployRes = await ctx.deployService.deploy(
      manifest,
      project.id,
      nativeObjectRefs,
      args.force,
    );

    // only generating for user's data source
    if (
      project.sampleDataset === null &&
      deployRes.status === DeployStatusEnum.SUCCESS
    ) {
      try {
        await ctx.projectService.generateProjectRecommendationQuestions(
          project,
          ctx.nativeProjectCheck,
        );
      } catch (error) {
        // Deployment already completed; a later refusal is not NOT_STARTED.
        throw nativeWriteUnknown(error);
      }
    }
    return deployRes;
  }

  public async getMDL(
    _root: any,
    args: { hash: string; queryScope?: string; generation?: number },
    ctx: Pick<
      IContext,
      | 'projectService'
      | 'deployRepository'
      | 'nativeIdentityScope'
      | 'nativeHumanToken'
    >,
  ) {
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const deploy = await ctx.deployRepository.findOneBy({
      hash: args.hash,
      projectId,
    });
    if (!deploy) throw new Error('Deployment not found');
    const config = await this.metadataConfig(ctx, projectId);
    if (!config) {
      if (
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
        ctx.nativeIdentityScope !== undefined ||
        ctx.nativeHumanToken !== undefined
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      if (args.queryScope !== undefined || args.generation !== undefined)
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      // The independent native MDL does not require platform provenance fields.
      return {
        hash: args.hash,
        mdl: Buffer.from(JSON.stringify(deploy.manifest)).toString('base64'),
      };
    }
    const verifyRequest = async () => {
      if (args.queryScope === undefined && args.generation === undefined)
        return;
      const permission = await authorizeNativeScope(
        config,
        ctx.nativeHumanToken,
        'discover',
      );
      if (
        args.queryScope !==
          nativePreviewScope(config, ctx.nativeIdentityScope) ||
        args.generation !== permission.generation ||
        (await ctx.projectService.getCurrentProject()).id !== projectId ||
        canonical(await loadQueryDelivery()) !== canonical(config)
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    await verifyRequest();
    let objects: NativeDeploymentObject[];
    try {
      objects = deploymentObjects(deploy.manifest, deploy.nativeObjectRefs);
    } catch {
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    }
    const evidence = canonical({
      id: deploy.id,
      projectId: deploy.projectId,
      hash: deploy.hash,
      manifest: deploy.manifest,
      nativeObjectRefs: deploy.nativeObjectRefs,
    });
    const authorize = async () => {
      const resolved = [];
      for (const ref of objects)
        resolved.push(
          await resolveNativeResource(
            config,
            ctx.nativeHumanToken,
            ref.nativeType,
            ref.nativeId,
            'data_query.describe@v1',
          ),
        );
      return resolved;
    };
    const before = await authorize();
    const current = await ctx.deployRepository.findOneBy({
      id: deploy.id,
      projectId,
      hash: args.hash,
    });
    if (
      !current ||
      canonical({
        id: current.id,
        projectId: current.projectId,
        hash: current.hash,
        manifest: current.manifest,
        nativeObjectRefs: current.nativeObjectRefs,
      }) !== evidence ||
      canonical(await authorize()) !== canonical(before)
    )
      throw new NativeQueryRefusal(409, 'QUERY_EVIDENCE_UNAVAILABLE');
    await verifyRequest();
    // Encode exactly the authorized, captured deployment, never a second
    // unscoped hash lookup that may select another project's native row.
    const mdl = Buffer.from(JSON.stringify(current.manifest)).toString(
      'base64',
    );
    return {
      hash: args.hash,
      mdl,
    };
  }

  public async readModelsHistory(
    selected: ApiHistory,
    ctx: Pick<
      IContext,
      | 'projectService'
      | 'deployRepository'
      | 'apiHistoryRepository'
      | 'nativeIdentityScope'
      | 'nativeHumanToken'
    >,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const config = await this.metadataConfig(ctx, project.id);
    if (!config)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const proof = selected.requestPayload?.nativeModels;
    if (
      selected.apiType !== ApiType.GET_MODELS ||
      selected.statusCode !== 200 ||
      selected.projectId !== project.id ||
      selected.governanceBindingId !== config.bindingId ||
      !selected.id ||
      proof?.identityScope !== ctx.nativeIdentityScope ||
      proof.queryScope !==
        nativePreviewScope(config, ctx.nativeIdentityScope) ||
      !Number.isSafeInteger(proof.generation) ||
      proof.generation <= 0 ||
      typeof proof.deploymentHash !== 'string' ||
      !proof.deploymentHash ||
      typeof proof.metadataDigest !== 'string'
    )
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const current = await ctx.apiHistoryRepository.findOneBy({
      id: selected.id,
      projectId: project.id,
      apiType: ApiType.GET_MODELS,
      governanceBindingId: config.bindingId,
    });
    if (
      current?.statusCode !== 200 ||
      canonical(current.requestPayload) !==
        canonical(selected.requestPayload) ||
      canonical(current.responsePayload) !== canonical(selected.responsePayload)
    )
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const reference = await this.getMDL(
      undefined,
      {
        hash: proof.deploymentHash,
        queryScope: proof.queryScope,
        generation: proof.generation,
      },
      ctx,
    );
    const manifest = JSON.parse(
      Buffer.from(reference.mdl, 'base64').toString(),
    );
    const responsePayload = {
      hash: reference.hash,
      models: manifest?.models || [],
      relationships: manifest?.relationships || [],
      views: manifest?.views || [],
    };
    if (
      digest(manifest) !== proof.metadataDigest ||
      canonical(current.responsePayload) !== canonical(responsePayload)
    )
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    // GET_MODELS remains the original native metadata read, not a query AE.
    // Its own history only discloses the same captured, currently readable MDL.
    return { requestPayload: null, responsePayload };
  }

  public async listModels(_root: any, _args: any, ctx: IContext) {
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const config = await this.metadataConfig(ctx, projectId);
    const models = await this.readableMetadata(
      ctx,
      config,
      'model',
      await ctx.modelRepository.findAllBy({ projectId }),
    );
    // The original repository treats empty filters as unfiltered reads.
    if (!models.length) return [];
    const modelIds = models.map((m) => m.id);
    const modelColumnList =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumnList =
      await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const result = [];
    for (const model of models) {
      const modelFields = modelColumnList
        .filter((c) => c.modelId === model.id)
        .map((c) => ({
          ...c,
          properties: JSON.parse(c.properties),
          nestedColumns: c.type.includes('STRUCT')
            ? modelNestedColumnList.filter((nc) => nc.columnId === c.id)
            : undefined,
        }));
      const fields = modelFields.filter((c) => !c.isCalculated);
      const calculatedFields = modelFields.filter((c) => c.isCalculated);
      result.push({
        ...model,
        fields,
        calculatedFields,
        properties: {
          ...JSON.parse(model.properties),
        },
      });
    }
    return this.readableMetadata(ctx, config, 'model', result);
  }

  public async getModel(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const model = await ctx.modelRepository.findOneBy({
      id: modelId,
      projectId,
    });
    if (!model) {
      throw new Error('Model not found');
    }

    const config = await this.metadataConfig(ctx, projectId);
    if (!(await this.readableMetadata(ctx, config, 'model', [model])).length)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');

    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const modelNestedColumns = await ctx.modelNestedColumnRepository.findAllBy({
      modelId: model.id,
    });

    const columns = modelColumns.map((c) => ({
      ...c,
      properties: JSON.parse(c.properties),
      nestedColumns: c.type.includes('STRUCT')
        ? modelNestedColumns.filter((nc) => nc.columnId === c.id)
        : undefined,
    }));
    const candidateRelations = (
      modelColumns.length
        ? await ctx.relationRepository.findRelationsBy({
            columnIds: modelColumns.map((c) => c.id),
          })
        : []
    ).map((r) => ({
      ...r,
      type: r.joinType,
      properties: r.properties ? JSON.parse(r.properties) : {},
    }));
    const relations = [];
    for (const relation of candidateRelations) {
      if (relation.projectId !== projectId) continue;
      let visible = true;
      for (const columnId of new Set([
        relation.fromColumnId,
        relation.toColumnId,
      ])) {
        const column =
          modelColumns.find((item) => item.id === columnId) ??
          (await ctx.modelColumnRepository.findOneBy({ id: columnId }));
        if (
          !column ||
          !(await ctx.modelRepository.findOneBy({
            id: column.modelId,
            projectId,
          })) ||
          !(
            await this.readableMetadata(ctx, config, 'model', [
              { id: column.modelId },
            ])
          ).length
        ) {
          visible = false;
          break;
        }
      }
      if (visible) relations.push(relation);
    }
    if (!(await this.readableMetadata(ctx, config, 'model', [model])).length)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');

    return {
      ...model,
      fields: columns.filter((c) => !c.isCalculated),
      calculatedFields: columns.filter((c) => c.isCalculated),
      relations,
      properties: {
        ...JSON.parse(model.properties),
      },
    };
  }

  public async createModel(
    _root: any,
    args: { data: CreateModelData },
    ctx: IContext,
  ) {
    const { sourceTableName, fields, primaryKey } = args.data;
    try {
      const model = await this.handleCreateModel(
        ctx,
        sourceTableName,
        fields,
        primaryKey,
      );
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_CREATE_MODEL, {
        data: args.data,
      });
      return model;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_CREATE_MODEL,
        { data: args.data, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  private async handleCreateModel(
    ctx: IContext,
    sourceTableName: string,
    fields: [string],
    primaryKey: string,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    // create model
    const dataSourceTable = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    );
    if (!dataSourceTable) {
      throw new Error('Table not found in the data source');
    }
    const properties = dataSourceTable?.properties;
    const modelValue = {
      projectId: project.id,
      displayName: sourceTableName, //use table name as displayName, referenceName and tableName
      referenceName: replaceInvalidReferenceName(sourceTableName),
      sourceTableName: sourceTableName,
      cached: false,
      refreshTime: null,
      properties: properties ? JSON.stringify(properties) : null,
    } as Partial<Model>;
    await this.verifyMetadataWrite(ctx, project.id);
    const model = await ctx.modelRepository.createOne(modelValue);

    // create columns
    const compactColumns = dataSourceTable.columns.filter((c) =>
      fields.includes(c.name),
    );
    const columnValues = compactColumns.map(
      (column) =>
        ({
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          referenceName: transformInvalidColumnName(column.name),
          sourceColumnName: column.name,
          type: column.type || 'string',
          notNull: column.notNull || false,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        }) as Partial<ModelColumn>,
    );
    await this.verifyMetadataWrite(ctx, project.id, true);
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      if (!column) return [];
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await this.verifyMetadataWrite(ctx, project.id, true);
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);
    logger.info(`Model created: ${JSON.stringify(model)}`);

    return model;
  }

  public async updateModel(
    _root: any,
    args: { data: UpdateModelData; where: { id: number } },
    ctx: IContext,
  ) {
    const { fields, primaryKey } = args.data;
    try {
      const model = await this.handleUpdateModel(ctx, args, fields, primaryKey);
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_UPDATE_MODEL, {
        data: args.data,
      });
      return model;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_UPDATE_MODEL,
        { data: args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModel(
    ctx: IContext,
    args: { data: UpdateModelData; where: { id: number } },
    fields: [string],
    primaryKey: string,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    const model = await ctx.modelRepository.findOneBy({
      id: args.where.id,
      projectId: project.id,
    });
    if (!model) throw new Error('Model not found');
    const existingColumns = await ctx.modelColumnRepository.findAllBy({
      modelId: model.id,
      isCalculated: false,
    });
    const { sourceTableName } = model;
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    const sourceTableColumns = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    )?.columns;
    const { toDeleteColumnIds, toCreateColumns, toUpdateColumns } =
      findColumnsToUpdate(fields, existingColumns, sourceTableColumns);
    await updateModelPrimaryKey(
      ctx.modelColumnRepository,
      model.id,
      primaryKey,
      (alreadyDispatched) =>
        this.verifyMetadataWrite(ctx, project.id, alreadyDispatched),
    );

    // delete columns
    if (toDeleteColumnIds.length) {
      await this.verifyMetadataWrite(ctx, project.id, true);
      await ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
    }

    // create columns
    if (toCreateColumns.length) {
      const compactColumns = sourceTableColumns.filter((sourceColumn) =>
        toCreateColumns.includes(sourceColumn.name),
      );
      const columnValues = compactColumns.map((column) => {
        const columnValue = {
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          sourceColumnName: column.name,
          referenceName: transformInvalidColumnName(column.name),
          type: column.type || 'string',
          notNull: column.notNull,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        } as Partial<ModelColumn>;
        return columnValue;
      });
      await this.verifyMetadataWrite(ctx, project.id, true);
      const columns = await ctx.modelColumnRepository.createMany(columnValues);

      // create nested columns
      const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
        const column = columns.find(
          (c) => c.sourceColumnName === compactColumn.name,
        );
        return handleNestedColumns(compactColumn, {
          modelId: column.modelId,
          columnId: column.id,
          sourceColumnName: column.sourceColumnName,
        });
      });
      await this.verifyMetadataWrite(ctx, project.id, true);
      await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);
    }

    // update columns
    if (toUpdateColumns.length) {
      for (const { id, sourceColumnName, type } of toUpdateColumns) {
        await this.verifyMetadataWrite(ctx, project.id, true);
        const column = await ctx.modelColumnRepository.updateOne(id, { type });

        // if the struct type is changed, need to re-create nested columns
        if (type.includes('STRUCT')) {
          const sourceColumn = sourceTableColumns.find(
            (sourceColumn) => sourceColumn.name === sourceColumnName,
          );
          await this.verifyMetadataWrite(ctx, project.id, true);
          await ctx.modelNestedColumnRepository.deleteAllBy({
            columnId: column.id,
          });
          await this.verifyMetadataWrite(ctx, project.id, true);
          await ctx.modelNestedColumnRepository.createMany(
            handleNestedColumns(sourceColumn, {
              modelId: column.modelId,
              columnId: column.id,
              sourceColumnName: sourceColumnName,
            }),
          );
        }
      }
    }

    logger.info(`Model updated: ${JSON.stringify(model)}`);
    return model;
  }

  // delete model
  public async deleteModel(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const model = await ctx.modelRepository.findOneBy({
      id: modelId,
      projectId,
    });
    if (!model) {
      throw new Error('Model not found');
    }

    // related columns and relationships will be deleted in cascade
    await this.verifyMetadataWrite(ctx, projectId);
    await ctx.modelRepository.deleteOne(modelId);
    return true;
  }

  // update model metadata
  public async updateModelMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateModelMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    const modelId = args.where.id;
    const data = args.data;

    // check if model exists
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const model = await ctx.modelRepository.findOneBy({
      id: modelId,
      projectId,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    const eventName = TelemetryEvent.MODELING_UPDATE_MODEL_METADATA;
    // Check every supplied child before any metadata write; the outer model
    // being in scope does not authorize arbitrary column/relation IDs.
    for (const requested of [
      ...(data.columns ?? []),
      ...(data.calculatedFields ?? []),
    ]) {
      if (
        (await this.currentColumn(ctx, requested.id, projectId)).modelId !==
        modelId
      )
        throw new Error('Column not found');
    }
    for (const requested of data.nestedColumns ?? []) {
      if (
        !(await ctx.modelNestedColumnRepository.findOneBy({
          id: requested.id,
          modelId,
        }))
      )
        throw new Error('Nested column not found');
    }
    for (const requested of data.relationships ?? [])
      await this.currentRelation(ctx, requested.id, projectId);
    let alreadyDispatched = false;
    const beforeWrite = async () => {
      await this.verifyMetadataWrite(ctx, projectId, alreadyDispatched);
      alreadyDispatched = true;
    };
    try {
      // update model metadata
      await this.handleUpdateModelMetadata(
        data,
        model,
        ctx,
        modelId,
        beforeWrite,
      );

      // update column metadata
      if (!isEmpty(data.columns)) {
        // find the columns that match the user requested columns
        await this.handleUpdateColumnMetadata(data, ctx, beforeWrite);
      }

      // update nested column metadata
      if (!isEmpty(data.nestedColumns)) {
        await this.handleUpdateNestedColumnMetadata(data, ctx, beforeWrite);
      }

      // update calculated field metadata
      if (!isEmpty(data.calculatedFields)) {
        await this.handleUpdateCFMetadata(data, ctx, beforeWrite);
      }

      // update relationship metadata
      if (!isEmpty(data.relationships)) {
        await this.handleUpdateRelationshipMetadata(data, ctx, beforeWrite);
      }

      ctx.telemetry.sendEvent(eventName, { data });
      return true;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModelMetadata(
    data: UpdateModelMetadataInput,
    model: Model,
    ctx: IContext,
    modelId: number,
    beforeWrite: () => Promise<void>,
  ) {
    const modelMetadata: any = {};

    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      modelMetadata.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      const properties = isNil(model.properties)
        ? {}
        : JSON.parse(model.properties);

      properties.description = this.determineMetadataValue(data.description);
      modelMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(modelMetadata)) {
      await beforeWrite();
      await ctx.modelRepository.updateOne(modelId, modelMetadata);
    }
  }

  private async handleUpdateRelationshipMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
    beforeWrite: () => Promise<void>,
  ) {
    const relationshipIds = data.relationships.map((r) => r.id);
    const relationships =
      await ctx.relationRepository.findRelationsByIds(relationshipIds);
    for (const rel of relationships) {
      const requestedMetadata = data.relationships.find((r) => r.id === rel.id);

      const relationMetadata: any = {};

      if (!isNil(requestedMetadata.description)) {
        const properties = rel.properties ? JSON.parse(rel.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        relationMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(relationMetadata)) {
        await beforeWrite();
        await ctx.relationRepository.updateOne(rel.id, relationMetadata);
      }
    }
  }

  private async handleUpdateCFMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
    beforeWrite: () => Promise<void>,
  ) {
    const calculatedFieldIds = data.calculatedFields.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(calculatedFieldIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.calculatedFields.find(
        (c) => c.id === col.id,
      );

      const columnMetadata: any = {};
      // check if description is empty
      // if description is empty, skip the update
      // if description is not empty, update the description in properties
      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await beforeWrite();
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
    beforeWrite: () => Promise<void>,
  ) {
    const columnIds = data.columns.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(columnIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.columns.find((c) => c.id === col.id);

      // update metadata
      const columnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        columnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await beforeWrite();
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateNestedColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
    beforeWrite: () => Promise<void>,
  ) {
    const nestedColumnIds = data.nestedColumns.map((nc) => nc.id);
    const modelNestedColumns =
      await ctx.modelNestedColumnRepository.findNestedColumnsByIds(
        nestedColumnIds,
      );
    for (const col of modelNestedColumns) {
      const requestedMetadata = data.nestedColumns.find((c) => c.id === col.id);

      const nestedColumnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        nestedColumnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        nestedColumnMetadata.properties = {
          ...col.properties,
          description: this.determineMetadataValue(
            requestedMetadata.description,
          ),
        };
      }

      if (!isEmpty(nestedColumnMetadata)) {
        await beforeWrite();
        await ctx.modelNestedColumnRepository.updateOne(
          col.id,
          nestedColumnMetadata,
        );
      }
    }
  }

  // list views
  public async listViews(_root: any, _args: any, ctx: IContext) {
    const { id } = await ctx.projectService.getCurrentProject();
    const config = await this.metadataConfig(ctx, id);
    const views = await this.readableMetadata(
      ctx,
      config,
      'view',
      await ctx.viewRepository.findAllBy({ projectId: id }),
    );
    const result = views.map((view) => ({
      ...view,
      displayName: view.properties
        ? JSON.parse(view.properties)?.displayName
        : view.name,
    }));
    return this.readableMetadata(ctx, config, 'view', result);
  }

  public async getView(_root: any, args: any, ctx: IContext) {
    const viewId = args.where.id;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const view = await ctx.viewRepository.findOneBy({ id: viewId, projectId });
    if (!view) {
      throw new Error('View not found');
    }
    const config = await this.metadataConfig(ctx, projectId);
    if (!(await this.readableMetadata(ctx, config, 'view', [view])).length)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const displayName = view.properties
      ? JSON.parse(view.properties)?.displayName
      : view.name;
    return { ...view, displayName };
  }

  // validate a view name
  public async validateView(_root: any, args: any, ctx: IContext) {
    const { name } = args.data;
    return this.validateViewName(name, ctx);
  }

  // create view from sql of a response
  public async createView(_root: any, args: any, ctx: IContext) {
    const {
      name: displayName,
      responseId,
      rephrasedQuestion,
      queryHistoryId,
    } = args.data;

    // validate view name
    const validateResult = await this.validateViewName(displayName, ctx);
    if (!validateResult.valid) {
      throw new Error(validateResult.message);
    }

    // create view
    const project = await ctx.projectService.getCurrentProject();
    const config = await this.metadataConfig(ctx, project.id);
    const identity = ctx.nativeIdentityScope;
    const token = ctx.nativeHumanToken;

    // get sql statement of a response
    const response = await ctx.askingService.getResponse(responseId, project);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // construct cte sql and format it
    const statement = safeFormatSQL(response.sql);

    let columns: PreviewDataResponse['columns'];
    if (config) {
      const { components } = await import('@/common');
      const history = components.apiHistoryRepository;
      const query =
        typeof queryHistoryId === 'string'
          ? await history.findOneBy({
              id: queryHistoryId,
              projectId: project.id,
              apiType: ApiType.RUN_SQL,
              governanceBindingId: config.bindingId,
              governanceState: 'SUCCEEDED',
            })
          : undefined;
      if (
        !query ||
        query.requestPayload?.action !== 'data_query.query@v1' ||
        query.requestPayload.limit !== 1 ||
        query.requestPayload.previewScope !==
          nativePreviewScope(config, identity) ||
        typeof query.requestPayload.sql !== 'string' ||
        safeFormatSQL(query.requestPayload.sql) !== statement
      )
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      const native = new NativeQueryService(
        config,
        ctx.projectRepository,
        ctx.deployRepository,
        history,
        ctx.queryService,
        ctx.viewRepository,
        ctx.modelRepository,
        ctx.modelColumnRepository,
      );
      const visible = await new NativeHumanQuery(
        config,
        native,
        history,
      ).readHistory(token, query);
      columns = visible.responsePayload?.columns;
      const current = await ctx.askingService.getResponse(responseId, project);
      if (
        !current ||
        current.id !== response.id ||
        current.threadId !== response.threadId ||
        current.sql !== response.sql ||
        ctx.nativeIdentityScope !== identity ||
        ctx.nativeHumanToken !== token ||
        canonical(await loadQueryDelivery()) !== canonical(config) ||
        (await ctx.projectService.getCurrentProject()).id !== project.id
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    } else {
      const { manifest } = await ctx.deployService.getLastDeployment(
        project.id,
      );
      // The independent original path has no platform identity or history.
      await this.readableMetadata(ctx, config, 'view', []);
      ({ columns } = await ctx.queryService.describeStatement(statement, {
        project,
        limit: 1,
        modelingOnly: false,
        manifest,
      }));
      await this.readableMetadata(ctx, config, 'view', []);
    }

    if (!Array.isArray(columns) || isEmpty(columns)) {
      throw new Error('Failed to describe statement');
    }

    // properties
    const properties = {
      displayName,
      columns,

      // properties from the thread response
      responseId, // helpful for mapping back to the thread response
      question: rephrasedQuestion,
    };

    const eventName = TelemetryEvent.HOME_CREATE_VIEW;
    const eventProperties = {
      statement,
      displayName,
    };
    // create view
    try {
      const name = replaceAllowableSyntax(displayName);
      await this.verifyMetadataWrite(ctx, project.id);
      const view = await ctx.viewRepository.createOne({
        projectId: project.id,
        name,
        statement,
        properties: JSON.stringify(properties),
      });

      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);

      return { ...view, displayName };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          ...eventProperties,
          error: err,
        },
        err.extensions?.service,
        false,
      );

      throw err;
    }
  }

  // delete view
  public async deleteView(_root: any, args: any, ctx: IContext) {
    const viewId = args.where.id;
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const view = await ctx.viewRepository.findOneBy({ id: viewId, projectId });
    if (!view) {
      throw new Error('View not found');
    }
    await this.verifyMetadataWrite(ctx, projectId);
    await ctx.viewRepository.deleteOne(viewId);
    return true;
  }

  public async previewModelData(_root: any, args: any, ctx: IContext) {
    const modelId = args.where.id;
    const project = await ctx.projectService.getCurrentProject();
    const model = await ctx.modelRepository.findOneBy({
      id: modelId,
      projectId: project.id,
    });
    if (!model) {
      throw new Error('Model not found');
    }
    return this.previewNativeData(args, ctx, 'model');
  }

  public async previewViewData(_root: any, args: any, ctx: IContext) {
    return this.previewNativeData(args, ctx, 'view');
  }

  // Internal Asking consumer, not a browser-supplied GraphQL argument. Bind
  // its already-checked response/view statement before submitting a command.
  public async previewViewSnapshotData(
    args: any,
    ctx: IContext,
    expectedStatement: string,
  ) {
    return this.previewNativeData(args, ctx, 'view', expectedStatement);
  }

  private async previewNativeData(
    args: any,
    ctx: IContext,
    kind: 'view' | 'model',
    expectedStatement?: string,
  ) {
    const { id: viewId, limit, idempotencyKey, idempotencyScope } = args.where;
    const project = await ctx.projectService.getCurrentProject();
    const config = await this.metadataConfig(ctx, project.id);
    if (config === undefined) {
      if (idempotencyKey !== undefined || idempotencyScope !== undefined)
        throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
      const row = await (
        kind === 'model' ? ctx.modelRepository : ctx.viewRepository
      ).findOneBy({ id: viewId, projectId: project.id });
      if (!row)
        throw new Error(
          kind === 'model' ? 'Model not found' : 'View not found',
        );
      if (
        expectedStatement !== undefined &&
        (kind !== 'view' || (row as View).statement !== expectedStatement)
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const { manifest } = await ctx.mdlService.makeCurrentModelMDL(project);
      let sql: string;
      if (kind === 'model') {
        const columns = await ctx.modelColumnRepository.findColumnsByModelIds([
          row.id,
        ]);
        sql = `select ${getPreviewColumnsStr(columns)} from "${(row as Model).referenceName}"`;
      } else {
        sql = (row as View).statement;
      }
      // Keep the fixed original native preview only while this remains an
      // independent instance. A new binding cannot adopt its in-flight SQL.
      const beforeQuery = await ctx.projectService.getCurrentProject();
      if (beforeQuery.id !== project.id)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      await this.readableMetadata(ctx, undefined, kind, [row]);
      const data = await ctx.queryService.preview(sql, {
        project,
        manifest,
        modelingOnly: false,
        ...(kind === 'view' ? { limit } : {}),
      });
      const currentProject = await ctx.projectService.getCurrentProject();
      if (currentProject.id !== project.id)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      await this.readableMetadata(ctx, undefined, kind, [row]);
      return data;
    }
    const previewScope = nativePreviewScope(config, ctx.nativeIdentityScope);
    if (idempotencyScope !== previewScope) {
      throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
    }
    const { components } = await import('@/common');
    const native = new NativeQueryService(
      config,
      ctx.projectRepository,
      ctx.deployRepository,
      components.apiHistoryRepository,
      ctx.queryService,
      ctx.viewRepository,
      ctx.modelRepository,
      ctx.modelColumnRepository,
    );
    const receipt = await new NativeHumanQuery(
      config,
      native,
      components.apiHistoryRepository,
    ).preview(
      ctx.nativeHumanToken,
      viewId,
      limit ?? DEFAULT_PREVIEW_LIMIT,
      idempotencyKey,
      kind,
      expectedStatement,
    );
    return { ...receipt, previewScope };
  }

  // Notice: this is used by AI service.
  // any change to this resolver should be synced with AI service.
  public async previewSql(
    _root: any,
    args: { data: PreviewSQLData },
    ctx: IContext,
  ) {
    const {
      sql,
      projectId,
      limit,
      dryRun,
      idempotencyKey,
      idempotencyScope,
      nativeTaskId,
    } = args.data;
    const bound = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
    if (nativeTaskId !== undefined && !bound)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (
      nativeTaskId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        nativeTaskId,
      )
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const project =
      projectId && !bound
        ? await ctx.projectService.getProjectById(parseInt(projectId))
        : await ctx.projectService.getCurrentProject();
    if (bound && projectId && projectId !== String(project.id)) {
      throw new Error('Project not found');
    }
    if (bound) {
      const config = await loadQueryDelivery();
      const previewScope = nativePreviewScope(config, ctx.nativeIdentityScope);
      if (idempotencyScope !== previewScope || config.projectId !== project.id)
        throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
      const asking =
        nativeTaskId === undefined
          ? undefined
          : new (await import('./askingResolver')).AskingResolver();
      const task = asking
        ? await asking.authorizeNativeAskingTask(nativeTaskId, ctx)
        : undefined;
      if (asking && !task)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const settledTask =
        task && ['FINISHED', 'FAILED', 'STOPPED'].includes(task.detail.status);
      const beforeAdmission = task
        ? async () => {
            const current = await asking.authorizeNativeAskingTask(
              nativeTaskId,
              ctx,
            );
            if (
              canonical(current.detail.nativeScope) !==
              canonical(task.detail.nativeScope)
            )
              throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
            const registered =
              await ctx.askingTaskRepository.registerNativeQuery(
                nativeTaskId,
                project.id,
                current.detail.nativeScope,
                idempotencyKey,
              );
            if (
              !registered ||
              ['FINISHED', 'FAILED', 'STOPPED'].includes(
                registered.detail.status,
              )
            )
              throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
          }
        : undefined;
      const { components } = await import('@/common');
      const native = new NativeQueryService(
        config,
        ctx.projectRepository,
        ctx.deployRepository,
        components.apiHistoryRepository,
        ctx.queryService,
        ctx.viewRepository,
        ctx.modelRepository,
        ctx.modelColumnRepository,
      );
      const receipt = await new NativeHumanQuery(
        config,
        native,
        components.apiHistoryRepository,
      ).previewSql(
        ctx.nativeHumanToken,
        idempotencyKey,
        sql,
        limit ?? DEFAULT_PREVIEW_LIMIT,
        previewScope,
        !!dryRun,
        nativeTaskId,
        task?.detail.nativeScope.metadataReference.hash,
        undefined,
        !!settledTask,
        beforeAdmission,
      );
      if (asking) {
        const current = await asking.authorizeNativeAskingTask(
          nativeTaskId,
          ctx,
        );
        if (!current.detail.nativeQueries?.includes(idempotencyKey))
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      }
      return { ...receipt, previewScope };
    }
    const { manifest } = await ctx.deployService.getLastDeployment(project.id);
    return await ctx.queryService.preview(sql, {
      project,
      limit: limit,
      modelingOnly: false,
      manifest,
      dryRun,
    });
  }

  public async getNativeSql(
    _root: any,
    args: { responseId: number; queryScope?: string; generation?: number },
    ctx: IContext,
  ): Promise<string> {
    const { responseId } = args;

    // If using a sample dataset, native SQL is not supported
    const project = await ctx.projectService.getCurrentProject();
    if (project.sampleDataset) {
      throw new Error(`Doesn't support Native SQL`);
    }
    const config = await this.metadataConfig(ctx, project.id);
    const verifyRequest = async () => {
      if (!config) {
        await this.readableMetadata(ctx, config, 'model', []);
        if (args.queryScope !== undefined || args.generation !== undefined)
          throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
        return;
      }
      const permission = await authorizeNativeScope(
        config,
        ctx.nativeHumanToken,
        'discover',
      );
      if (
        args.queryScope !==
          nativePreviewScope(config, ctx.nativeIdentityScope) ||
        args.generation !== permission.generation ||
        (await ctx.projectService.getCurrentProject()).id !== project.id ||
        canonical(await loadQueryDelivery()) !== canonical(config)
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    await verifyRequest();
    // Keep the original current-model conversion, including undeployed edits.
    // These refs are captured by that same native builder, never inferred from
    // a later same-name Resource or treated as automatic Resource registration.
    const captured = await ctx.mdlService.makeCurrentModelMDL(project);
    const { manifest } = captured;
    const metadataEvidence = canonical({
      manifest,
      nativeObjectRefs: captured.nativeObjectRefs,
    });
    let objects: NativeDeploymentObject[] = [];
    if (config) {
      try {
        objects = deploymentObjects(manifest, captured.nativeObjectRefs);
      } catch {
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      }
    }
    const authorize = async () => {
      if (!config) return [];
      const resolved = [];
      for (const ref of objects)
        resolved.push(
          await resolveNativeResource(
            config,
            ctx.nativeHumanToken,
            ref.nativeType,
            ref.nativeId,
            'data_query.describe@v1',
          ),
        );
      return resolved;
    };
    const before = await authorize();
    await verifyRequest();

    // get sql statement of a response
    const response = await ctx.askingService.getResponse(responseId, project);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    const responseEvidence = canonical({
      id: response.id,
      threadId: response.threadId,
      sql: response.sql,
    });
    // construct cte sql and format it
    let nativeSql: string;
    let failed: { error: unknown } | undefined;
    try {
      if (project.type === DataSourceName.DUCKDB) {
        logger.info(`Getting native sql from wren engine`);
        nativeSql = await ctx.wrenEngineAdaptor.getNativeSQL(response.sql, {
          manifest,
          modelingOnly: false,
          ...(config && {
            requestTimeoutMs: config.requestTimeoutMs,
            responseMaxBytes: config.responseMaxBytes,
          }),
        });
      } else {
        logger.info(`Getting native sql from ibis server`);
        nativeSql = await ctx.ibisServerAdaptor.getNativeSql({
          dataSource: project.type,
          sql: response.sql,
          mdl: manifest,
          ...(config && {
            requestTimeoutMs: config.requestTimeoutMs,
            responseMaxBytes: config.responseMaxBytes,
          }),
        });
      }
    } catch (error) {
      failed = { error };
    }
    if (config) {
      const current = await ctx.mdlService.makeCurrentModelMDL(project);
      const currentResponse = await ctx.askingService.getResponse(
        responseId,
        project,
      );
      if (
        metadataEvidence !==
          canonical({
            manifest: current.manifest,
            nativeObjectRefs: current.nativeObjectRefs,
          }) ||
        !currentResponse ||
        responseEvidence !==
          canonical({
            id: currentResponse.id,
            threadId: currentResponse.threadId,
            sql: currentResponse.sql,
          })
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    }
    await verifyRequest();
    if (canonical(await authorize()) !== canonical(before))
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    if (config && (failed || typeof nativeSql !== 'string'))
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    if (failed) throw failed.error;
    const language = project.type === DataSourceName.MSSQL ? 'tsql' : undefined;
    return safeFormatSQL(nativeSql, { language });
  }

  public async updateViewMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateViewMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    const viewId = args.where.id;
    const data = args.data;

    // check if view exists
    const { id: projectId } = await ctx.projectService.getCurrentProject();
    const view = await ctx.viewRepository.findOneBy({ id: viewId, projectId });
    if (!view) {
      throw new Error('View not found');
    }

    // update view metadata
    const properties = JSON.parse(view.properties);
    let newName = view.name;
    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      await this.validateViewName(data.displayName, ctx, viewId);
      newName = replaceAllowableSyntax(data.displayName);
      properties.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      properties.description = this.determineMetadataValue(data.description);
    }

    // view column metadata
    if (!isEmpty(data.columns)) {
      const viewColumns = properties.columns;
      for (const col of viewColumns) {
        const requestedMetadata = data.columns.find(
          (c) => c.referenceName === col.name,
        );

        if (!isNil(requestedMetadata.description)) {
          col.properties = col.properties || {};
          col.properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
        }
      }

      properties.columns = viewColumns;
    }

    await this.verifyMetadataWrite(ctx, projectId);
    await ctx.viewRepository.updateOne(viewId, {
      name: newName,
      properties: JSON.stringify(properties),
    });

    return true;
  }

  private determineMetadataValue(value: string) {
    // if it's empty string, meaning users want to remove the value
    // so we return null
    if (value === '') {
      return null;
    }

    // otherwise, return the value
    return value;
  }

  // validate view name
  private async validateViewName(
    viewDisplayName: string,
    ctx: IContext,
    selfView?: number,
  ): Promise<{ valid: boolean; message?: string }> {
    // check if view name is valid
    // a-z, A-Z, 0-9, _, - are allowed and cannot start with number
    const { valid, message } = validateDisplayName(viewDisplayName);
    if (!valid) {
      return {
        valid: false,
        message,
      };
    }
    const referenceName = replaceAllowableSyntax(viewDisplayName);
    // check if view name is duplicated
    const { id } = await ctx.projectService.getCurrentProject();
    const views = await ctx.viewRepository.findAllBy({ projectId: id });
    if (views.find((v) => v.name === referenceName && v.id !== selfView)) {
      return {
        valid: false,
        message: `Generated view name "${referenceName}" is duplicated`,
      };
    }

    return {
      valid: true,
    };
  }

  private validateTableExist(
    tableName: string,
    dataSourceTables: CompactTable[],
  ) {
    if (!dataSourceTables.find((c) => c.name === tableName)) {
      throw new Error(`Table ${tableName} not found in the data Source`);
    }
  }

  private validateColumnsExist(
    tableName: string,
    fields: string[],
    dataSourceTables: CompactTable[],
  ) {
    const tableColumns = dataSourceTables.find(
      (c) => c.name === tableName,
    )?.columns;
    for (const field of fields) {
      if (!tableColumns.find((c) => c.name === field)) {
        throw new Error(
          `Column "${field}" not found in table "${tableName}" in the data Source`,
        );
      }
    }
  }
}

import {
  AnalysisRelationInfo,
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  RelationType,
  SampleDatasetData,
} from '../types';
import {
  trim,
  getLogger,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
  handleNestedColumns,
} from '@server/utils';
import {
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  Project,
} from '../repositories';
import {
  SampleDatasetName,
  SampleDatasetRelationship,
  buildInitSql,
  getRelations,
  sampleDatasets,
} from '@server/data';
import { snakeCase } from 'lodash';
import { CompactTable, ProjectData } from '../services';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import DataSourceSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';
import { encryptConnectionInfo } from '../dataSource';
import * as Errors from '../utils/error';
import {
  connectionCredentials,
  splitCredentials,
} from '../services/connectionCredentials';
import { kailoActor } from '../services/kailoUserService';
import { runInDataSource } from '../utils/dataSourceScope';
import { TelemetryEvent } from '../telemetry/telemetry';
import { DeployStatusEnum } from '../repositories/deployLogRepository';
import { nativeWriteUnknown } from '../utils/error';
import { canReadNativeMetadata } from '../services/nativeHumanQuery';
import { NativeQueryRefusal } from '../services/nativeQueryAdmission';
import { isGovernedQueryMode } from '../services/nativeQueryMode';
import { governedMetadataDelivery } from '../services/nativeGovernedMetadata';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

// DD-169(2): data sources per instance (each is one native project).
export const MAX_DATA_SOURCES = 50;
// DD-169(2)⑤ / DD-129(3): the original sample datasets are not offered.
const SAMPLE_DATASETS_OFFERED = false;

/** A data source name: 1–60 characters, no control characters. */
export function validDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  return (
    name.length >= 1 && name.length <= 60 && !/[\u0000-\u001f\u007f]/.test(name)
  );
}

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

export class ProjectResolver {
  constructor() {
    this.getSettings = this.getSettings.bind(this);
    this.updateCurrentProject = this.updateCurrentProject.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveDataSource = this.saveDataSource.bind(this);
    this.updateDataSource = this.updateDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerDataSourceDetection =
      this.triggerDataSourceDetection.bind(this);
    this.resolveSchemaChange = this.resolveSchemaChange.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
    this.getProjectRecommendationQuestions =
      this.getProjectRecommendationQuestions.bind(this);
  }

  public async getSettings(_root: any, _arg: any, ctx: IContext) {
    const project = await this.checkedProject(ctx);
    const generalConnectionInfo =
      ctx.projectService.getGeneralConnectionInfo(project);
    const dataSourceType = project.type;

    return {
      // DD-133 §1: no upstream version is shown in the white-labelled page.
      productVersion: '',
      dataSource: {
        type: dataSourceType,
        properties: {
          displayName: project.displayName,
          ...generalConnectionInfo,
        } as DataSourceProperties,
        sampleDataset: project.sampleDataset,
      },
      language: project.language,
    };
  }

  public async getProjectRecommendationQuestions(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await this.checkedProject(ctx);
    return ctx.projectService.getProjectRecommendationQuestions(
      project,
      ctx.nativeProjectCheck,
    );
  }

  public async updateCurrentProject(
    _root: any,
    arg: { data: { language: string } },
    ctx: IContext,
  ) {
    const { language } = arg.data;
    const project = await this.checkedProject(ctx);
    await ctx.projectRepository.updateOne(project.id, {
      language,
    });

    // only generating for user's data source
    if (project.sampleDataset === null) {
      try {
        await ctx.projectService.generateProjectRecommendationQuestions(
          { ...project, language },
          ctx.nativeProjectCheck,
        );
      } catch (error) {
        // The language write has already happened, even if AI dispatch refuses.
        throw nativeWriteUnknown(error);
      }
    }
    return true;
  }

  private async checkedProject(ctx: IContext) {
    const bound = () => isGovernedQueryMode();
    const configured = bound();
    const project = await ctx.projectService.getCurrentProject();
    if (!configured) {
      if (bound()) throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      return project;
    }
    if (typeof ctx.nativeProjectCheck !== 'function')
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    // Check the actual row returned by the second asynchronous native lookup,
    // not only the project observed at the outer GraphQL request boundary.
    await ctx.nativeProjectCheck(project.id);
    return project;
  }

  public async resetCurrentProject(_root: any, _arg: any, ctx: IContext) {
    let project;
    try {
      project = await ctx.projectService.getCurrentProject();
    } catch {
      // no project found
      return true;
    }
    await this.deleteDataSourceProject(project, ctx);
    return true;
  }

  /**
   * Deletes one data source: its project with models, views, threads,
   * dashboards and deployments, its AI documents and (DD-169(5)) the
   * credentials Kailo holds for it. Other data sources are untouched.
   */
  public async deleteDataSourceProject(project: Project, ctx: IContext) {
    const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
    try {
      const id = project.id;
      await ctx.askingService.assertProjectTasksSettled(id);
      const tx = await ctx.projectRepository.transaction();
      try {
        await ctx.schemaChangeRepository.deleteAllBy({ projectId: id }, { tx });
        await ctx.deployService.deleteAllByProjectId(id, tx);
        await ctx.askingService.deleteAllByProjectId(id, tx);
        await ctx.modelService.deleteAllViewsByProjectId(id, tx);
        await ctx.modelService.deleteAllModelsByProjectId(id, tx);
        await ctx.projectService.deleteProject(id, tx);
        await ctx.projectRepository.commit(tx);
      } catch (error) {
        await ctx.projectRepository.rollback(tx);
        throw error;
      }
      await ctx.wrenAIAdaptor.delete(id);
      // The row is gone; the credential reference is retired last. A failure
      // here leaves an unreferenced secret, never a connection without one.
      await connectionCredentials()
        .retire(project.connectionInfo as any, await kailoActor(ctx.kailoUser))
        .catch((error) =>
          logger.error(
            `Data source ${id} deleted; credential retirement failed: ${error?.code || error?.message}`,
          ),
        );

      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        projectId: id,
        dataSourceType: project.type,
      });
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    // DD-169(2)⑤ / DD-129(3): the original sample datasets are not offered —
    // their tables are fetched from third-party addresses and DuckDB state is
    // engine-global. (The original flow below is kept for the upstream diff.)
    if (!SAMPLE_DATASETS_OFFERED)
      throw Errors.create(Errors.GeneralErrorCodes.KAILO_FEATURE_UNAVAILABLE);
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
    const eventProperties = {
      datasetName: name,
    };
    try {
      // create duckdb datasource
      const initSql = buildInitSql(name as SampleDatasetName);
      const duckdbDatasourceProperties = {
        initSql,
        extensions: [],
        configurations: {},
      };
      await this.saveDataSource(
        _root,
        {
          data: {
            type: DataSourceName.DUCKDB,
            properties: duckdbDatasourceProperties,
          } as DataSource,
        },
        ctx,
      );
      const project = await ctx.projectService.getCurrentProject();

      // list all the tables in the data source
      const tables = await this.listDataSourceTables(_root, _arg, ctx);
      const tableNames = tables.map((table) => table.name);

      // save tables as model and modelColumns
      await this.overwriteModelsAndColumns(tableNames, ctx, project);

      await ctx.modelService.updatePrimaryKeys(dataset.tables);
      await ctx.modelService.batchUpdateModelProperties(dataset.tables);
      await ctx.modelService.batchUpdateColumnProperties(dataset.tables);

      // save relations
      const relations = getRelations(name as SampleDatasetName);
      const models = await ctx.modelRepository.findAll();
      const columns = await ctx.modelColumnRepository.findAll();
      const mappedRelations = this.buildRelationInput(
        relations,
        models,
        columns,
      );
      await ctx.modelService.saveRelations(mappedRelations);

      // mark current project as using sample dataset
      await ctx.projectRepository.updateOne(project.id, {
        sampleDataset: name,
      });
      await this.deploy(ctx);
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      return { name };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { ...eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getOnboardingStatus(_root: any, _arg: any, ctx: IContext) {
    let project: Project | null;
    try {
      project = await ctx.projectRepository.getCurrentProject();
    } catch (_err: any) {
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }
    const { id, sampleDataset } = project;
    if (sampleDataset) {
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      return {
        status: OnboardingStatusEnum.ONBOARDING_FINISHED,
      };
    }
  }

  public async saveDataSource(
    _root: any,
    args: {
      data: DataSource;
    },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    // DD-169(2)②: a new data source is one more project; the existing ones
    // stay (the original reset this instance's only project here).
    await this.assertDataSourceCreatable(type, properties, ctx);

    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.createProject({
      displayName: displayName.trim(),
      type,
      connectionInfo,
      actor: await kailoActor(ctx.kailoUser),
    } as ProjectData);
    logger.debug(`Project created.`);

    // init dashboard
    logger.debug('Dashboard init...');
    // DD-169(2)①: the new data source's dashboard, whatever this request's
    // current selection is.
    await runInDataSource(project.id, () =>
      ctx.dashboardService.initDashboard(),
    );
    logger.debug('Dashboard created.');

    const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
    const eventProperties = {
      dataSourceType: type,
    };

    // try to connect to the data source
    try {
      // handle duckdb connection
      if (type === DataSourceName.DUCKDB) {
        connectionInfo as DUCKDB_CONNECTION_INFO;
        await this.buildDuckDbEnvironment(ctx, {
          initSql: connectionInfo.initSql,
          extensions: connectionInfo.extensions,
          configurations: connectionInfo.configurations,
        });
      } else {
        // handle other data source
        await ctx.projectService.getProjectDataSourceTables(project);
        const version =
          await ctx.projectService.getProjectDataSourceVersion(project);
        await ctx.projectService.updateProject(project.id, {
          version,
        });
        logger.debug(`Data source tables fetched`);
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
    } catch (err) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      await ctx.projectRepository.deleteOne(project.id);
      await connectionCredentials()
        .retire(project.connectionInfo as any, await kailoActor(ctx.kailoUser))
        .catch(() => undefined);
      ctx.telemetry.sendEvent(
        eventName,
        { eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return {
      id: project.id,
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
    };
  }

  /** DD-169(2)⑤⑥: the instance-level rules for one more data source. */
  public async assertDataSourceCreatable(
    type: DataSourceName,
    properties: DataSourceProperties,
    ctx: IContext,
  ) {
    if (isGovernedQueryMode())
      throw Errors.create(Errors.GeneralErrorCodes.GOVERNED_SOURCE_FIXED);
    if (!validDisplayName(properties?.displayName) || !(type in DataSourceName))
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
    const projects = await ctx.projectRepository.findAll();
    if (projects.length >= MAX_DATA_SOURCES)
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_LIMIT_REACHED);
    if (
      type === DataSourceName.DUCKDB &&
      projects.some((project) => project.type === DataSourceName.DUCKDB)
    )
      throw Errors.create(Errors.GeneralErrorCodes.DUCKDB_SINGLE_SOURCE);
  }

  public async updateDataSource(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    return this.updateDataSourceConnection(project, args.data.properties, ctx);
  }

  /**
   * DD-169(6): edits one data source's name and connection. Credential fields
   * left empty keep the stored credentials; the merged connection is tested
   * before anything is stored; new credentials replace the old reference,
   * which is retired only after the row points at the new one.
   */
  public async updateDataSourceConnection(
    project: Project,
    properties: DataSourceProperties,
    ctx: IContext,
  ) {
    if (isGovernedQueryMode())
      throw Errors.create(Errors.GeneralErrorCodes.GOVERNED_SOURCE_FIXED);
    const { displayName, ...input } = properties || ({} as any);
    if (!validDisplayName(displayName))
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
    const dataSourceType = project.type;
    const credentials = connectionCredentials();
    const actor = await kailoActor(ctx.kailoUser);

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions, configurations } =
        input as DUCKDB_CONNECTION_INFO;
      await this.buildDuckDbEnvironment(ctx, {
        initSql,
        extensions,
        configurations,
      });
      const updatedProject = await ctx.projectRepository.updateOne(project.id, {
        displayName: displayName.trim(),
        connectionInfo: { ...project.connectionInfo, ...input },
      });
      return this.dataSourceOutput(updatedProject, ctx);
    }

    const current = await credentials.plaintext(
      dataSourceType,
      project.connectionInfo as any,
    );
    const { credentials: given } = splitCredentials(dataSourceType, input);
    const merged = { ...current, ...input, ...given };
    for (const [key, value] of Object.entries(input))
      if ((value === '' || value === null) && key in current && !(key in given))
        merged[key] = current[key];
    // test the merged connection before storing anything
    await ctx.projectService.getProjectDataSourceTables({
      ...project,
      connectionInfo: encryptConnectionInfo(dataSourceType, merged as any),
    } as Project);
    logger.debug(`Data source tables fetched`);

    let connectionInfo: Record<string, any>;
    let replaced = false;
    if (Object.keys(given).length || !credentials.custody) {
      ({ stored: connectionInfo } = await credentials.store(
        dataSourceType,
        merged,
        actor,
      ));
      replaced = true;
    } else {
      // only general fields changed: keep the stored credentials as they are
      const { general } = splitCredentials(dataSourceType, merged);
      const keep = Object.fromEntries(
        Object.entries(project.connectionInfo).filter(
          ([key]) => !(key in general),
        ),
      );
      connectionInfo = { ...keep, ...general };
    }
    let updatedProject: Project;
    try {
      updatedProject = await ctx.projectRepository.updateOne(project.id, {
        displayName: displayName.trim(),
        connectionInfo: connectionInfo as any,
      });
    } catch (error) {
      if (replaced && connectionInfo.kailoSecretId)
        await credentials.retire(connectionInfo, actor).catch(() => undefined);
      throw error;
    }
    if (
      replaced &&
      project.connectionInfo?.['kailoSecretId'] &&
      project.connectionInfo['kailoSecretId'] !== connectionInfo.kailoSecretId
    )
      await credentials
        .retire(project.connectionInfo as any, actor)
        .catch((error) =>
          logger.error(
            `Data source ${project.id} updated; old credential retirement failed: ${error?.code || error?.message}`,
          ),
        );
    return this.dataSourceOutput(updatedProject, ctx);
  }

  public dataSourceOutput(project: Project, ctx: IContext) {
    return {
      id: project.id,
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
    };
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    return await ctx.projectService.getProjectDataSourceTables();
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;

    // get current project
    const project = await ctx.projectService.getCurrentProject();
    try {
      // delete existing models and columns
      const { models, columns } = await this.overwriteModelsAndColumns(
        arg.data.tables,
        ctx,
        project,
      );
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        dataSourceType: project.type,
        tablesCount: models.length,
        columnsCount: columns.length,
      });

      // async deploy to wren-engine and ai service
      this.deploy(ctx);
      return { models: models, columns };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();

    // get models and columns
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const constraints =
      await ctx.projectService.getProjectSuggestedConstraint(project);

    // generate relation
    const relations = [];
    for (const constraint of constraints) {
      const {
        constraintTable,
        constraintColumn,
        constraintedTable,
        constraintedColumn,
      } = constraint;
      // validate tables and columns exists in our models and model columns
      const fromModel = models.find(
        (m) => m.sourceTableName === constraintTable,
      );
      const toModel = models.find(
        (m) => m.sourceTableName === constraintedTable,
      );
      if (!fromModel || !toModel) {
        continue;
      }
      const fromColumn = columns.find(
        (c) =>
          c.modelId === fromModel.id && c.sourceColumnName === constraintColumn,
      );
      const toColumn = columns.find(
        (c) =>
          c.modelId === toModel.id && c.sourceColumnName === constraintedColumn,
      );
      if (!fromColumn || !toColumn) {
        continue;
      }
      // create relation
      const relation: AnalysisRelationInfo = {
        // upper case the first letter of the sourceTableName
        name: constraint.constraintName,
        fromModelId: fromModel.id,
        fromModelReferenceName: fromModel.referenceName,
        fromColumnId: fromColumn.id,
        fromColumnReferenceName: fromColumn.referenceName,
        toModelId: toModel.id,
        toModelReferenceName: toModel.referenceName,
        toColumnId: toColumn.id,
        toColumnReferenceName: toColumn.referenceName,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    // group by model
    return models.map(({ id, displayName, referenceName }) => ({
      id,
      displayName,
      referenceName,
      relations: relations.filter(
        (relation) =>
          relation.fromModelId === id &&
          // exclude self-referential relationship
          relation.toModelId !== relation.fromModelId,
      ),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
    try {
      const savedRelations = await ctx.modelService.saveRelations(
        arg.data.relations,
      );
      // async deploy
      this.deploy(ctx);
      ctx.telemetry.sendEvent(eventName, {
        relationCount: savedRelations.length,
      });
      return savedRelations;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getSchemaChange(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const config = await governedMetadataDelivery(ctx, project.id);
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (!lastSchemaChange) {
      return {
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      };
    }

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    if (lastSchemaChange.projectId !== project.id)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const authorizeModels = async () => {
      // STANDALONE: the original schema change has no Resource check; a
      // binding configured meanwhile cannot adopt this in-flight read.
      if (!config) {
        if (isGovernedQueryMode())
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        return;
      }
      for (const model of models) {
        if (
          model.projectId !== project.id ||
          !(await canReadNativeMetadata(
            config,
            ctx.nativeHumanToken,
            'model',
            model.id,
          ))
        )
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      }
    };
    await authorizeModels();
    const modelIds = models.map((model) => model.id);
    // The original repositories treat empty filters as all rows.
    const modelColumns = modelIds.length
      ? await ctx.modelColumnRepository.findColumnsByModelIds(modelIds)
      : [];

    const modelRelationships = modelIds.length
      ? await ctx.relationRepository.findRelationInfoBy({
          modelIds,
        })
      : [];
    if (
      modelColumns.some((column) => !modelIds.includes(column.modelId)) ||
      modelRelationships.some(
        (relation) =>
          relation.projectId !== project.id ||
          !modelColumns.some(
            (column) =>
              column.id === relation.fromColumnId &&
              column.modelId === relation.fromModelId,
          ) ||
          !modelColumns.some(
            (column) =>
              column.id === relation.toColumnId &&
              column.modelId === relation.toModelId,
          ),
      )
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    await authorizeModels();

    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });

    const resolves = lastSchemaChange.resolve;
    const unresolvedChanges = Object.keys(resolves).reduce((result, key) => {
      const isResolved = resolves[key];
      const changes = lastSchemaChange.change[key];
      // return if resolved or no changes
      if (isResolved || !changes) return result;

      // Mapping with affected models and columns and affected calculated fields and relationships data into schema change
      const affecteds = schemaDetector.getAffectedResources(changes, {
        models,
        modelColumns,
        modelRelationships,
      });

      const affectedChanges = affecteds.length ? affecteds : null;
      return { ...result, [key]: affectedChanges };
    }, {});

    return {
      ...unresolvedChanges,
      lastSchemaChangeTime: lastSchemaChange.createdAt,
    };
  }

  public async triggerDataSourceDetection(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await this.checkedProject(ctx);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
    try {
      const hasSchemaChange = await schemaDetector.detectSchemaChange();
      ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
      return hasSchemaChange;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await this.checkedProject(ctx);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
    try {
      await schemaDetector.resolveSchemaChange(type);
      ctx.telemetry.sendEvent(eventName, { type });
    } catch (error) {
      ctx.telemetry.sendEvent(
        eventName,
        { type, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
    return true;
  }

  private async deploy(ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const { manifest, nativeObjectRefs } =
      await ctx.mdlService.makeCurrentModelMDL(project);
    const deployRes = await ctx.deployService.deploy(
      manifest,
      project.id,
      nativeObjectRefs,
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

  private buildRelationInput(
    relations: SampleDatasetRelationship[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    const relationInput = relations.map((relation) => {
      const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
        relation;
      const fromModelId = models.find(
        (model) => model.sourceTableName === fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === toModelName,
      )?.id;
      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.referenceName === fromColumnName &&
          column.modelId === fromModelId,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.referenceName === toColumnName && column.modelId === toModelId,
      )?.id;
      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
        );
      }
      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type,
        description: relation.description,
      } as RelationData;
    });
    return relationInput;
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    const compactTables: CompactTable[] =
      await ctx.projectService.getProjectDataSourceTables(project);

    const selectedTables = compactTables.filter((table) =>
      tables.includes(table.name),
    );

    // create models
    const modelValues = selectedTables.map((table) => {
      const properties = table?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: table.name, // use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(table.name),
        sourceTableName: table.name,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    // create columns
    const columnValues = selectedTables.flatMap((table) => {
      const compactColumns = table.columns;
      const primaryKey = table.primaryKey;
      const model = models.find((m) => m.sourceTableName === table.name);
      return compactColumns.map(
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
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const compactColumns = selectedTables.flatMap((table) => table.columns);
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
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);

    return { models, columns };
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async buildDuckDbEnvironment(
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ): Promise<void> {
    const { initSql, extensions, configurations } = options;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
    await ctx.wrenEngineAdaptor.prepareDuckDB({
      sessionProps: configurations,
      initSql: initSqlWithExtensions,
    } as DuckDBPrepareOptions);

    // check can list dataset table
    await ctx.wrenEngineAdaptor.listTables();

    // patch wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await ctx.wrenEngineAdaptor.patchConfig(config);
  }
}

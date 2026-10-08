import { v4 as uuidv4 } from 'uuid';
import {
  Model,
  ModelColumn,
  ModelNestedColumn,
  RelationInfo,
  View,
} from '@server/repositories';
import {
  Diagram,
  DiagramModel,
  DiagramModelField,
  DiagramModelRelationField,
  NodeType,
  IContext,
  RelationType,
  DiagramView,
} from '@server/types';
import { ColumnMDL, Manifest } from '@server/mdl/type';
import { getLogger } from '@server/utils';
import { MDLBuilder } from '../mdl/mdlBuilder';
import {
  canReadNativeMetadata,
  nativePreviewScope,
} from '../services/nativeHumanQuery';
import {
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';

const logger = getLogger('DiagramResolver');
logger.level = 'debug';

export class DiagramResolver {
  constructor() {
    this.getDiagram = this.getDiagram.bind(this);
  }

  private async authorizeDiagram(
    ctx: IContext,
    config: NativeQueryDelivery,
    models: Model[],
    views: View[],
  ) {
    for (const [kind, rows] of [
      ['model', models],
      ['view', views],
    ] as const) {
      for (const row of rows) {
        if (
          row.projectId !== config.projectId ||
          !(await canReadNativeMetadata(
            config,
            ctx.nativeHumanToken,
            kind,
            row.id,
          ))
        )
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      }
    }
  }

  public async getDiagram(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Diagram> {
    const project = await ctx.projectRepository.getCurrentProject();
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (project.id !== config.projectId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const views = await ctx.viewRepository.findAllBy({
      projectId: project.id,
    });
    await this.authorizeDiagram(ctx, config, models, views);

    const modelIds = models.map((model) => model.id);
    // Empty filters mean all rows in the original repositories.
    const modelColumns = modelIds.length
      ? await ctx.modelColumnRepository.findColumnsByModelIds(modelIds)
      : [];
    const modelNestedColumns = modelIds.length
      ? await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(
          modelIds,
        )
      : [];
    const modelRelations = modelColumns.length
      ? await ctx.relationRepository.findRelationInfoBy({
          projectId: project.id,
          columnIds: modelColumns.map((column) => column.id),
        })
      : [];
    if (
      modelColumns.some((column) => !modelIds.includes(column.modelId)) ||
      modelNestedColumns.some(
        (nested) =>
          !modelColumns.some(
            (column) =>
              column.id === nested.columnId &&
              column.modelId === nested.modelId,
          ),
      ) ||
      modelRelations.some(
        (relation) =>
          relation.projectId !== project.id ||
          !modelIds.includes(relation.fromModelId) ||
          !modelIds.includes(relation.toModelId) ||
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

    await this.authorizeDiagram(ctx, config, models, views);

    const builder = new MDLBuilder({
      project,
      models,
      columns: modelColumns,
      nestedColumns: modelNestedColumns,
      relations: modelRelations,
      views,
      relatedModels: models,
      relatedColumns: modelColumns,
      relatedRelations: modelRelations,
    });

    const manifest = builder.build();

    return this.buildDiagram(
      models,
      modelColumns,
      modelNestedColumns,
      modelRelations,
      views,
      manifest,
    );
  }

  private buildDiagram(
    models: Model[],
    modelColumns: ModelColumn[],
    modelNestedColumns: ModelNestedColumn[],
    relations: RelationInfo[],
    views: View[],
    manifest: Manifest,
  ): Diagram {
    const diagramModels = models.map((model) => {
      const transformedModel = this.transformModel(model);
      const allColumns = modelColumns.filter(
        (column) => column.modelId === model.id,
      );
      const modelMDL = manifest.models.find(
        (modelMDL) => modelMDL.name === model.referenceName,
      );
      allColumns.forEach((column) => {
        const columnRelations = relations
          .map((relation) =>
            [relation.fromColumnId, relation.toColumnId].includes(column.id)
              ? relation
              : null,
          )
          .filter((relation) => !!relation);

        if (columnRelations.length > 0) {
          columnRelations.forEach((relation) => {
            const transformedRelationField = this.transformModelRelationField({
              relation,
              currentModel: model,
              models,
            });
            transformedModel.relationFields.push(transformedRelationField);
          });
        }

        if (column.isCalculated) {
          transformedModel.calculatedFields.push(
            this.transformCalculatedField(column, modelMDL.columns),
          );
        } else {
          const nestedColumns = modelNestedColumns.filter(
            (nestedColumn) => nestedColumn.columnId === column.id,
          );
          transformedModel.fields.push(
            this.transformNormalField(column, nestedColumns),
          );
        }
      });
      return transformedModel;
    });

    const diagramViews = views.map(this.transformView);
    return { models: diagramModels, views: diagramViews };
  }

  private transformModel(model: Model): DiagramModel {
    const properties = JSON.parse(model.properties);
    return {
      id: uuidv4(),
      modelId: model.id,
      nodeType: NodeType.MODEL,
      displayName: model.displayName,
      referenceName: model.referenceName,
      sourceTableName: model.sourceTableName,
      refSql: model.refSql,
      refreshTime: model.refreshTime,
      cached: model.cached,
      description: properties?.description,
      fields: [],
      calculatedFields: [],
      relationFields: [],
    };
  }

  private transformNormalField(
    column: ModelColumn,
    nestedColumns: ModelNestedColumn[],
  ): DiagramModelField {
    const properties = JSON.parse(column.properties);
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: column.isCalculated
        ? NodeType.CALCULATED_FIELD
        : NodeType.FIELD,
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description,
      isPrimaryKey: column.isPk,
      expression: column.aggregation,
      nestedFields: nestedColumns.length
        ? nestedColumns.map((nestedColumn) => ({
            id: uuidv4(),
            nestedColumnId: nestedColumn.id,
            columnPath: nestedColumn.columnPath,
            type: nestedColumn.type,
            displayName: nestedColumn.displayName,
            referenceName: nestedColumn.referenceName,
            description: nestedColumn.properties?.description,
          }))
        : null,
    };
  }

  private transformCalculatedField(
    column: ModelColumn,
    columnsMDL: ColumnMDL[],
  ): DiagramModelField {
    const properties = JSON.parse(column.properties);
    const lineage = JSON.parse(column.lineage);
    const columnMDL = columnsMDL.find(
      ({ name }) => name === column.referenceName,
    );
    return {
      id: uuidv4(),
      columnId: column.id,
      nodeType: NodeType.CALCULATED_FIELD,
      aggregation: column.aggregation,
      lineage,
      type: column.type,
      displayName: column.displayName,
      referenceName: column.referenceName,
      description: properties?.description,
      isPrimaryKey: column.isPk,
      expression: columnMDL.expression,
    };
  }

  private transformModelRelationField({
    relation,
    currentModel,
    models,
  }: {
    relation: RelationInfo;
    currentModel: Model;
    models: Model[];
  }): DiagramModelRelationField {
    const referenceName =
      currentModel.referenceName === relation.fromModelName
        ? relation.toModelName
        : relation.fromModelName;
    const displayName = models.find(
      (model) => model.referenceName === referenceName,
    )?.displayName;
    const properties = relation.properties
      ? JSON.parse(relation.properties)
      : null;
    return {
      id: uuidv4(),
      relationId: relation.id,
      nodeType: NodeType.RELATION,
      displayName,
      referenceName,
      type: relation.joinType as RelationType,
      fromModelId: relation.fromModelId,
      fromModelName: relation.fromModelName,
      fromModelDisplayName: relation.fromModelDisplayName,
      fromColumnId: relation.fromColumnId,
      fromColumnName: relation.fromColumnName,
      fromColumnDisplayName: relation.fromColumnDisplayName,
      toModelId: relation.toModelId,
      toModelName: relation.toModelName,
      toModelDisplayName: relation.toModelDisplayName,
      toColumnId: relation.toColumnId,
      toColumnName: relation.toColumnName,
      toColumnDisplayName: relation.toColumnDisplayName,
      description: properties?.description,
    };
  }

  private transformView(view: View): DiagramView {
    const properties = JSON.parse(view.properties);
    const fields = (properties?.columns || []).map((column: any) => ({
      id: uuidv4(),
      nodeType: NodeType.FIELD,
      type: column.type,
      displayName: column.name,
      referenceName: column.name,
      description: column?.properties?.description,
    }));

    return {
      id: uuidv4(),
      viewId: view.id,
      nodeType: NodeType.VIEW,
      statement: view.statement,
      referenceName: view.name,
      displayName: properties?.displayName || view.name,
      fields,
      description: properties?.description,
    };
  }
}

import GraphQLJSON from 'graphql-type-json';
import { ProjectResolver } from './resolvers/projectResolver';
import { ModelResolver } from './resolvers/modelResolver';
import { AskingResolver } from './resolvers/askingResolver';
import { DiagramResolver } from './resolvers/diagramResolver';
import { LearningResolver } from './resolvers/learningResolver';
import { DashboardResolver } from './resolvers/dashboardResolver';
import { SqlPairResolver } from './resolvers/sqlPairResolver';
import { InstructionResolver } from './resolvers/instructionResolver';
import { ApiHistoryResolver } from './resolvers/apiHistoryResolver';
import { convertColumnType } from '@server/utils';
import { DialectSQLScalar } from './scalars';
import { IContext } from './types';
import {
  authorizeNativeScope,
  nativePreviewScope,
} from './services/nativeHumanQuery';
import {
  digest,
  loadQueryDelivery,
  NativeQueryRefusal,
} from './services/nativeQueryAdmission';

// Original native metadata remains native CRUD, not a fabricated query Action.
// This request boundary consumes the existing binding's public scope permission;
// Resource bodies and actual SQL retain their separate read/execution consumers.
function nativeProjectResolver<T extends (...args: any[]) => any>(
  resolver: T,
  permission: string,
  disclose?: (ctx: IContext, output: Awaited<ReturnType<T>>) => Promise<void>,
): T {
  return (async (root: any, args: any, ctx: IContext, info: any) => {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined)
      return resolver(root, args, ctx, info);
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    const before = await authorizeNativeScope(
      config,
      ctx.nativeHumanToken,
      permission,
    );
    const project = await ctx.projectService.getCurrentProject();
    if (
      project.id !== config.projectId ||
      String(project.id) !== config.nativeScopeRef
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const output = await resolver(root, args, ctx, info);
    if (disclose) await disclose(ctx, output);
    if (digest(await loadQueryDelivery()) !== digest(config))
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    const after = await authorizeNativeScope(
      config,
      ctx.nativeHumanToken,
      permission,
    );
    if (after.generation !== before.generation)
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    return output;
  }) as T;
}

const projectResolver = new ProjectResolver();
const modelResolver = new ModelResolver();
const askingResolver = new AskingResolver();
const diagramResolver = new DiagramResolver();
const learningResolver = new LearningResolver();
const dashboardResolver = new DashboardResolver();
const sqlPairResolver = new SqlPairResolver();
const instructionResolver = new InstructionResolver();
const apiHistoryResolver = new ApiHistoryResolver();
const resolvers = {
  JSON: GraphQLJSON,
  DialectSQL: DialectSQLScalar,
  Query: {
    listDataSourceTables: projectResolver.listDataSourceTables,
    autoGenerateRelation: projectResolver.autoGenerateRelation,
    listModels: modelResolver.listModels,
    model: modelResolver.getModel,
    onboardingStatus: projectResolver.getOnboardingStatus,
    modelSync: modelResolver.checkModelSync,
    diagram: diagramResolver.getDiagram,
    schemaChange: projectResolver.getSchemaChange,

    // Ask
    askingTask: askingResolver.getAskingTask,
    suggestedQuestions: askingResolver.getSuggestedQuestions,
    instantRecommendedQuestions: askingResolver.getInstantRecommendedQuestions,

    // Adjustment
    adjustmentTask: askingResolver.getAdjustmentTask,

    // Thread
    thread: askingResolver.getThread,
    threads: askingResolver.listThreads,
    threadResponse: askingResolver.getResponse,
    nativeSql: modelResolver.getNativeSql,

    // Views
    listViews: modelResolver.listViews,
    view: modelResolver.getView,

    // Settings
    settings: projectResolver.getSettings,
    getMDL: modelResolver.getMDL,

    // Learning
    learningRecord: learningResolver.getLearningRecord,

    // Recommendation questions
    getThreadRecommendationQuestions:
      askingResolver.getThreadRecommendationQuestions,
    getProjectRecommendationQuestions:
      projectResolver.getProjectRecommendationQuestions,

    // Dashboard
    dashboardItems: dashboardResolver.getDashboardItems,
    dashboard: dashboardResolver.getDashboard,

    // SQL Pairs
    sqlPairs: sqlPairResolver.getProjectSqlPairs,
    // Instructions
    instructions: instructionResolver.getInstructions,

    // API History
    apiHistory: apiHistoryResolver.getApiHistory,
  },
  Mutation: {
    deploy: nativeProjectResolver(modelResolver.deploy, 'manage'),
    saveDataSource: nativeProjectResolver(
      projectResolver.saveDataSource,
      'manage',
    ),
    startSampleDataset: nativeProjectResolver(
      projectResolver.startSampleDataset,
      'manage',
    ),
    saveTables: nativeProjectResolver(projectResolver.saveTables, 'manage'),
    saveRelations: nativeProjectResolver(
      projectResolver.saveRelations,
      'manage',
    ),
    createModel: nativeProjectResolver(
      modelResolver.createModel,
      'manage',
      async (ctx, row) => {
        await modelResolver.getModel(null, { where: { id: row.id } }, ctx);
      },
    ),
    updateModel: nativeProjectResolver(
      modelResolver.updateModel,
      'manage',
      async (ctx, row) => {
        await modelResolver.getModel(null, { where: { id: row.id } }, ctx);
      },
    ),
    deleteModel: nativeProjectResolver(modelResolver.deleteModel, 'manage'),
    previewModelData: modelResolver.previewModelData,
    updateModelMetadata: nativeProjectResolver(
      modelResolver.updateModelMetadata,
      'manage',
    ),
    triggerDataSourceDetection: nativeProjectResolver(
      projectResolver.triggerDataSourceDetection,
      'manage',
    ),
    resolveSchemaChange: nativeProjectResolver(
      projectResolver.resolveSchemaChange,
      'manage',
    ),

    // calculated field
    createCalculatedField: nativeProjectResolver(
      modelResolver.createCalculatedField,
      'manage',
      async (ctx, row) => {
        await modelResolver.getModel(null, { where: { id: row.modelId } }, ctx);
      },
    ),
    validateCalculatedField: modelResolver.validateCalculatedField,
    updateCalculatedField: nativeProjectResolver(
      modelResolver.updateCalculatedField,
      'manage',
      async (ctx, row) => {
        await modelResolver.getModel(null, { where: { id: row.modelId } }, ctx);
      },
    ),
    deleteCalculatedField: nativeProjectResolver(
      modelResolver.deleteCalculatedField,
      'manage',
    ),

    // relation
    createRelation: nativeProjectResolver(
      modelResolver.createRelation,
      'manage',
      async (ctx, row) => {
        for (const id of [row.fromColumnId, row.toColumnId]) {
          const column = await ctx.modelColumnRepository.findOneBy({ id });
          if (!column) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          await modelResolver.getModel(
            null,
            { where: { id: column.modelId } },
            ctx,
          );
        }
      },
    ),
    updateRelation: nativeProjectResolver(
      modelResolver.updateRelation,
      'manage',
      async (ctx, row) => {
        for (const id of [row.fromColumnId, row.toColumnId]) {
          const column = await ctx.modelColumnRepository.findOneBy({ id });
          if (!column) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          await modelResolver.getModel(
            null,
            { where: { id: column.modelId } },
            ctx,
          );
        }
      },
    ),
    deleteRelation: nativeProjectResolver(
      modelResolver.deleteRelation,
      'manage',
    ),

    // Ask
    createAskingTask: askingResolver.createAskingTask,
    cancelAskingTask: askingResolver.cancelAskingTask,
    createInstantRecommendedQuestions:
      askingResolver.createInstantRecommendedQuestions,
    rerunAskingTask: askingResolver.rerunAskingTask,

    // Adjustment
    adjustThreadResponse: askingResolver.adjustThreadResponse,
    cancelAdjustmentTask: askingResolver.cancelAdjustThreadResponseAnswer,
    rerunAdjustmentTask: askingResolver.rerunAdjustThreadResponseAnswer,

    // Thread
    createThread: askingResolver.createThread,
    updateThread: askingResolver.updateThread,
    deleteThread: askingResolver.deleteThread,
    createThreadResponse: askingResolver.createThreadResponse,
    updateThreadResponse: askingResolver.updateThreadResponse,
    previewData: askingResolver.previewData,
    previewBreakdownData: askingResolver.previewBreakdownData,

    // Generate Thread Response Breakdown
    generateThreadResponseBreakdown:
      askingResolver.generateThreadResponseBreakdown,

    // Generate Thread Response Answer
    generateThreadResponseAnswer: askingResolver.generateThreadResponseAnswer,

    // Generate Thread Response Chart
    generateThreadResponseChart: askingResolver.generateThreadResponseChart,

    // Adjust Thread Response Chart
    adjustThreadResponseChart: askingResolver.adjustThreadResponseChart,

    // Views
    createView: nativeProjectResolver(
      modelResolver.createView,
      'manage',
      async (ctx, row) => {
        await modelResolver.getView(null, { where: { id: row.id } }, ctx);
      },
    ),
    deleteView: nativeProjectResolver(modelResolver.deleteView, 'manage'),
    previewViewData: modelResolver.previewViewData,
    validateView: modelResolver.validateView,
    updateViewMetadata: nativeProjectResolver(
      modelResolver.updateViewMetadata,
      'manage',
    ),

    // Settings
    resetCurrentProject: nativeProjectResolver(
      projectResolver.resetCurrentProject,
      'manage',
    ),
    updateCurrentProject: nativeProjectResolver(
      projectResolver.updateCurrentProject,
      'manage',
    ),
    updateDataSource: nativeProjectResolver(
      projectResolver.updateDataSource,
      'manage',
    ),

    // preview
    previewSql: modelResolver.previewSql,

    // Learning
    saveLearningRecord: learningResolver.saveLearningRecord,

    // Recommendation questions
    generateThreadRecommendationQuestions:
      askingResolver.generateThreadRecommendationQuestions,
    generateProjectRecommendationQuestions: nativeProjectResolver(
      askingResolver.generateProjectRecommendationQuestions,
      'manage',
    ),

    // Dashboard
    updateDashboardItemLayouts: nativeProjectResolver(
      dashboardResolver.updateDashboardItemLayouts,
      'manage',
    ),
    createDashboardItem: nativeProjectResolver(
      dashboardResolver.createDashboardItem,
      'manage',
    ),
    updateDashboardItem: nativeProjectResolver(
      dashboardResolver.updateDashboardItem,
      'manage',
    ),
    deleteDashboardItem: nativeProjectResolver(
      dashboardResolver.deleteDashboardItem,
      'manage',
    ),
    previewItemSQL: dashboardResolver.previewItemSQL,
    setDashboardSchedule: nativeProjectResolver(
      dashboardResolver.setDashboardSchedule,
      'manage',
    ),

    // SQL Pairs
    createSqlPair: nativeProjectResolver(
      sqlPairResolver.createSqlPair,
      'manage',
    ),
    updateSqlPair: nativeProjectResolver(
      sqlPairResolver.updateSqlPair,
      'manage',
    ),
    deleteSqlPair: nativeProjectResolver(
      sqlPairResolver.deleteSqlPair,
      'manage',
    ),
    generateQuestion: sqlPairResolver.generateQuestion,
    modelSubstitute: sqlPairResolver.modelSubstitute,
    // Instructions
    createInstruction: nativeProjectResolver(
      instructionResolver.createInstruction,
      'manage',
    ),
    updateInstruction: nativeProjectResolver(
      instructionResolver.updateInstruction,
      'manage',
    ),
    deleteInstruction: nativeProjectResolver(
      instructionResolver.deleteInstruction,
      'manage',
    ),
  },
  ThreadResponse: askingResolver.getThreadResponseNestedResolver(),
  DetailStep: askingResolver.getDetailStepNestedResolver(),
  ResultCandidate: askingResolver.getResultCandidateNestedResolver(),

  // Handle struct type to record for UI
  DiagramModelField: { type: convertColumnType },
  DiagramModelNestedField: { type: convertColumnType },
  CompactColumn: { type: convertColumnType },
  FieldInfo: { type: convertColumnType },
  DetailedColumn: { type: convertColumnType },
  DetailedNestedColumn: { type: convertColumnType },
  DetailedChangeColumn: { type: convertColumnType },

  // Add this line to include the SqlPair nested resolver
  SqlPair: sqlPairResolver.getSqlPairNestedResolver(),

  // Add ApiHistoryResponse nested resolvers
  ApiHistoryResponse: apiHistoryResolver.getApiHistoryNestedResolver(),
};

// Every original project query checks discovery, including empty dashboards and
// settings which have no model Resource. This does not replace per-body read.
for (const field of Object.keys(
  resolvers.Query,
) as (keyof typeof resolvers.Query)[])
  Object.assign(resolvers.Query, {
    [field]: nativeProjectResolver(resolvers.Query[field], 'discover'),
  });

export default resolvers;

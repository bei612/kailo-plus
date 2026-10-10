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
  NativeQueryDelivery,
} from './services/nativeQueryAdmission';
import {
  nativeWriteUnknown,
  nativeWriteNotStarted,
  NativeWriteReference,
} from './utils/error';

// Original native metadata remains native CRUD, not a fabricated query Action.
// This request boundary consumes the existing binding's public scope permission;
// Resource bodies and actual SQL retain their separate read/execution consumers.
function nativeProjectResolver<T extends (...args: any[]) => any>(
  resolver: T,
  permission: string,
  disclose?: (ctx: IContext, output: Awaited<ReturnType<T>>) => Promise<void>,
  nativeType?: NativeWriteReference['nativeType'],
): T {
  return (async (root: any, args: any, ctx: IContext, info: any) => {
    const identityScope = ctx.nativeIdentityScope;
    const token = ctx.nativeHumanToken;
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      identityScope === undefined &&
      token === undefined
    )
      return resolver(root, args, ctx, info);
    let config: NativeQueryDelivery;
    let scope: string;
    let generation: number;
    try {
      config = await loadQueryDelivery();
      scope = nativePreviewScope(config, identityScope);
      const before = await authorizeNativeScope(config, token, permission);
      generation = before.generation;
      const project = await ctx.projectService.getCurrentProject();
      if (
        project.id !== config.projectId ||
        String(project.id) !== config.nativeScopeRef
      )
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      // Native project loading is asynchronous: its result cannot dispatch
      // under a different delivery or another trusted request identity.
      if (
        digest(await loadQueryDelivery()) !== digest(config) ||
        ctx.nativeIdentityScope !== identityScope ||
        ctx.nativeHumanToken !== token
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    } catch (error) {
      throw permission === 'manage' ? nativeWriteNotStarted(error) : error;
    }
    let preDispatchRefusal: ReturnType<typeof nativeWriteNotStarted>;
    const dispatchContext = {
      ...ctx,
      nativeProjectCheck: async (projectId: number) => {
        try {
          if (
            projectId !== config.projectId ||
            String(projectId) !== config.nativeScopeRef
          )
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          if (digest(await loadQueryDelivery()) !== digest(config))
            throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
          const current = await authorizeNativeScope(config, token, permission);
          if (
            current.generation !== generation ||
            ctx.nativeIdentityScope !== identityScope ||
            ctx.nativeHumanToken !== token ||
            dispatchContext.nativeIdentityScope !== identityScope ||
            dispatchContext.nativeHumanToken !== token
          )
            throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        } catch (error) {
          if (permission !== 'manage') throw error;
          // Only this exact server closure can establish that its refusal
          // happened before native service dispatch. Never trust a service's
          // or upstream's similarly shaped error extension as that evidence.
          preDispatchRefusal = nativeWriteNotStarted(error);
          throw preDispatchRefusal;
        }
      },
    };
    let output: Awaited<ReturnType<T>> | undefined;
    try {
      output = await resolver(root, args, dispatchContext, info);
      if (disclose) await disclose(ctx, output);
      if (digest(await loadQueryDelivery()) !== digest(config))
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const after = await authorizeNativeScope(config, token, permission);
      if (
        after.generation !== generation ||
        ctx.nativeIdentityScope !== identityScope ||
        ctx.nativeHumanToken !== token ||
        dispatchContext.nativeIdentityScope !== identityScope ||
        dispatchContext.nativeHumanToken !== token
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      return output;
    } catch (error) {
      if (permission !== 'manage') throw error;
      if (preDispatchRefusal && error === preDispatchRefusal) throw error;
      const id = (output as any)?.id;
      throw nativeWriteUnknown(
        error,
        scope,
        generation,
        nativeType && Number.isSafeInteger(id) && id > 0
          ? { nativeType, nativeId: id }
          : undefined,
      );
    }
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
      'model',
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
    updateThread: nativeProjectResolver(askingResolver.updateThread, 'manage'),
    deleteThread: nativeProjectResolver(askingResolver.deleteThread, 'manage'),
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
      'view',
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
      undefined,
      'dashboardItem',
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
      undefined,
      'sqlPair',
    ),
    updateSqlPair: nativeProjectResolver(
      sqlPairResolver.updateSqlPair,
      'manage',
      undefined,
      'sqlPair',
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

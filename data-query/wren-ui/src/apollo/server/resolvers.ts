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
import { KailoShareResolver } from './resolvers/kailoShareResolver';
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
import { isGovernedQueryMode } from './services/nativeQueryMode';
import {
  nativeWriteUnknown,
  nativeWriteNotStarted,
  NativeWriteReference,
} from './utils/error';
import {
  assertStandaloneAdmin,
  assertStandaloneOwnerOrAdmin,
  isKailoAdmin,
  kailoAdminRead,
} from './services/kailoUserService';
import { kailoUserLabel } from '@/utils/kailoUser';

type StandaloneCheck = (args: any, ctx: IContext) => Promise<void>;

// DD-133 §3, STANDALONE: what the Core `manage` permission guards on a
// GOVERNED instance is reserved to the Kailo Tenant admin entitlement.
const standaloneAdmin: StandaloneCheck = async (_args, ctx) =>
  assertStandaloneAdmin(ctx.kailoUser, ctx.kailoNativeService);

// STANDALONE: the Kailo user who started a thread may rename, delete or
// correct it; anyone else needs the admin entitlement.
const standaloneThreadOwner =
  (target: (args: any) => { threadId?: number; responseId?: number }) =>
  async (args: any, ctx: IContext) => {
    if (ctx.kailoUser?.admin === true || ctx.kailoNativeService) return;
    assertStandaloneOwnerOrAdmin(
      ctx.kailoUser,
      await ctx.askingService.getThreadOwner(target(args)),
    );
  };

// Original native metadata remains native CRUD, not a fabricated query Action.
// This request boundary consumes the existing binding's public scope permission;
// Resource bodies and actual SQL retain their separate read/execution consumers.
function nativeProjectResolver<T extends (...args: any[]) => any>(
  resolver: T,
  permission: string,
  disclose?: (ctx: IContext, output: Awaited<ReturnType<T>>) => Promise<void>,
  nativeType?: NativeWriteReference['nativeType'],
  standaloneCheck: StandaloneCheck = standaloneAdmin,
): T {
  return (async (root: any, args: any, ctx: IContext, info: any) => {
    const identityScope = ctx.nativeIdentityScope;
    const token = ctx.nativeHumanToken;
    if (!isGovernedQueryMode()) {
      if (permission === 'manage') await standaloneCheck(args, ctx);
      return resolver(root, args, ctx, info);
    }
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

// DD-133 §1: product name = deployment display name + component name.
function kailoProductName(): string {
  const name = process.env.PLATFORM_DISPLAY_NAME?.trim();
  return name || '';
}

const kailoUserOutput = (
  user: {
    name: string | null;
    username: string | null;
    email: string | null;
    picture: string | null;
  },
  isCurrentUser: boolean,
) => ({
  name: kailoUserLabel(user),
  username: user.username,
  email: user.email,
  picture: user.picture,
  isCurrentUser,
});

// DD-133 §3: owners are shown with the Kailo name and avatar; rows created
// before ownership was recorded have none.
const kailoOwner = async (
  parent: { ownerKey?: string | null },
  _args: unknown,
  ctx: IContext,
) => {
  const user = await ctx.kailoUsers?.load(parent?.ownerKey);
  return user
    ? kailoUserOutput(user, user.userKey === ctx.kailoUser?.key)
    : null;
};

const projectResolver = new ProjectResolver();
const modelResolver = new ModelResolver();
const askingResolver = new AskingResolver();
const diagramResolver = new DiagramResolver();
const learningResolver = new LearningResolver();
const dashboardResolver = new DashboardResolver();
const sqlPairResolver = new SqlPairResolver();
const instructionResolver = new InstructionResolver();
const apiHistoryResolver = new ApiHistoryResolver();
const kailoShareResolver = new KailoShareResolver();
const resolvers = {
  JSON: GraphQLJSON,
  DialectSQL: DialectSQLScalar,
  Query: {
    kailoSession: async (_root: any, _args: any, ctx: IContext) => {
      // DD-133(3)(4): the signed-in member is shown like every owner, with the
      // stored profile (the member directory's Kailo display name and avatar
      // once applied); the token claims only when nothing is stored yet.
      const stored = ctx.kailoUser
        ? await ctx.kailoUsers?.load(ctx.kailoUser.key)
        : null;
      return {
        user: ctx.kailoUser
          ? kailoUserOutput(stored ?? ctx.kailoUser, true)
          : null,
        isAdmin: await isKailoAdmin(ctx.kailoUser, ctx.nativeHumanToken),
        productName: kailoProductName(),
        identityLocale: ctx.kailoUser?.locale ?? null,
      };
    },
    kailoShareMembers: kailoShareResolver.members,
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
    threadPage: askingResolver.listThreadPage,
    threadResponse: askingResolver.getResponse,
    nativeSql: modelResolver.getNativeSql,

    // Views
    listViews: modelResolver.listViews,
    view: modelResolver.getView,

    // Settings
    settings: projectResolver.getSettings,
    getMDL: modelResolver.getMDL,

    // Learning — DD-138(7): closed, guidance is Kailo's (refused).
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

    // API History — DD-138(7): administration data, managers only.
    apiHistory: kailoAdminRead(apiHistoryResolver.getApiHistory),
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
    updateThread: nativeProjectResolver(
      askingResolver.updateThread,
      'manage',
      undefined,
      undefined,
      standaloneThreadOwner((args) => ({ threadId: args.where?.id })),
    ),
    deleteThread: nativeProjectResolver(
      askingResolver.deleteThread,
      'manage',
      undefined,
      undefined,
      standaloneThreadOwner((args) => ({ threadId: args.where?.id })),
    ),
    createThreadResponse: askingResolver.createThreadResponse,
    updateThreadResponse: nativeProjectResolver(
      askingResolver.updateThreadResponse,
      'manage',
      undefined,
      undefined,
      standaloneThreadOwner((args) => ({ responseId: args.where?.id })),
    ),
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
    // DD-138(4): notification only, no native write; the service validates
    // the target in the current project and the recipients in the directory.
    shareWithMembers: kailoShareResolver.share,
    deleteInstruction: nativeProjectResolver(
      instructionResolver.deleteInstruction,
      'manage',
    ),
  },
  KailoSession: { shareAvailable: kailoShareResolver.available },
  Thread: { owner: kailoOwner },
  Instruction: { owner: kailoOwner },
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
  SqlPair: { ...sqlPairResolver.getSqlPairNestedResolver(), owner: kailoOwner },

  // Add ApiHistoryResponse nested resolvers
  ApiHistoryResponse: {
    ...apiHistoryResolver.getApiHistoryNestedResolver(),
    owner: kailoOwner,
  },
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

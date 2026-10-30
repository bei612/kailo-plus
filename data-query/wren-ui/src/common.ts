import { getConfig } from '@server/config';
import { bootstrapKnex } from './apollo/server/utils/knex';
import {
  ProjectRepository,
  ViewRepository,
  DeployLogRepository,
  ThreadRepository,
  ThreadResponseRepository,
  ModelRepository,
  ModelColumnRepository,
  RelationRepository,
  SchemaChangeRepository,
  ModelNestedColumnRepository,
  LearningRepository,
  DashboardItemRepository,
  DashboardRepository,
  SqlPairRepository,
  AskingTaskRepository,
  InstructionRepository,
  ApiHistoryRepository,
  DashboardItemRefreshJobRepository,
  KailoUserRepository,
} from '@server/repositories';
import {
  WrenEngineAdaptor,
  WrenAIAdaptor,
  IbisAdaptor,
} from '@server/adaptors';
import {
  DataSourceMetadataService,
  QueryService,
  ProjectService,
  DeployService,
  AskingService,
  MDLService,
  DashboardService,
  AskingTaskTracker,
  InstructionService,
} from '@server/services';
import { PostHogTelemetry } from './apollo/server/telemetry/telemetry';
import {
  ProjectRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
  DashboardCacheBackgroundTracker,
} from './apollo/server/backgrounds';
import { SqlPairService } from './apollo/server/services/sqlPairService';
import { loadQueryDelivery } from './apollo/server/services/nativeQueryAdmission';
import { isGovernedQueryMode } from './apollo/server/services/nativeQueryMode';
import { KailoUserDirectory } from './apollo/server/services/kailoUserService';
import {
  kailoDirectoryConfig,
  KailoMemberDirectoryStore,
  KailoMemberDirectorySync,
} from './apollo/server/services/kailoMemberDirectory';
import {
  KailoNotifier,
  KailoNotifications,
} from './apollo/server/services/kailoNotifications';
import { KailoUsage } from './apollo/server/services/kailoUsage';
import { KailoShareService } from './apollo/server/services/kailoShare';

export const serverConfig = getConfig();

export const initComponents = () => {
  const telemetry = new PostHogTelemetry();
  const knex = bootstrapKnex({
    dbType: serverConfig.dbType,
    pgUrl: serverConfig.pgUrl,
    debug: serverConfig.debug,
    sqliteFile: serverConfig.sqliteFile,
  });

  // repositories
  // A configured integration consumes the same controlled project selection as
  // its Adapter. An unreadable/removed delivery never falls back to the first row.
  // Independent native instances without a binding retain their original setup.
  const projectRepository = new ProjectRepository(
    knex,
    !isGovernedQueryMode()
      ? undefined
      : async () => (await loadQueryDelivery()).projectId,
  );
  const deployLogRepository = new DeployLogRepository(knex);
  const threadRepository = new ThreadRepository(knex);
  const threadResponseRepository = new ThreadResponseRepository(knex);
  const viewRepository = new ViewRepository(knex);
  const modelRepository = new ModelRepository(knex);
  const modelColumnRepository = new ModelColumnRepository(knex);
  const modelNestedColumnRepository = new ModelNestedColumnRepository(knex);
  const relationRepository = new RelationRepository(knex);
  const schemaChangeRepository = new SchemaChangeRepository(knex);
  const learningRepository = new LearningRepository(knex);
  const dashboardRepository = new DashboardRepository(knex);
  const dashboardItemRepository = new DashboardItemRepository(knex);
  const sqlPairRepository = new SqlPairRepository(knex);
  const askingTaskRepository = new AskingTaskRepository(knex);
  const instructionRepository = new InstructionRepository(knex);
  const apiHistoryRepository = new ApiHistoryRepository(knex);
  const dashboardItemRefreshJobRepository =
    new DashboardItemRefreshJobRepository(knex);
  const kailoUserRepository = new KailoUserRepository(knex);
  // DD-133(4): the Core member directory, only when the deployment configures
  // it (a partial configuration refuses to start). The persisted snapshot
  // decides membership and the STANDALONE role; reads repeat every interval.
  const kailoDirectoryConfiguration = kailoDirectoryConfig();
  const kailoMemberDirectory = kailoDirectoryConfiguration
    ? new KailoMemberDirectoryStore(knex)
    : null;
  const kailoUserDirectory = new KailoUserDirectory(
    kailoUserRepository,
    kailoMemberDirectory,
  );
  const kailoMemberDirectorySync = kailoDirectoryConfiguration
    ? new KailoMemberDirectorySync(
        kailoDirectoryConfiguration,
        kailoMemberDirectory,
      )
    : null;
  kailoMemberDirectorySync?.start();
  // DD-138(4), `07` §4.8.3: Kailo inbox delivery with the same directory
  // client; a no-op without the directory configuration.
  const kailoNotifications = new KailoNotifications(
    new KailoNotifier(kailoDirectoryConfiguration),
    kailoUserRepository,
    kailoMemberDirectory,
  );
  // DD-165, `07` §4.8.9: Kailo quota admission and usage reports with the
  // same directory client; a no-op without the directory configuration.
  const kailoUsage = new KailoUsage(kailoDirectoryConfiguration);
  const kailoShareService = new KailoShareService(
    kailoNotifications,
    kailoMemberDirectory,
    kailoUserRepository,
  );

  // adaptors
  const wrenEngineAdaptor = new WrenEngineAdaptor({
    wrenEngineEndpoint: serverConfig.wrenEngineEndpoint,
  });
  const wrenAIAdaptor = new WrenAIAdaptor({
    wrenAIBaseEndpoint: serverConfig.wrenAIEndpoint,
  });
  const ibisAdaptor = new IbisAdaptor({
    ibisServerEndpoint: serverConfig.ibisServerEndpoint,
  });

  // services
  const metadataService = new DataSourceMetadataService({
    ibisAdaptor,
    wrenEngineAdaptor,
  });
  const queryService = new QueryService({
    ibisAdaptor,
    wrenEngineAdaptor,
    telemetry,
  });
  const deployService = new DeployService({
    wrenAIAdaptor,
    deployLogRepository,
    telemetry,
  });
  const mdlService = new MDLService({
    projectRepository,
    modelRepository,
    modelColumnRepository,
    modelNestedColumnRepository,
    relationRepository,
    viewRepository,
  });
  const projectService = new ProjectService({
    projectRepository,
    metadataService,
    mdlService,
    wrenAIAdaptor,
    telemetry,
  });
  const askingTaskTracker = new AskingTaskTracker({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
  });
  const askingService = new AskingService({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    queryService,
    mdlService,
    askingTaskTracker,
    askingTaskRepository,
  });
  const dashboardService = new DashboardService({
    projectService,
    dashboardItemRepository,
    dashboardRepository,
  });
  const sqlPairService = new SqlPairService({
    sqlPairRepository,
    wrenAIAdaptor,
    ibisAdaptor,
    apiHistoryRepository,
  });
  const instructionService = new InstructionService({
    instructionRepository,
    wrenAIAdaptor,
  });

  // background trackers
  const projectRecommendQuestionBackgroundTracker =
    new ProjectRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      projectRepository,
    });
  const threadRecommendQuestionBackgroundTracker =
    new ThreadRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadRepository,
    });
  const dashboardCacheBackgroundTracker = new DashboardCacheBackgroundTracker({
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    projectService,
    deployService,
    queryService,
    // DD-138(4): a scheduled run with failed items -> Kailo Tenant admins.
    onScheduledRefreshFinished: (run) =>
      void kailoNotifications.dashboardRefreshFinished(run),
  });

  return {
    knex,
    telemetry,

    // repositories
    projectRepository,
    deployLogRepository,
    threadRepository,
    threadResponseRepository,
    viewRepository,
    modelRepository,
    modelColumnRepository,
    relationRepository,
    schemaChangeRepository,
    learningRepository,
    modelNestedColumnRepository,
    dashboardRepository,
    dashboardItemRepository,
    sqlPairRepository,
    askingTaskRepository,
    apiHistoryRepository,
    instructionRepository,
    dashboardItemRefreshJobRepository,
    kailoUserRepository,
    kailoUserDirectory,
    kailoMemberDirectory,
    kailoMemberDirectorySync,
    kailoNotifications,
    kailoShareService,
    kailoUsage,

    // adaptors
    wrenEngineAdaptor,
    wrenAIAdaptor,
    ibisAdaptor,

    // services
    metadataService,
    projectService,
    queryService,
    deployService,
    askingService,
    mdlService,
    dashboardService,
    sqlPairService,
    instructionService,
    askingTaskTracker,

    // background trackers
    projectRecommendQuestionBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
    dashboardCacheBackgroundTracker,
  };
};

// singleton components
export const components = initComponents();

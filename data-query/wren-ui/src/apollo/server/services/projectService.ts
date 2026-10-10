import type { Knex } from 'knex';
import crypto from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { getLogger } from '@server/utils';
import { IProjectRepository, WREN_AI_CONNECTION_INFO } from '../repositories';
import { Project } from '../repositories';
import {
  CompactTable,
  IDataSourceMetadataService,
  RecommendConstraint,
} from './metadataService';
import { DataSourceName } from '../types';
import {
  RecommendationQuestion,
  RecommendationQuestionStatus,
  WrenAIError,
  WrenAILanguage,
} from '@server/models/adaptor';
import { encryptConnectionInfo } from '../dataSource';
import { IWrenAIAdaptor } from '../adaptors';
import { RecommendQuestionResultStatus } from './askingService';
import { IMDLService } from './mdlService';
import { ProjectRecommendQuestionBackgroundTracker } from '../backgrounds';
import { ITelemetry } from '../telemetry/telemetry';
import { getConfig } from '../config';
import { NativeQueryRefusal } from './nativeQueryAdmission';

const config = getConfig();

const logger = getLogger('ProjectService');
logger.level = 'debug';

const SENSITIVE_PROPERTY_NAME = new Set([
  'credentials',
  'password',
  'awsSecretKey',
  'privateKey',
  'accessToken',
  'clientSecret',
  'webIdentityToken',
]);
export interface ProjectData {
  displayName: string;
  type: DataSourceName;
  connectionInfo: WREN_AI_CONNECTION_INFO;
}

export interface ProjectRecommendationQuestionsResult {
  status: RecommendQuestionResultStatus;
  questions: RecommendationQuestion[];
  error: WrenAIError;
}
export interface IProjectService {
  createProject: (projectData: ProjectData) => Promise<Project>;
  updateProject: (
    projectId: number,
    projectData: Partial<Project>,
  ) => Promise<Project>;
  getGeneralConnectionInfo: (project: Project) => Record<string, any>;
  getProjectDataSourceTables: (
    project?: Project,
    projectId?: number,
  ) => Promise<CompactTable[]>;
  getProjectDataSourceVersion: (
    project?: Project,
    projectId?: number,
  ) => Promise<string>;
  getProjectSuggestedConstraint: (
    project?: Project,
    projectId?: number,
  ) => Promise<RecommendConstraint[]>;

  getCurrentProject: () => Promise<Project>;
  getProjectById: (projectId: number) => Promise<Project>;
  writeCredentialFile: (
    credentials: JSON,
    persistCredentialDir: string,
  ) => string;
  deleteProject: (projectId: number, tx?: Knex.Transaction) => Promise<void>;
  getProjectRecommendationQuestions: (
    project?: Project,
    beforeRead?: (projectId: number) => Promise<void>,
  ) => Promise<ProjectRecommendationQuestionsResult>;

  // recommend questions
  generateProjectRecommendationQuestions: (
    project?: Project,
    beforeWrite?: (projectId: number) => Promise<void>,
  ) => Promise<void>;
}

export class ProjectService implements IProjectService {
  private projectRepository: IProjectRepository;
  private metadataService: IDataSourceMetadataService;
  private mdlService: IMDLService;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRecommendQuestionBackgroundTracker: ProjectRecommendQuestionBackgroundTracker;
  constructor({
    projectRepository,
    metadataService,
    mdlService,
    wrenAIAdaptor,
    telemetry,
  }: {
    projectRepository: IProjectRepository;
    metadataService: IDataSourceMetadataService;
    mdlService: IMDLService;
    wrenAIAdaptor: IWrenAIAdaptor;
    telemetry: ITelemetry;
  }) {
    this.projectRepository = projectRepository;
    this.metadataService = metadataService;
    this.mdlService = mdlService;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRecommendQuestionBackgroundTracker =
      new ProjectRecommendQuestionBackgroundTracker({
        projectRepository,
        telemetry,
        wrenAIAdaptor,
      });
  }
  public async updateProject(
    projectId: number,
    projectData: Partial<Project>,
  ): Promise<Project> {
    return await this.projectRepository.updateOne(projectId, projectData);
  }

  public async getProjectDataSourceVersion(
    project?: Project,
    projectId?: number,
  ): Promise<string> {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.getVersion(usedProject);
  }

  public async generateProjectRecommendationQuestions(
    selectedProject?: Project,
    beforeWrite?: (projectId: number) => Promise<void>,
  ): Promise<void> {
    const configured = () =>
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE !== undefined;
    const bound = configured() || beforeWrite !== undefined;
    if (bound && (!selectedProject || !beforeWrite))
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const project = selectedProject ?? (await this.getCurrentProject());
    if (!project) {
      throw new Error(`Project not found`);
    }
    const check = async () => {
      if (!bound && configured())
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      await beforeWrite?.(project.id);
    };
    await check();
    const { manifest } = await this.mdlService.makeCurrentModelMDL(project);
    await check();
    const recommendQuestionResult =
      await this.wrenAIAdaptor.generateRecommendationQuestions({
        manifest,
        ...this.getProjectRecommendationQuestionsConfig(project),
      });

    const updatedProject = await this.projectRepository.updateOne(project.id, {
      queryId: recommendQuestionResult.queryId,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      questionsError: null,
    });

    this.projectRecommendQuestionBackgroundTracker.addTask(updatedProject);
  }

  public async getProjectRecommendationQuestions(
    selectedProject?: Project,
    beforeRead?: (projectId: number) => Promise<void>,
  ) {
    const configured = () =>
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE !== undefined;
    const bound = configured() || beforeRead !== undefined;
    if (bound && (!selectedProject || !beforeRead))
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const project = selectedProject ?? (await this.getCurrentProject());
    if (!project) {
      throw new Error(`Project not found`);
    }
    if (!bound && configured())
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    await beforeRead?.(project.id);
    // Resume only the persisted native query. This read never POSTs a model
    // request, including after a process restart or temporary observation error.
    this.projectRecommendQuestionBackgroundTracker.addTask(project);
    const result: ProjectRecommendationQuestionsResult = {
      status: RecommendQuestionResultStatus.NOT_STARTED,
      questions: [],
      error: null,
    };
    if (project.queryId) {
      result.status = project.questionsStatus
        ? RecommendQuestionResultStatus[project.questionsStatus]
        : result.status;
      result.questions = project.questions || [];
      result.error = project.questionsError as WrenAIError;
    }
    return result;
  }

  public async getCurrentProject() {
    return await this.projectRepository.getCurrentProject();
  }

  public async getProjectById(projectId: number) {
    return await this.projectRepository.findOneBy({ id: projectId });
  }

  public async getProjectDataSourceTables(
    project?: Project,
    projectId?: number,
  ) {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.listTables(usedProject);
  }

  public async getProjectSuggestedConstraint(
    project?: Project,
    projectId?: number,
  ) {
    const usedProject = project
      ? project
      : projectId
        ? await this.getProjectById(projectId)
        : await this.getCurrentProject();
    return await this.metadataService.listConstraints(usedProject);
  }

  public async createProject(projectData: ProjectData) {
    const projectValue = {
      displayName: projectData.displayName,
      type: projectData.type,
      catalog: 'wrenai',
      schema: 'public',
      connectionInfo: encryptConnectionInfo(
        projectData.type,
        projectData.connectionInfo,
      ),
    };
    logger.debug('Creating project...');
    const project = await this.projectRepository.createOne(projectValue);
    return project;
  }

  public writeCredentialFile(credentials: JSON, persistCredentialDir: string) {
    // create persist_credential_dir if not exists
    if (!fs.existsSync(persistCredentialDir)) {
      fs.mkdirSync(persistCredentialDir, { recursive: true });
    }
    // file name will be the hash of the credentials, file path is current working directory
    // convert credentials from base64 to string and replace all the matched "\n" with "\\n",  there are many \n in the "private_key" property
    const credentialString = JSON.stringify(credentials);
    const fileName = crypto
      .createHash('md5')
      .update(credentialString)
      .digest('hex');

    const filePath = path.join(persistCredentialDir, `${fileName}.json`);
    // check if file exists
    if (fs.existsSync(filePath)) {
      logger.debug(`File ${filePath} already exists`);
      return filePath;
    }
    fs.writeFileSync(filePath, credentialString);
    logger.debug(`Wrote credentials to file`);
    return filePath;
  }

  public async deleteProject(
    projectId: number,
    tx?: Knex.Transaction,
  ): Promise<void> {
    await this.projectRepository.deleteOne(projectId, { tx });
  }

  public getGeneralConnectionInfo(project) {
    return Object.entries(project.connectionInfo).reduce(
      (acc, [key, value]) => {
        if (!SENSITIVE_PROPERTY_NAME.has(key)) {
          acc[key] = value;
        }
        return acc;
      },
      {},
    );
  }

  private getProjectRecommendationQuestionsConfig(project: Project) {
    return {
      projectId: String(project.id),
      maxCategories: config.projectRecommendationQuestionMaxCategories,
      maxQuestions: config.projectRecommendationQuestionsMaxQuestions,
      regenerate: true,
      configuration: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };
  }
}

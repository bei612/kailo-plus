import { DeployService } from '../deployService';
import {
  DeployLogRepository,
  DeployStatusEnum,
} from '@server/repositories/deployLogRepository';
import knex, { Knex } from 'knex';
import { randomInt, randomUUID } from 'crypto';
import { join } from 'path';
import { ModelResolver } from '../../resolvers/modelResolver';
import { ProjectResolver } from '../../resolvers/projectResolver';

describe('DeployService', () => {
  let mockWrenAIAdaptor;

  let mockDeployLogRepository;
  let deployService;
  let mockTelemetry;

  beforeEach(() => {
    mockTelemetry = { sendEvent: jest.fn() };
    mockWrenAIAdaptor = { deploy: jest.fn(), observeDeploy: jest.fn() };
    mockDeployLogRepository = {
      beginDeployment: jest
        .fn()
        .mockImplementation(async (data) => ({
          deploy: { ...data, id: 123 },
          created: true,
        })),
      findInProgressProjectDeployLog: jest.fn(),
      findLastProjectDeployLog: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };

    deployService = new DeployService({
      telemetry: mockTelemetry,
      wrenAIAdaptor: mockWrenAIAdaptor,
      deployLogRepository: mockDeployLogRepository,
    });
  });

  it('should successfully deploy when there is no existing deployment with the same hash', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.SUCCESS,
      error: undefined,
    });
  });

  it('should return failed status if ai-service deployment fails', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({
      status: 'FAILED',
      error: 'AI error',
    });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.FAILED);
    expect(response.error).toEqual('AI error');
  });

  it('should skip deployment if an existing deployment with the same hash exists', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.beginDeployment.mockResolvedValue({
      deploy: {
        hash: deployService.createMDLHash(manifest, 1),
        status: 'SUCCESS',
      },
      created: false,
    });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('retains a persisted intent after dispatch or terminal persistence is uncertain', async () => {
    mockWrenAIAdaptor.deploy.mockRejectedValueOnce(new Error('socket closed'));
    expect((await deployService.deploy({}, 1)).status).toBe('IN_PROGRESS');
    expect(mockDeployLogRepository.updateOne).not.toHaveBeenCalled();
    mockWrenAIAdaptor.deploy.mockResolvedValueOnce({ status: 'SUCCESS' });
    mockDeployLogRepository.updateOne.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    expect((await deployService.deploy({}, 1)).status).toBe('IN_PROGRESS');
  });

  it('does not repeat a pending dispatch even when forced or the manifest changes', async () => {
    mockDeployLogRepository.beginDeployment.mockResolvedValue({
      deploy: { id: 123, hash: 'previous', status: 'IN_PROGRESS' },
      created: false,
    });
    mockWrenAIAdaptor.observeDeploy.mockResolvedValue({
      status: 'IN_PROGRESS',
    });
    expect((await deployService.deploy({}, 1, true)).status).toBe(
      'IN_PROGRESS',
    );
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
    expect(mockWrenAIAdaptor.observeDeploy).toHaveBeenCalledWith(
      'previous',
      '123',
    );
    mockWrenAIAdaptor.observeDeploy.mockResolvedValue({ status: 'SUCCESS' });
    expect((await deployService.deploy({}, 1, true)).status).toBe(
      'IN_PROGRESS',
    );
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('reconciles the same persisted deployment through the original status read', async () => {
    const pending = { id: 123, hash: 'same', status: 'IN_PROGRESS' };
    mockDeployLogRepository.findInProgressProjectDeployLog.mockResolvedValue(
      pending,
    );
    mockWrenAIAdaptor.observeDeploy.mockResolvedValueOnce({
      status: 'IN_PROGRESS',
    });
    expect(await deployService.getInProgressDeployment(1)).toBe(pending);
    expect(mockDeployLogRepository.updateOne).not.toHaveBeenCalled();
    for (const status of ['SUCCESS', 'FAILED']) {
      mockWrenAIAdaptor.observeDeploy.mockResolvedValueOnce({ status });
      expect(await deployService.getInProgressDeployment(1)).toBeNull();
      expect(mockDeployLogRepository.updateOne).toHaveBeenLastCalledWith(123, {
        status,
        error: undefined,
      });
    }
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('does not dispatch before a committed native intent or treat an unknown enum as failure', async () => {
    mockDeployLogRepository.beginDeployment.mockRejectedValueOnce(
      new Error('commit unknown'),
    );
    await expect(deployService.deploy({}, 1)).rejects.toThrow('commit unknown');
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
    mockWrenAIAdaptor.deploy.mockResolvedValueOnce({ status: 'FUTURE_STATUS' });
    expect((await deployService.deploy({}, 1)).status).toBe('IN_PROGRESS');
    expect(mockDeployLogRepository.updateOne).not.toHaveBeenCalled();
  });

  it('original model status reads the reconciled successful deployment, not its stale predecessor', async () => {
    let reconciled = false;
    const ctx: any = {
      projectService: { getCurrentProject: async () => ({ id: 1 }) },
      mdlService: { makeCurrentModelMDL: async () => ({ manifest: {} }) },
      deployService: {
        createMDLHash: () => 'current',
        getInProgressDeployment: async () => {
          reconciled = true;
          return null;
        },
        getLastDeployment: async () => ({
          hash: reconciled ? 'current' : 'old',
        }),
      },
    };
    expect(await new ModelResolver().checkModelSync(null, null, ctx)).toEqual({
      status: 'SYNCRONIZED',
    });
  });

  it('original explicit and onboarding callers do not launch recommendations on an unresolved or failed deploy', async () => {
    const ctx: any = {
      projectService: {
        getCurrentProject: async () => ({
          id: 1,
          version: 'native-version',
          sampleDataset: null,
        }),
        generateProjectRecommendationQuestions: jest.fn(),
      },
      mdlService: { makeCurrentModelMDL: async () => ({ manifest: {} }) },
      deployService: { deploy: jest.fn() },
    };
    for (const status of ['IN_PROGRESS', 'FAILED', 'SUCCESS']) {
      ctx.deployService.deploy.mockResolvedValue({ status });
      ctx.projectService.generateProjectRecommendationQuestions.mockClear();
      await new ModelResolver().deploy(null, { force: false }, ctx);
      await (new ProjectResolver() as any).deploy(ctx);
      expect(
        ctx.projectService.generateProjectRecommendationQuestions,
      ).toHaveBeenCalledTimes(status === 'SUCCESS' ? 2 : 0);
    }
  });
});

const databaseTests = process.env.WREN_QUERY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
databaseTests('original deployment transaction in isolated PostgreSQL', () => {
  let database: Knex;
  let repository: DeployLogRepository;
  let projectId: number;
  const schema = `deploy_evidence_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    database = knex({
      client: 'pg',
      connection: process.env.WREN_QUERY_TEST_DATABASE_URL,
      searchPath: [schema],
    });
    await database.schema.createSchema(schema);
    await require(
      join(process.cwd(), 'migrations/20240125070643_create_project_table.js'),
    ).up(database);
    await require(
      join(process.cwd(), 'migrations/20240319083758_create_deploy_table.js'),
    ).up(database);
    repository = new DeployLogRepository(database);
    projectId = randomInt(1, 2147483647);
    await database('project').insert({
      id: projectId,
      type: 'DUCKDB',
      display_name: randomUUID(),
      catalog: 'wrenai',
      schema: 'public',
    });
  });
  afterAll(async () => {
    await database.schema.dropSchemaIfExists(schema, true);
    await database.destroy();
  });

  it('commits one intent under concurrent and forced dispatch, retaining original successful-hash behavior', async () => {
    const data = {
      projectId,
      hash: randomUUID(),
      manifest: {},
      status: DeployStatusEnum.IN_PROGRESS,
    };
    const [first, second] = await Promise.all([
      repository.beginDeployment(data, false),
      repository.beginDeployment(data, true),
    ]);
    expect(Number(first.created) + Number(second.created)).toBe(1);
    expect(first.deploy.id).toBe(second.deploy.id);
    expect(
      await database('deploy_log').where({ project_id: projectId }),
    ).toHaveLength(1);
    await repository.updateOne(first.deploy.id, {
      status: DeployStatusEnum.FAILED,
    });
    const retry = await repository.beginDeployment(data, false);
    expect(retry.created).toBe(true);
    expect(retry.deploy.id).not.toBe(first.deploy.id);
    await repository.updateOne(retry.deploy.id, {
      status: DeployStatusEnum.SUCCESS,
    });
    expect((await repository.beginDeployment(data, false)).created).toBe(false);
    expect((await repository.beginDeployment(data, true)).created).toBe(true);
  });
});

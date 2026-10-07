import { ProjectRecommendQuestionBackgroundTracker } from '../../backgrounds/recommend-question';
import { ProjectRepository } from '../../repositories/projectRepository';
import { ProjectService } from '../projectService';
import { RecommendationQuestionStatus as Status } from '../../models/adaptor';
import knex, { Knex } from 'knex';
import { randomInt, randomUUID } from 'crypto';
import { join } from 'path';

describe('persisted project recommendation observation', () => {
  let tick: () => Promise<void>;
  let repository: any, adaptor: any, telemetry: any, project: any;
  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation(((callback) => {
      tick = callback;
      return 0;
    }) as any);
    project = {
      id: 17,
      type: 'DUCKDB',
      queryId: 'native-query',
      questionsStatus: Status.GENERATING,
      questions: [],
    };
    repository = {
      findAll: jest.fn().mockResolvedValue([project]),
      findOneBy: jest
        .fn()
        .mockImplementation(async ({ queryId }) =>
          queryId === project.queryId ? project : null,
        ),
      getCurrentProject: jest.fn().mockImplementation(async () => project),
      updateRecommendationQuestions: jest
        .fn()
        .mockImplementation(async (_id, queryId, update) =>
          queryId === project.queryId ? { ...project, ...update } : null,
        ),
    };
    adaptor = {
      getRecommendationQuestionsResult: jest.fn(),
      generateRecommendationQuestions: jest.fn(),
    };
    telemetry = { sendEvent: jest.fn() };
  });
  afterEach(() => jest.restoreAllMocks());
  const result = (status = Status.FINISHED) => ({
    status,
    response: {
      questions: [
        { question: 'actual', category: 'category', sql: 'select 1' },
      ],
    },
    error: null,
  });
  const tracker = () =>
    new ProjectRecommendQuestionBackgroundTracker({
      projectRepository: repository,
      wrenAIAdaptor: adaptor,
      telemetry,
    });

  it('starts from persisted query IDs and finalizes through the original timer without redispatch', async () => {
    const observer = tracker();
    await Promise.resolve();
    adaptor.getRecommendationQuestionsResult.mockResolvedValue(result());
    await tick();
    expect(adaptor.getRecommendationQuestionsResult).toHaveBeenCalledWith(
      'native-query',
    );
    expect(repository.updateRecommendationQuestions).toHaveBeenCalledWith(
      17,
      'native-query',
      expect.objectContaining({ questionsStatus: Status.FINISHED }),
    );
    expect(observer.getTasks()).toEqual({});
    expect(telemetry.sendEvent).toHaveBeenCalledTimes(1);
    expect(adaptor.generateRecommendationQuestions).not.toHaveBeenCalled();
  });

  it('releases a rejected observation and retries only the same existing native query', async () => {
    const observer = tracker();
    await Promise.resolve();
    adaptor.getRecommendationQuestionsResult
      .mockRejectedValueOnce(new Error('temporary disconnect'))
      .mockResolvedValue(result());
    await tick();
    expect(repository.updateRecommendationQuestions).not.toHaveBeenCalled();
    expect(observer.getTasks()[17]).toBe(project);
    await tick();
    expect(adaptor.getRecommendationQuestionsResult).toHaveBeenCalledTimes(2);
    expect(observer.getTasks()).toEqual({});
    expect(adaptor.generateRecommendationQuestions).not.toHaveBeenCalled();
  });

  it('retries persistence failure without losing the native outcome', async () => {
    const observer = tracker();
    await Promise.resolve();
    adaptor.getRecommendationQuestionsResult.mockResolvedValue(result());
    repository.updateRecommendationQuestions.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await tick();
    expect(observer.getTasks()[17]).toBe(project);
    await tick();
    expect(repository.updateRecommendationQuestions).toHaveBeenCalledTimes(2);
    expect(observer.getTasks()).toEqual({});
  });

  it('does not let an old in-flight receipt remove a newly attached query', async () => {
    const observer = tracker();
    await Promise.resolve();
    let finish: (value: any) => void;
    adaptor.getRecommendationQuestionsResult.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = tick();
    await Promise.resolve();
    project = { ...project, queryId: 'new-native-query' };
    observer.addTask(project);
    finish(result());
    await pending;
    expect(repository.updateRecommendationQuestions).toHaveBeenCalledWith(
      17,
      'native-query',
      expect.anything(),
    );
    expect(observer.getTasks()[17].queryId).toBe('new-native-query');
    expect(telemetry.sendEvent).not.toHaveBeenCalled();
    adaptor.getRecommendationQuestionsResult.mockResolvedValue(result());
    await tick();
    expect(observer.getTasks()).toEqual({});
  });

  it('does not observe an absent, replaced or already terminal persisted query', async () => {
    const observer = tracker();
    await Promise.resolve();
    repository.findOneBy.mockResolvedValue(null);
    await tick();
    expect(adaptor.getRecommendationQuestionsResult).not.toHaveBeenCalled();
    expect(observer.getTasks()).toEqual({});
    observer.addTask({ ...project, queryId: undefined });
    observer.addTask({ ...project, questionsStatus: Status.FINISHED });
    expect(observer.getTasks()).toEqual({});
  });

  it('retains unknown status and same-length changed partial results correctly', async () => {
    const observer = tracker();
    await Promise.resolve();
    adaptor.getRecommendationQuestionsResult
      .mockResolvedValueOnce(result('FUTURE' as Status))
      .mockResolvedValue(result(Status.GENERATING));
    await tick();
    expect(repository.updateRecommendationQuestions).not.toHaveBeenCalled();
    await tick();
    adaptor.getRecommendationQuestionsResult.mockResolvedValue({
      ...result(Status.GENERATING),
      response: {
        questions: [
          { question: 'changed', category: 'category', sql: 'select 2' },
        ],
      },
    });
    await tick();
    expect(observer.getTasks()[17].questions[0].question).toBe('changed');
  });

  it('reattaches from the actual ProjectService read after initialization storage failure', async () => {
    repository.findAll.mockRejectedValue(
      new Error('startup database unavailable'),
    );
    const service = new ProjectService({
      projectRepository: repository,
      wrenAIAdaptor: adaptor,
      telemetry,
      metadataService: {} as any,
      mdlService: {} as any,
    });
    await Promise.resolve();
    await service.getProjectRecommendationQuestions();
    adaptor.getRecommendationQuestionsResult.mockResolvedValue(result());
    await tick();
    expect(adaptor.getRecommendationQuestionsResult).toHaveBeenCalledWith(
      'native-query',
    );
    expect(adaptor.generateRecommendationQuestions).not.toHaveBeenCalled();
  });
});

const databaseTests = process.env.WREN_QUERY_TEST_DATABASE_URL
  ? describe
  : describe.skip;
databaseTests(
  'recommendation receipt CAS in original PostgreSQL project',
  () => {
    let database: Knex, repository: ProjectRepository;
    const schema = `recommendation_evidence_${randomUUID().replaceAll('-', '')}`;
    const projectId = randomInt(1, 2147483647);
    beforeAll(async () => {
      database = knex({
        client: 'pg',
        connection: process.env.WREN_QUERY_TEST_DATABASE_URL,
        searchPath: [schema],
      });
      await database.schema.createSchema(schema);
      await require(
        join(
          process.cwd(),
          'migrations/20240125070643_create_project_table.js',
        ),
      ).up(database);
      await require(
        join(
          process.cwd(),
          'migrations/20241106232204_update_project_table.js',
        ),
      ).up(database);
      repository = new ProjectRepository(database);
      await database('project').insert({
        id: projectId,
        type: 'DUCKDB',
        display_name: randomUUID(),
        catalog: 'wrenai',
        schema: 'public',
        query_id: 'new-query',
        questions_status: Status.GENERATING,
      });
    });
    afterAll(async () => {
      await database.schema.dropSchemaIfExists(schema, true);
      await database.destroy();
    });
    it('rejects another project or superseded query and never regresses a terminal result', async () => {
      const outcome = {
        questionsStatus: Status.FINISHED,
        questions: [],
        questionsError: null,
      };
      expect(
        await repository.updateRecommendationQuestions(
          projectId + 1,
          'new-query',
          outcome,
        ),
      ).toBeNull();
      expect(
        await repository.updateRecommendationQuestions(
          projectId,
          'old-query',
          outcome,
        ),
      ).toBeNull();
      const accepted = await repository.updateRecommendationQuestions(
        projectId,
        'new-query',
        outcome,
      );
      expect(accepted.questionsStatus).toBe(Status.FINISHED);
      expect(
        await repository.updateRecommendationQuestions(projectId, 'new-query', {
          ...outcome,
          questionsStatus: Status.GENERATING,
        }),
      ).toBeNull();
      expect(
        (await repository.findOneBy({ id: projectId })).questionsStatus,
      ).toBe(Status.FINISHED);
    });
  },
);

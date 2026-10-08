import axios from 'axios';
import { randomUUID } from 'crypto';
import { WrenAIAdaptor } from '../wrenAIAdaptor';
import {
  RecommendationQuestionsInput,
  RecommendationQuestionStatus,
  ChartType,
} from '@server/models/adaptor';
import { Manifest } from '../../mdl/type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const sampleManifest: Manifest = {
  models: [
    {
      name: 'model1',
      columns: [
        {
          name: 'column1',
          type: 'string',
          isCalculated: false,
        },
      ],
    },
  ],
};

describe('WrenAIAdaptor', () => {
  const baseEndpoint = 'http://test-endpoint';
  let adaptor: WrenAIAdaptor;

  beforeEach(() => {
    adaptor = new WrenAIAdaptor({ wrenAIBaseEndpoint: baseEndpoint });
    jest.clearAllMocks();
  });

  it('preserves disclosed native data in both original chart HTTP consumers', async () => {
    const data = { columns: [{ name: 'value', type: 'int' }], data: [[7]] };
    mockedAxios.post
      .mockResolvedValueOnce({ data: { query_id: 'original-chart-task' } })
      .mockResolvedValueOnce({ data: { query_id: 'original-chart-task' } });
    expect(
      await adaptor.generateChart({
        query: 'original',
        sql: 'original SQL',
        data,
      }),
    ).toEqual({ queryId: 'original-chart-task' });
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      `${baseEndpoint}/v1/charts`,
      {
        query: 'original',
        sql: 'original SQL',
        data,
        native_task_id: undefined,
      },
    );
    await adaptor.adjustChart({
      query: 'original',
      sql: 'original SQL',
      data,
      chartSchema: { mark: 'bar' },
      adjustmentOption: { chartType: ChartType.LINE, xAxis: 'value' },
    });
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      `${baseEndpoint}/v1/chart-adjustments`,
      expect.objectContaining({
        query: 'original',
        sql: 'original SQL',
        data,
        chart_schema: { mark: 'bar' },
        adjustment_option: expect.objectContaining({
          chart_type: 'line',
          x_axis: 'value',
        }),
      }),
    );
  });

  it.each(['answer', 'chart', 'adjustment'])(
    'sends the already persisted native task ID to the original %s create',
    async (kind) => {
      const queryId = randomUUID();
      mockedAxios.post.mockResolvedValueOnce({ data: { query_id: queryId } });
      const input = { queryId, query: 'original', sql: 'original SQL' };
      const response =
        kind === 'answer'
          ? await adaptor.createTextBasedAnswer({
              ...input,
              sqlData: { columns: [], data: [] },
            })
          : kind === 'chart'
            ? await adaptor.generateChart({
                ...input,
                data: { columns: [], data: [] },
              })
            : await adaptor.adjustChart({
                ...input,
                chartSchema: { mark: 'line' },
                adjustmentOption: { chartType: ChartType.LINE },
              });
      expect(response).toEqual({ queryId });
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({
        native_task_id: queryId,
      });
      expect(mockedAxios.post.mock.calls[0][1]).not.toHaveProperty('queryId');
    },
  );

  describe('deployment terminal evidence', () => {
    const hash = 'manifest-fixture';
    const executionId = 'native-log-fixture';

    it('sends the persisted attempt and accepts only its terminal response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: hash, execution_id: executionId },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: 'finished', execution_id: executionId },
      });
      expect(
        await adaptor.deploy({ manifest: sampleManifest, hash, executionId }),
      ).toEqual({ status: 'SUCCESS' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/semantics-preparations`,
        {
          mdl: JSON.stringify(sampleManifest),
          id: hash,
          execution_id: executionId,
        },
      );
    });

    it('does not turn a dispatch disconnect or foreign acknowledgement into failure or success', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('connection closed'));
      expect(
        await adaptor.deploy({ manifest: sampleManifest, hash, executionId }),
      ).toEqual({ status: 'IN_PROGRESS' });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: hash, execution_id: 'previous-log' },
      });
      expect(
        await adaptor.deploy({ manifest: sampleManifest, hash, executionId }),
      ).toEqual({ status: 'IN_PROGRESS' });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('keeps missing, foreign, expired, malformed and unknown states unresolved', async () => {
      for (const data of [
        { status: 'finished' },
        { status: 'failed', execution_id: 'old-log' },
        { status: 'indexing', execution_id: executionId },
        { status: 'future', execution_id: executionId },
        { status: 200, execution_id: executionId },
        {
          status: 'finished',
          execution_id: executionId,
          error: { message: 'contradiction' },
        },
      ]) {
        mockedAxios.get.mockResolvedValueOnce({ data });
        expect(await adaptor.observeDeploy(hash, executionId)).toEqual({
          status: 'IN_PROGRESS',
        });
      }
      mockedAxios.get.mockRejectedValueOnce({ response: { status: 404 } });
      expect(await adaptor.observeDeploy(hash, executionId)).toEqual({
        status: 'IN_PROGRESS',
      });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('retains pending after the original bounded polling window', async () => {
      const timer = jest
        .spyOn(global, 'setTimeout')
        .mockImplementation((callback) => {
          callback();
          return undefined;
        });
      try {
        mockedAxios.post.mockResolvedValueOnce({
          data: { id: hash, execution_id: executionId },
        });
        mockedAxios.get.mockResolvedValue({
          data: { status: 'indexing', execution_id: executionId },
        });
        expect(
          await adaptor.deploy({ manifest: sampleManifest, hash, executionId }),
        ).toEqual({ status: 'IN_PROGRESS' });
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      } finally {
        timer.mockRestore();
      }
    });

    it('accepts actual failed indexing only for the same attempt', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          status: 'failed',
          execution_id: executionId,
          error: { code: 'OTHERS', message: 'indexing failed' },
        },
      });
      expect(await adaptor.observeDeploy(hash, executionId)).toEqual({
        status: 'FAILED',
        error: 'indexing failed',
      });
    });
  });

  describe('generateRecommendationQuestions', () => {
    const mockInput: RecommendationQuestionsInput = {
      manifest: sampleManifest,
      previousQuestions: ['What is sales by region?'],
      projectId: 'project-123',
      maxQuestions: 5,
      maxCategories: 3,
      configuration: {
        language: 'English',
      },
    };

    it('should successfully generate recommendation questions', async () => {
      const mockQueryId = 'query-123';
      mockedAxios.post.mockResolvedValueOnce({ data: { id: mockQueryId } });

      const result = await adaptor.generateRecommendationQuestions(mockInput);

      expect(result).toEqual({ queryId: mockQueryId });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations`,
        {
          mdl: JSON.stringify(mockInput.manifest),
          previous_questions: mockInput.previousQuestions,
          project_id: mockInput.projectId,
          max_questions: mockInput.maxQuestions,
          max_categories: mockInput.maxCategories,
          configuration: mockInput.configuration,
        },
      );
    });

    it('should handle errors when generating recommendation questions', async () => {
      const errorMessage = 'Network error';
      mockedAxios.post.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.generateRecommendationQuestions(mockInput),
      ).rejects.toThrow(errorMessage);
    });
    it('preserves the native project recommendation regeneration option', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'original-recommendation' },
      });
      await adaptor.generateRecommendationQuestions({
        ...mockInput,
        regenerate: true,
      });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations`,
        expect.objectContaining({
          project_id: mockInput.projectId,
          regenerate: true,
        }),
      );
    });
  });

  describe('getRecommendationQuestionsResult', () => {
    const queryId = 'query-123';

    it('should successfully get recommendation questions result', async () => {
      const mockResponse = {
        id: queryId,
        status: 'finished',
        response: {
          questions: [
            {
              question: 'What is the total revenue?',
              explanation: 'This shows overall business performance',
              category: 'Revenue',
            },
          ],
        },
      };

      mockedAxios.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await adaptor.getRecommendationQuestionsResult(queryId);

      expect(result).toEqual({
        ...mockResponse,
        status: RecommendationQuestionStatus.FINISHED,
        error: null,
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations/${queryId}`,
      );
    });

    it('does not finalize absent, foreign, expired, unknown or contradictory evidence', async () => {
      for (const data of [
        { status: 'finished', response: { questions: [] } },
        {
          id: 'another-query',
          status: 'finished',
          response: { questions: [] },
        },
        { id: queryId, status: 'future', response: { questions: [] } },
        {
          id: queryId,
          status: 'failed',
          error: { code: 'RESOURCE_NOT_FOUND' },
        },
        { id: queryId, status: 'failed' },
        {
          id: queryId,
          status: 'finished',
          response: { questions: [] },
          error: { code: 'OTHERS' },
        },
      ]) {
        mockedAxios.get.mockResolvedValueOnce({ data });
        await expect(
          adaptor.getRecommendationQuestionsResult(queryId),
        ).rejects.toThrow('Recommendation result evidence unavailable');
      }
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('retains a verified native failure rather than claiming cache absence is failure', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          id: queryId,
          status: 'failed',
          error: { code: 'OTHERS', message: 'native pipeline failed' },
        },
      });
      expect(
        (await adaptor.getRecommendationQuestionsResult(queryId)).status,
      ).toBe(RecommendationQuestionStatus.FAILED);
    });

    it('should handle errors when getting recommendation questions result', async () => {
      const errorMessage = 'Network error';
      mockedAxios.get.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.getRecommendationQuestionsResult(queryId),
      ).rejects.toThrow(errorMessage);
    });
  });
});

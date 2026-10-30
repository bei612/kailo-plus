import { NextApiRequest, NextApiResponse } from 'next';
import { createInterface } from 'readline';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  MAX_WAIT_TIME,
  isAskResultFinished,
  validateSummaryResult,
  transformHistoryInput,
} from '@/apollo/server/utils/apiUtils';
import {
  AskResult,
  WrenAILanguage,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  AskResultType,
  generalCompletion,
  WrenAIError,
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';
import { governedRestAsk } from '@server/services/nativeRestAsk';
import { isGovernedQueryMode } from '@server/services/nativeQueryMode';
import { withDataSource } from '@server/utils/dataSourceScope';

const logger = getLogger('API_ASK');
logger.level = 'debug';

const {
  apiHistoryRepository,
  projectService,
  deployService,
  wrenAIAdaptor,
  queryService,
} = components;

interface AskRequest {
  question: string;
  sampleSize?: number;
  language?: string;
  threadId?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isGovernedQueryMode()) {
    await governedRestAsk(req, res, false);
    return;
  }
  const { question, sampleSize, language, threadId } = req.body as AskRequest;
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // Input validation
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    // Get current project's last deployment
    const lastDeploy = await deployService.getLastDeployment(project.id);
    if (!lastDeploy) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Get conversation history if threadId is provided
    const histories = threadId
      ? await apiHistoryRepository.findAllBy({ threadId })
      : undefined;

    // Step 1: Generate SQL
    const askTask = await wrenAIAdaptor.ask({
      projectId: project.id,
      query: question,
      deployId: lastDeploy.hash,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language:
          language || WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    });

    // Poll for the SQL generation result
    const deadline = Date.now() + MAX_WAIT_TIME;
    let askResult: AskResult;
    while (true) {
      askResult = await wrenAIAdaptor.getAskResult(askTask.queryId);
      if (isAskResultFinished(askResult)) {
        break;
      }

      if (Date.now() > deadline) {
        throw new ApiError(
          'Timeout waiting for SQL generation',
          500,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }

    // Validate the AI result
    // Check for error in result
    if (askResult.error) {
      const errorMessage =
        (askResult.error as WrenAIError).message || 'Unknown error';
      const additionalData: Record<string, any> = {};

      // Include invalid SQL if available
      if (askResult.invalidSql) {
        additionalData.invalidSql = askResult.invalidSql;
      }

      throw new ApiError(
        errorMessage,
        400,
        askResult.error?.code || Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
        additionalData,
      );
    }

    // Check for general type response (explanation streaming)
    if (askResult.type === AskResultType.GENERAL) {
      const authorize = async () => {
        const currentProject = await projectService.getCurrentProject();
        if (isGovernedQueryMode() || currentProject.id !== project.id)
          throw new ApiError(
            'Original explanation observation unavailable',
            503,
          );
      };
      let explanation = generalCompletion(askResult, askTask.queryId);
      if (explanation === undefined) {
        const stream = await wrenAIAdaptor.getAskStreamingResult(
          askTask.queryId,
        );
        const close = () => stream.destroy();
        res.once('close', close);
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (!line) continue;
            await authorize();
            if (!line.startsWith('data:'))
              throw new ApiError(
                'Original explanation observation unavailable',
                503,
              );
            const event = JSON.parse(line.slice(5).trim());
            if (
              Object.keys(event).sort().join(',') === 'done,queryId' &&
              event.done === true &&
              event.queryId === askTask.queryId
            )
              break;
            if (
              Object.keys(event).join(',') !== 'message' ||
              typeof event.message !== 'string'
            )
              throw new ApiError(
                'Original explanation observation unavailable',
                503,
              );
          }
          explanation = generalCompletion(
            await wrenAIAdaptor.getAskResult(askTask.queryId),
            askTask.queryId,
          );
        } finally {
          lines.close();
          res.off('close', close);
          stream.destroy();
        }
      }
      await authorize();
      if (explanation === undefined)
        throw new ApiError('Original explanation completion unavailable', 503);

      // Return the explanation result
      await respondWith({
        res,
        statusCode: 200,
        responsePayload: {
          type: 'NON_SQL_QUERY',
          explanation,
          threadId: newThreadId,
        },
        projectId: project.id,
        apiType: ApiType.ASK,
        startTime,
        requestPayload: req.body,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
        beforeResponse: authorize,
      });
      return;
    }

    // Get the generated SQL
    const sql = askResult.response?.[0]?.sql;
    if (!sql) {
      throw new ApiError('No SQL generated', 400);
    }

    // Step 2: Execute SQL to get data
    let sqlData;
    try {
      const queryResult = await queryService.preview(sql, {
        project,
        limit: sampleSize || 500,
        manifest: lastDeploy.manifest,
        modelingOnly: false,
      });
      sqlData = queryResult;
    } catch (queryError) {
      throw new ApiError(
        queryError.message || 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    // Step 3: Generate summary using text-based answer
    const textBasedAnswerInput: TextBasedAnswerInput = {
      query: question,
      sql,
      sqlData,
      threadId: newThreadId,
      configurations: {
        language:
          language || WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };

    // Start the summary generation task
    const summaryTask =
      await wrenAIAdaptor.createTextBasedAnswer(textBasedAnswerInput);

    if (!summaryTask || !summaryTask.queryId) {
      throw new ApiError('Failed to start summary generation task', 500);
    }

    // Poll for the summary result
    let summaryResult: TextBasedAnswerResult;
    while (true) {
      summaryResult = await wrenAIAdaptor.getTextBasedAnswerResult(
        summaryTask.queryId,
      );
      if (
        summaryResult.status === TextBasedAnswerStatus.SUCCEEDED ||
        summaryResult.status === TextBasedAnswerStatus.FAILED
      ) {
        break;
      }

      if (Date.now() > deadline) {
        throw new ApiError(
          'Timeout waiting for summary generation',
          500,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }

    // Validate the summary result
    validateSummaryResult(summaryResult);

    // Step 4: Stream the content to get the summary
    let summary = '';
    if (summaryResult.status === TextBasedAnswerStatus.SUCCEEDED) {
      const stream = await wrenAIAdaptor.streamTextBasedAnswer(
        summaryTask.queryId,
      );

      // Collect the streamed content
      const streamPromise = new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          const chunkString = chunk.toString('utf-8');
          const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
          if (match && match[1]) {
            summary += match[1];
          }
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (error) => {
          reject(error);
        });

        // Handle client disconnect
        res.on('close', () => {
          stream.destroy();
          reject(new Error('Client disconnected'));
        });
      });

      await streamPromise;
      const completed = await wrenAIAdaptor.getTextBasedAnswerResult(
        summaryTask.queryId,
      );
      const currentProject = await projectService.getCurrentProject();
      if (
        isGovernedQueryMode() ||
        currentProject.id !== project.id ||
        completed?.status !== TextBasedAnswerStatus.SUCCEEDED ||
        completed.error ||
        completed.completion?.queryId !== summaryTask.queryId ||
        typeof completed.completion.content !== 'string'
      ) {
        throw new ApiError('Original summary completion unavailable', 503);
      }
      summary = completed.completion.content;
    }

    // Return the combined result
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        sql,
        summary,
        threadId: newThreadId,
      },
      projectId: project.id,
      apiType: ApiType.ASK,
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      beforeResponse: async () => {
        const currentProject = await projectService.getCurrentProject();
        if (isGovernedQueryMode() || currentProject.id !== project.id)
          throw new ApiError('Original summary observation unavailable', 503);
      },
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.ASK,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

// DD-169(2)①: the request names its data source (header or query parameter).
export default withDataSource(handler);

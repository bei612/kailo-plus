import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import { createInterface } from 'node:readline';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  MAX_WAIT_TIME,
  validateSummaryResult,
} from '@/apollo/server/utils/apiUtils';
import {
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  WrenAILanguage,
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';
import {
  digest,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import { NativeQueryService } from '@server/services/nativeQueryService';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';
import { queryReceiptState } from '@/utils/queryReceipt';

const logger = getLogger('API_GENERATE_SUMMARY');
logger.level = 'debug';

const { projectService, wrenAIAdaptor, deployService, queryService } =
  components;

interface GenerateSummaryRequest {
  question: string;
  sql: string;
  sampleSize?: number;
  language?: string;
  threadId?: string;
}

async function governedSummary(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const startTime = Date.now();
  try {
    if (req.method !== 'POST')
      throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
    const {
      question,
      sql,
      sampleSize = 500,
      language,
      threadId,
    } = req.body ?? {};
    const key = req.headers['idempotency-key'];
    const token = req.headers['x-kailo-native-human-token'];
    const identityScope = req.headers['x-kailo-native-identity-scope'];
    if (
      typeof token !== 'string' ||
      !token ||
      typeof identityScope !== 'string'
    )
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (
      typeof key !== 'string' ||
      typeof question !== 'string' ||
      !question.trim() ||
      typeof sql !== 'string' ||
      (language !== undefined && (typeof language !== 'string' || !language)) ||
      (threadId !== undefined && typeof threadId !== 'string')
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const config = await loadQueryDelivery();
    const scope = nativePreviewScope(config, identityScope);
    const project = await components.projectService.getCurrentProject();
    if (project.id !== config.projectId)
      throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
    const history = components.apiHistoryRepository;
    const native = new NativeHumanQuery(
      config,
      new NativeQueryService(
        config,
        components.projectRepository,
        components.deployLogRepository,
        history,
        components.queryService,
        components.viewRepository,
        components.modelRepository,
        components.modelColumnRepository,
      ),
      history,
    );
    const originalThreadId = threadId || key;
    const receipt = await native.previewSql(
      token,
      key,
      sql,
      sampleSize,
      scope,
      false,
      originalThreadId,
    );
    const queryState = queryReceiptState(receipt);
    if (!queryState.valid)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const pending = () =>
      res.status(202).json({
        id: key,
        threadId: originalThreadId,
        queryReceipt: receipt,
      });
    if (!queryState.completed) {
      res.status(queryState.denied ? 403 : queryState.ended ? 409 : 202).json({
        id: key,
        threadId: originalThreadId,
        queryReceipt: receipt,
      });
      return;
    }
    const selection = JSON.parse(receipt.inputReference.nativeObjectRef);
    const query = await history.findOneBy({
      id: selection.historyId,
      apiType: ApiType.RUN_SQL,
      projectId: config.projectId,
      governanceBindingId: config.bindingId,
      governanceKey: key,
      governanceState: 'SUCCEEDED',
    });
    if (!query || query.id === key)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const visible = await native.readHistory(token, query);
    const originalLanguage =
      language || WrenAILanguage[project.language] || WrenAILanguage.EN;
    const prepared = await history.prepareNativeGeneration({
      id: key,
      projectId: config.projectId,
      apiType: ApiType.GENERATE_SUMMARY,
      threadId: originalThreadId,
      governanceBindingId: config.bindingId,
      statusCode: 202,
      durationMs: 0,
      headers: {},
      requestPayload: {
        question,
        sql,
        sampleSize,
        language: originalLanguage,
        threadId: originalThreadId,
        nativeSummary: {
          taskId: key,
          queryReference: {
            historyId: query.id,
            key: query.governanceKey,
            actionExecutionId: query.governanceActionExecutionId,
            operationId: query.governanceOperationId,
            parameterHash: query.governanceParameterHash,
            requestHash: digest(query.requestPayload),
            resultHash: digest(query.responsePayload),
          },
        },
      },
      responsePayload: { threadId: originalThreadId },
    });
    if (!prepared) throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    let current = prepared.record;
    if (current.statusCode === 200) {
      const result = await native.readHistory(token, current);
      res.status(200).json({ id: current.id, ...result.responsePayload });
      return;
    }
    if (current.statusCode === 409) {
      // Only an actual native FAILED result can have persisted this status.
      res.status(409).json({
        id: key,
        threadId: originalThreadId,
        error: 'SUMMARY_GENERATION_FAILED',
      });
      return;
    }
    if (current.statusCode !== 202)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    if (prepared.created) {
      // This is the sole original history INSERT winner. A missing ACK never
      // authorizes POST again; both this request and re-entry observe fixed ID.
      await native.readHistory(token, query);
      try {
        const task = await components.wrenAIAdaptor.createTextBasedAnswer({
          queryId: key,
          query: question,
          sql,
          sqlData: visible.responsePayload,
          threadId: originalThreadId,
          configurations: { language: originalLanguage },
        });
        if (task?.queryId !== key) {
          pending();
          return;
        }
      } catch {
        // The provider may already have scheduled the original task.
      }
    }
    let result: TextBasedAnswerResult;
    try {
      result = await components.wrenAIAdaptor.getTextBasedAnswerResult(key);
    } catch {
      // 404/cache loss and a transport error are not proof of native failure.
      pending();
      return;
    }
    await native.readHistory(token, query);
    if (result.status === TextBasedAnswerStatus.FAILED) {
      current = await history.advanceNativeGeneration(
        current,
        { threadId: originalThreadId, error: 'SUMMARY_GENERATION_FAILED' },
        409,
        Date.now() - startTime,
      );
      if (!current) {
        pending();
        return;
      }
      res.status(409).json({
        id: key,
        threadId: originalThreadId,
        error: 'SUMMARY_GENERATION_FAILED',
      });
      return;
    }
    if (result.status !== TextBasedAnswerStatus.SUCCEEDED) {
      pending();
      return;
    }
    // Native SUCCEEDED means preprocessing, not finished text. The original
    // Python stream is a consuming queue: only one CAS winner may open it.
    if (Object.hasOwn(current.responsePayload ?? {}, 'summary')) {
      pending();
      return;
    }
    current = await history.advanceNativeGeneration(
      current,
      { threadId: originalThreadId, summary: '' },
      202,
      Date.now() - startTime,
    );
    if (!current) {
      pending();
      return;
    }
    let stream: Awaited<
      ReturnType<typeof components.wrenAIAdaptor.streamTextBasedAnswer>
    >;
    try {
      stream = await components.wrenAIAdaptor.streamTextBasedAnswer(key);
    } catch {
      pending();
      return;
    }
    const close = () => stream.destroy();
    const deadline = setTimeout(close, MAX_WAIT_TIME);
    res.once('close', close);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let summary = '';
    let done = false;
    try {
      for await (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event: any;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        }
        await native.readHistory(token, query);
        if (event?.done === true && event.queryId === key) {
          const completed = await history.advanceNativeGeneration(
            current,
            {
              summary,
              threadId: originalThreadId,
              nativeSummary: { doneQueryId: key },
            },
            200,
            Date.now() - startTime,
          );
          if (!completed)
            throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
          current = completed;
          done = true;
          break;
        }
        if (typeof event?.message !== 'string' || event.done !== undefined)
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        summary += event.message;
        const updated = await history.advanceNativeGeneration(
          current,
          { summary, threadId: originalThreadId },
          202,
          Date.now() - startTime,
        );
        if (!updated)
          throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
        current = updated;
      }
    } catch (error) {
      if (error instanceof NativeQueryRefusal) throw error;
      // A closed stream cannot prove either provider completion or failure.
    } finally {
      clearTimeout(deadline);
      res.off('close', close);
      lines.close();
      stream.destroy();
    }
    if (!done) {
      pending();
      return;
    }
    const disclosed = await native.readHistory(token, current);
    res.status(200).json({ id: key, ...disclosed.responsePayload });
  } catch (error) {
    res.status(error instanceof NativeQueryRefusal ? error.status : 503).json({
      error:
        error instanceof NativeQueryRefusal
          ? error.code
          : 'QUERY_EVIDENCE_UNAVAILABLE',
    });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
    await governedSummary(req, res);
    return;
  }
  const { question, sql, sampleSize, language, threadId } =
    req.body as GenerateSummaryRequest;
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

    if (!sql) {
      throw new ApiError('SQL is required', 400);
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

    // Get the data from the SQL
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

    // Create text-based answer input for summary generation
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
    const task =
      await wrenAIAdaptor.createTextBasedAnswer(textBasedAnswerInput);

    if (!task || !task.queryId) {
      throw new ApiError('Failed to start summary generation task', 500);
    }

    // Poll for the result
    const deadline = Date.now() + MAX_WAIT_TIME;
    let result: TextBasedAnswerResult;
    while (true) {
      result = await wrenAIAdaptor.getTextBasedAnswerResult(task.queryId);
      if (
        result.status === TextBasedAnswerStatus.SUCCEEDED ||
        result.status === TextBasedAnswerStatus.FAILED
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
    validateSummaryResult(result);

    // Stream the content to get the summary
    let summary = '';
    if (result.status === TextBasedAnswerStatus.SUCCEEDED) {
      const stream = await wrenAIAdaptor.streamTextBasedAnswer(task.queryId);

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
        req.on('close', () => {
          stream.destroy();
          reject(new Error('Client disconnected'));
        });
      });

      await streamPromise;
    }

    // Return the summary with ID and threadId
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        summary,
        threadId: newThreadId,
      },
      projectId: project.id,
      apiType: ApiType.GENERATE_SUMMARY,
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.GENERATE_SUMMARY,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

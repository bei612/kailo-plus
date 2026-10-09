import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { ApiType, ApiHistory } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@server/utils/error';
import { components } from '@/common';
import {
  AskResult,
  AskResultStatus,
  AskResultType,
  WrenAIError,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '@/apollo/server/models/adaptor';

const { apiHistoryRepository } = components;

// The original REST CRUD and original GraphQL controls consume the same native
// row/history/task, including after an ACK loss. No REST-only SQL validation or
// second response history is allowed to bypass that binding's HUMAN chain.
export async function handleNativeSqlPairRequest(
  req: NextApiRequest,
  res: NextApiResponse,
  id?: string | string[],
) {
  res.setHeader('Cache-Control', 'private, no-store');
  const { loadQueryDelivery, NativeQueryRefusal } = await import(
    '../services/nativeQueryAdmission'
  );
  try {
    const { nativePreviewScope, authorizeNativeScope } = await import(
      '../services/nativeHumanQuery'
    );
    const { queryReceiptState } = await import('@/utils/queryReceipt');
    const { SqlPairResolver } = await import('../resolvers/sqlPairResolver');
    const { NativeHumanQuery } = await import('../services/nativeHumanQuery');
    const { NativeQueryService } = await import(
      '../services/nativeQueryService'
    );
    const resolver = new SqlPairResolver();
    const token = req.headers['x-kailo-native-human-token'];
    const identityScope = req.headers['x-kailo-native-identity-scope'];
    const key = req.headers['idempotency-key'];
    if (
      typeof token !== 'string' ||
      !token ||
      typeof identityScope !== 'string'
    )
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const config = await loadQueryDelivery();
    const scope = nativePreviewScope(config, identityScope);
    if (
      Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') >
      config.requestMaxBytes
    )
      throw new NativeQueryRefusal(413, 'INVALID_QUERY_PARAMETERS');
    const ctx = {
      ...components,
      deployRepository: components.deployLogRepository,
      nativeHumanToken: token,
      nativeIdentityScope: identityScope,
    } satisfies import('../resolvers/sqlPairResolver').SqlPairContext;
    await authorizeNativeScope(
      config,
      token,
      req.method === 'GET' ? 'discover' : 'manage',
    );
    if (req.method === 'GET' && id === undefined) {
      res
        .status(200)
        .json(await resolver.getProjectSqlPairs(undefined, {}, ctx));
      return;
    }
    if (
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const nativeId = typeof id === 'string' ? Number(id) : undefined;
    const sql = req.body?.sql;
    const question = req.body?.question;
    if (
      (id !== undefined &&
        (!Number.isSafeInteger(nativeId) || nativeId <= 0)) ||
      (sql !== undefined && (typeof sql !== 'string' || !sql.trim())) ||
      (question !== undefined &&
        (typeof question !== 'string' || !question.trim()))
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    if (
      (req.method === 'POST' && id === undefined) ||
      (req.method === 'PUT' && nativeId)
    ) {
      if (
        req.method === 'POST' &&
        (typeof sql !== 'string' || typeof question !== 'string')
      )
        throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
      if (sql !== undefined) {
        const receipt = await new NativeHumanQuery(
          config,
          new NativeQueryService(
            config,
            ctx.projectRepository,
            ctx.deployRepository,
            components.apiHistoryRepository,
            ctx.queryService,
            ctx.viewRepository,
            ctx.modelRepository,
            ctx.modelColumnRepository,
          ),
          components.apiHistoryRepository,
        ).previewSql(token, key, sql, 1, scope, true);
        if (
          !queryReceiptState(receipt).completed ||
          receipt.data?.valid !== true
        ) {
          res.status(202).json({ queryReceipt: receipt });
          return;
        }
      }
      const data = {
        sql,
        question,
        idempotencyKey: key,
        idempotencyScope: scope,
      };
      const pair =
        req.method === 'POST'
          ? await resolver.createSqlPair(undefined, { data }, ctx)
          : await resolver.updateSqlPair(
              undefined,
              { where: { id: nativeId }, data },
              ctx,
            );
      res.status(req.method === 'POST' ? 201 : 200).json(pair);
      return;
    }
    if (req.method === 'DELETE' && nativeId) {
      const removed = await resolver.deleteSqlPair(
        undefined,
        { where: { id: nativeId, idempotencyKey: key } },
        ctx,
      );
      if (removed !== true)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      res.status(204).end();
      return;
    }
    throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    const evidence = error?.extensions?.other?.nativeWrite;
    if (evidence?.outcome === 'UNKNOWN') {
      res
        .status(202)
        .json({ error: 'NATIVE_EXECUTION_UNKNOWN', nativeWrite: evidence });
    } else {
      res
        .status(error instanceof NativeQueryRefusal ? error.status : 503)
        .json({
          error:
            error instanceof NativeQueryRefusal
              ? error.code
              : 'QUERY_EVIDENCE_UNAVAILABLE',
        });
    }
  }
}

export const MAX_WAIT_TIME = 1000 * 60 * 3; // 3 minutes

export const isAskResultFinished = (result: AskResult) => {
  return (
    result.status === AskResultStatus.FINISHED ||
    result.status === AskResultStatus.FAILED ||
    result.status === AskResultStatus.STOPPED ||
    result.error
  );
};

/**
 * Validates the AI result and throws appropriate errors for different failure cases
 * @param result The AI result to validate
 * @param taskQueryId The query ID of the task (used for explanation queries)
 * @throws ApiError if result contains errors or is of an invalid type
 */
export const validateAskResult = (
  result: AskResult,
  taskQueryId: string,
): void => {
  // Check for error in result
  if (result.error) {
    const errorMessage =
      (result.error as WrenAIError).message || 'Unknown error';
    const additionalData: Record<string, any> = {};

    // Include invalid SQL if available
    if (result.invalidSql) {
      additionalData.invalidSql = result.invalidSql;
    }

    throw new ApiError(errorMessage, 400, result.error.code, additionalData);
  }

  // Check for misleading query type
  if (result.type === AskResultType.MISLEADING_QUERY) {
    throw new ApiError(
      result.intentReasoning ||
        Errors.errorMessages[Errors.GeneralErrorCodes.NON_SQL_QUERY],
      400,
      Errors.GeneralErrorCodes.NON_SQL_QUERY,
    );
  }

  // Check for general type response
  if (result.type === AskResultType.GENERAL) {
    throw new ApiError(
      result.intentReasoning ||
        Errors.errorMessages[Errors.GeneralErrorCodes.NON_SQL_QUERY],
      400,
      Errors.GeneralErrorCodes.NON_SQL_QUERY,
      { explanationQueryId: taskQueryId },
    );
  }
};

/**
 * Validates the summary generation result and checks for errors
 * @param result The summary result to validate
 * @throws ApiError if the result has errors or is in a failed state
 */
export const validateSummaryResult = (result: TextBasedAnswerResult): void => {
  // Check for errors or failed status
  if (result.status === TextBasedAnswerStatus.FAILED || result.error) {
    throw new ApiError(
      result.error?.message || 'Failed to generate summary',
      400,
      Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
    );
  }

  // Verify that the status is succeeded
  if (result.status !== TextBasedAnswerStatus.SUCCEEDED) {
    throw new ApiError('Summary generation is still in progress', 500);
  }
};

export const transformHistoryInput = (histories: ApiHistory[]) => {
  if (!histories) {
    return [];
  }

  const validApiTypes = [
    ApiType.GENERATE_SQL,
    ApiType.ASK,
    ApiType.STREAM_GENERATE_SQL,
    ApiType.STREAM_ASK,
  ];

  return histories
    .filter(
      (history) =>
        validApiTypes.includes(history.apiType) &&
        history.responsePayload?.sql &&
        history.requestPayload?.question,
    )
    .map((history) => ({
      question: history.requestPayload?.question,
      sql: history.responsePayload?.sql,
    }));
};

/**
 * Validates SQL syntax and compatibility with the project's manifest.
 * Throws an ApiError if the SQL is invalid or cannot be previewed.
 * @param sql The SQL string to validate
 * @param project The project object (must have id)
 * @param deployService The deployment service instance
 * @param queryService The query service instance
 */
export const validateSql = async (
  sql: string,
  project: any,
  deployService: any,
  queryService: any,
) => {
  const lastDeployment = await deployService.getLastDeployment(project.id);
  const manifest = lastDeployment.manifest;
  try {
    await queryService.preview(sql, {
      manifest,
      project,
      dryRun: true,
    });
  } catch (err: any) {
    throw new ApiError(
      err.message || 'Invalid SQL',
      400,
      Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
    );
  }
};

/**
 * Common error class for API endpoints
 */
export class ApiError extends Error {
  statusCode: number;
  code?: Errors.GeneralErrorCodes;
  additionalData?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number,
    code?: Errors.GeneralErrorCodes,
    additionalData?: Record<string, any>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.additionalData = additionalData;
  }
}

/**
 * Common response handler for API endpoints that also logs to API history
 */
export const respondWith = async ({
  res,
  statusCode,
  responsePayload,
  projectId,
  apiType,
  threadId,
  headers,
  requestPayload,
  startTime,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  projectId: number;
  apiType: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const responseId = uuidv4();
  await apiHistoryRepository.createOne({
    id: responseId,
    projectId,
    apiType,
    threadId,
    headers,
    requestPayload,
    responsePayload,
    statusCode,
    durationMs,
  });

  return res.status(statusCode).json({
    id: responseId,
    ...responsePayload,
  });
};

/**
 * Simple response handler for API endpoints that don't need responseId or threadId
 * Used for simple CRUD operations like instructions
 */
export const respondWithSimple = async ({
  res,
  statusCode,
  responsePayload,
  projectId,
  apiType,
  headers,
  requestPayload,
  startTime,
  beforeResponse,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  projectId: number;
  apiType: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  headers?: Record<string, string>;
  beforeResponse?: () => Promise<void>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const responseId = uuidv4();
  await apiHistoryRepository.createOne({
    id: responseId,
    projectId,
    apiType,
    headers,
    requestPayload,
    responsePayload,
    statusCode,
    durationMs,
  });

  await beforeResponse?.();
  return res.status(statusCode).json(responsePayload);
};

/**
 * Common error handler for API endpoints
 */
export const handleApiError = async ({
  error,
  res,
  projectId,
  apiType,
  requestPayload,
  threadId,
  headers,
  startTime,
  logger,
}: {
  error: any;
  res: NextApiResponse;
  projectId?: number;
  apiType: ApiType;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
  startTime: number;
  logger?: any;
}) => {
  if (logger) {
    logger.error(`Error in ${apiType} API:`, error);
  }

  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  let responsePayload: Record<string, any>;

  if (error instanceof ApiError && error.code) {
    responsePayload = {
      code: error.code,
      error: error.message,
    };

    // Include any additional data associated with the error
    if (error.additionalData) {
      Object.assign(responsePayload, error.additionalData);
    }
  } else {
    responsePayload = { error: error.message };
  }

  await respondWith({
    res,
    statusCode,
    responsePayload,
    projectId: projectId || 0,
    apiType,
    startTime,
    requestPayload,
    threadId,
    headers,
  });
};

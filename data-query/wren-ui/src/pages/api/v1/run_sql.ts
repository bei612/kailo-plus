import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import { PreviewDataResponse } from '@server/services/queryService';
import {
  ApiError,
  respondWith,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { transformToObjects } from '@server/utils/dataUtils';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import { NativeQueryService } from '@server/services/nativeQueryService';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';
import { queryReceiptState } from '@/utils/queryReceipt';

const logger = getLogger('API_RUN_SQL');
logger.level = 'debug';

/**
 * Validates the SQL result and ensures it has the expected format
 * @param result The result to validate
 * @returns The validated result as PreviewDataResponse
 * @throws ApiError if the result is in an unexpected format
 */
const validateSqlResult = (result: any): PreviewDataResponse => {
  // Ensure we have a valid result with expected properties
  if (typeof result === 'boolean') {
    throw new ApiError('Unexpected query result format', 500);
  }

  return result as PreviewDataResponse;
};

interface RunSqlRequest {
  sql: string;
  threadId?: string;
  limit?: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // The original REST route is also a native query consumer. A bound instance
  // must not bypass the same HUMAN admission/history/disclosure used by the
  // original SQL preview, nor mint another key after a lost acknowledgement.
  if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (req.method !== 'POST')
        throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
      const { sql, threadId, limit = 1000 } = req.body ?? {};
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
        typeof sql !== 'string' ||
        (threadId !== undefined && typeof threadId !== 'string')
      )
        throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
      const config = await loadQueryDelivery();
      const scope = nativePreviewScope(config, identityScope);
      const project = await components.projectService.getCurrentProject();
      if (project.id !== config.projectId)
        throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
      const native = new NativeQueryService(
        config,
        components.projectRepository,
        components.deployLogRepository,
        components.apiHistoryRepository,
        components.queryService,
        components.viewRepository,
        components.modelRepository,
        components.modelColumnRepository,
      );
      const receipt = await new NativeHumanQuery(
        config,
        native,
        components.apiHistoryRepository,
      ).previewSql(token, key, sql, limit, scope, false, threadId || key);
      const state = queryReceiptState(receipt);
      const selection = JSON.parse(receipt.inputReference.nativeObjectRef);
      if (!state.valid || typeof selection.historyId !== 'string')
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      // Reuse the existing governed native row. respondWith would create
      // a second ungoverned history instead of this receipt's original row.
      const id = selection.historyId;
      const originalThreadId = threadId || key;
      if (!state.completed) {
        res.status(state.denied ? 403 : state.ended ? 409 : 202).json({
          id,
          threadId: originalThreadId,
          receipt,
        });
        return;
      }
      const result = receipt.data as PreviewDataResponse;
      res.status(200).json({
        id,
        records: transformToObjects(result.columns, result.data),
        columns: result.columns,
        threadId: originalThreadId,
        totalRows: result.data.length,
      });
    } catch (error) {
      // No raw SQL/provider/token message and no fabricated failed history:
      // Core/native evidence retains UNKNOWN for the caller's original key.
      res
        .status(error instanceof NativeQueryRefusal ? error.status : 503)
        .json({
          error:
            error instanceof NativeQueryRefusal
              ? error.code
              : 'QUERY_EVIDENCE_UNAVAILABLE',
        });
    }
    return;
  }

  // Unconfigured independent Wren retains its original standalone API. Missing
  // identity, scope or broken delivery in the bound branch never reaches here.
  const { projectService, queryService, deployService } = components;
  const { sql, threadId, limit = 1000 } = req.body as RunSqlRequest;
  const startTime = Date.now();
  let project;

  try {
    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // input validation
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    project = await projectService.getCurrentProject();

    const deployment = await deployService.getLastDeployment(project.id);

    if (!deployment) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    const manifest = deployment.manifest;

    // Execute the SQL query
    try {
      const result = await queryService.preview(sql, {
        project,
        limit,
        manifest,
        modelingOnly: false,
      });

      // Validate the SQL result
      const queryResult = validateSqlResult(result);

      // Transform data into array of objects
      const transformedData = transformToObjects(
        queryResult.columns,
        queryResult.data,
      );

      // create a new thread if it's a new query
      const newThreadId = threadId || uuidv4();

      await respondWith({
        res,
        statusCode: 200,
        responsePayload: {
          records: transformedData,
          columns: queryResult.columns,
          threadId: newThreadId,
          totalRows: queryResult.data?.length || 0,
        },
        projectId: project.id,
        apiType: ApiType.RUN_SQL,
        startTime,
        requestPayload: req.body,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
      });
    } catch (queryError) {
      logger.error('Error executing SQL:', queryError);
      throw new ApiError(
        queryError.message || 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.RUN_SQL,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

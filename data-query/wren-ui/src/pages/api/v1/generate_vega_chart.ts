import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import {
  ChartResult,
  ChartStatus,
  WrenAILanguage,
} from '@/apollo/server/models/adaptor';
import { PreviewDataResponse } from '@server/services/queryService';
import { transformToObjects } from '@server/utils/dataUtils';
import { enhanceVegaSpec } from '@/utils/vegaSpecUtils';
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

const { projectService, wrenAIAdaptor, deployService, queryService } =
  components;

const MAX_WAIT_TIME = 1000 * 60 * 3; // 3 minutes

/**
 * Validates the chart generation result and checks for errors
 * @param result The chart result to validate
 * @throws ApiError if the result has errors or is in a failed state
 */
const validateChartResult = (result: ChartResult): void => {
  // Check for errors or failed status
  if (result.status === ChartStatus.FAILED || result.error) {
    throw new ApiError(
      result.error?.message || 'Failed to generate Vega spec',
      400,
      Errors.GeneralErrorCodes.FAILED_TO_GENERATE_VEGA_SCHEMA,
    );
  }

  // Verify that the chartSchema is present
  if (!result?.response?.chartSchema) {
    throw new ApiError('Failed to generate Vega spec', 500);
  }
};

interface GenerateVegaSpecRequest {
  question: string;
  sql: string;
  threadId?: string;
  sampleSize?: number;
}

async function governedChart(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const startTime = Date.now();
  try {
    if (req.method !== 'POST')
      throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
    const { question, sql, threadId, sampleSize = 10000 } = req.body ?? {};
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
      (threadId !== undefined && typeof threadId !== 'string') ||
      !Number.isInteger(sampleSize) ||
      sampleSize <= 0 ||
      sampleSize > 1000000
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
    const state = queryReceiptState(receipt);
    if (!state.valid)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    const pending = () =>
      res
        .status(202)
        .json({ id: key, threadId: originalThreadId, queryReceipt: receipt });
    if (!state.completed) {
      res
        .status(state.denied ? 403 : state.ended ? 409 : 202)
        .json({ id: key, threadId: originalThreadId, queryReceipt: receipt });
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
    const language = WrenAILanguage[project.language] || WrenAILanguage.EN;
    const prepared = await history.prepareNativeGeneration({
      id: key,
      projectId: config.projectId,
      apiType: ApiType.GENERATE_VEGA_CHART,
      threadId: originalThreadId,
      governanceBindingId: config.bindingId,
      headers: {},
      statusCode: 202,
      durationMs: 0,
      requestPayload: {
        question,
        sql,
        sampleSize,
        threadId: originalThreadId,
        language,
        nativeChart: {
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
      const disclosed = await native.readHistory(token, current);
      res.status(200).json({ id: key, ...disclosed.responsePayload });
      return;
    }
    if (current.statusCode === 409) {
      const status = current.responsePayload?.nativeChart?.status;
      if (![ChartStatus.FAILED, ChartStatus.STOPPED].includes(status))
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      res.status(409).json({
        id: key,
        threadId: originalThreadId,
        error: current.responsePayload.error,
      });
      return;
    }
    if (current.statusCode !== 202)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    if (prepared.created) {
      await native.readHistory(token, query);
      try {
        const task = await components.wrenAIAdaptor.generateChart({
          queryId: key,
          query: question,
          sql,
          data: visible.responsePayload,
          projectId: project.id.toString(),
          configurations: { language },
        });
        if (task?.queryId !== key) {
          pending();
          return;
        }
      } catch {
        // An unacknowledged native POST may already have started this exact ID.
      }
    }
    let result: ChartResult;
    try {
      result = await components.wrenAIAdaptor.getChartResult(key);
    } catch {
      // Missing cache or transport evidence cannot admit another POST.
      pending();
      return;
    }
    await native.readHistory(token, query);
    if ([ChartStatus.FAILED, ChartStatus.STOPPED].includes(result.status)) {
      const error =
        result.status === ChartStatus.FAILED
          ? 'CHART_GENERATION_FAILED'
          : 'CHART_GENERATION_STOPPED';
      current = await history.advanceNativeGeneration(
        current,
        {
          threadId: originalThreadId,
          error,
          nativeChart: { status: result.status },
        },
        409,
        Date.now() - startTime,
      );
      if (!current) {
        pending();
        return;
      }
      res.status(409).json({ id: key, threadId: originalThreadId, error });
      return;
    }
    if (result.status !== ChartStatus.FINISHED) {
      pending();
      return;
    }
    // Reuse the original chart validation, data conversion and visual styling.
    // Supplying this already admitted data uses ChartService's native data
    // consumer instead of a second SQL execution via its SERVICE provider.
    validateChartResult(result);
    const vegaSpec = enhanceVegaSpec(
      result.response.chartSchema,
      transformToObjects(
        visible.responsePayload.columns,
        visible.responsePayload.data,
      ),
    );
    current = await history.advanceNativeGeneration(
      current,
      {
        vegaSpec,
        threadId: originalThreadId,
        nativeChart: { doneQueryId: key },
      },
      200,
      Date.now() - startTime,
    );
    if (!current) {
      // A competing observer may have finalized the same task. Re-entry reads
      // its actual stored result; this request cannot replace that snapshot.
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
    await governedChart(req, res);
    return;
  }
  const {
    question,
    sql,
    threadId,
    sampleSize = 10000,
  } = req.body as GenerateVegaSpecRequest;
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

    if (
      !Number.isInteger(sampleSize) ||
      sampleSize <= 0 ||
      sampleSize > 1000000
    ) {
      throw new ApiError('Invalid sampleSize', 400);
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

    // Execute the SQL query to get the data
    let queryResult: PreviewDataResponse;
    try {
      queryResult = (await queryService.preview(sql, {
        project,
        limit: sampleSize,
        manifest: lastDeploy.manifest,
        modelingOnly: false,
      })) as PreviewDataResponse;
    } catch (queryError) {
      throw new ApiError(
        queryError.message || 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    // Transform query results to array of objects
    const dataObjects = transformToObjects(
      queryResult.columns,
      queryResult.data,
    );

    // Ask AI service to generate a Vega spec chart
    const task = await wrenAIAdaptor.generateChart({
      query: question,
      sql,
      projectId: project.id.toString(),
      configurations: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    });

    if (!task || !task.queryId) {
      throw new ApiError('Failed to start Vega spec generation task', 500);
    }

    // Poll for the result
    const deadline = Date.now() + MAX_WAIT_TIME;
    let result: ChartResult;
    while (true) {
      result = await wrenAIAdaptor.getChartResult(task.queryId);
      if (
        result.status === ChartStatus.FINISHED ||
        result.status === ChartStatus.FAILED
      ) {
        break;
      }

      if (Date.now() > deadline) {
        throw new ApiError(
          'Timeout waiting for Vega spec generation',
          500,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }

    // Validate the chart result
    validateChartResult(result);

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Get the generated Vega spec
    const vegaSpec = result?.response?.chartSchema;

    // Enhance the Vega spec with styling and configuration
    const enhancedVegaSpec = enhanceVegaSpec(vegaSpec, dataObjects);

    // Return the Vega spec with data included
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        vegaSpec: enhancedVegaSpec,
        threadId: newThreadId,
      },
      projectId: project.id,
      apiType: ApiType.GENERATE_VEGA_CHART,
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
      apiType: ApiType.GENERATE_VEGA_CHART,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
    });
  }
}

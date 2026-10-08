import { NextApiRequest, NextApiResponse } from 'next';
import { StringDecoder } from 'string_decoder';
import { components } from '@/common';
import { ApiHistory, ApiType } from '../repositories/apiHistoryRepository';
import { ModelResolver } from '../resolvers/modelResolver';
import { DataSourceName, IContext } from '../types';
import {
  AskResultStatus,
  AskResultType,
  TextBasedAnswerStatus,
  WrenAILanguage,
} from '../models/adaptor';
import {
  ApiError,
  MAX_WAIT_TIME,
  transformHistoryInput,
  validateAskResult,
} from '../utils/apiUtils';
import {
  ContentBlockContentType,
  EventType,
  StateType,
  endStream,
  getSqlGenerationState,
  sendError,
  sendMessageStart,
  sendSSEEvent,
  sendStateUpdate,
} from '../utils';
import { DEFAULT_PREVIEW_LIMIT } from './queryService';
import {
  canonical,
  digest,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';
import {
  NativeHumanQuery,
  authorizeNativeScope,
  nativePreviewScope,
} from './nativeHumanQuery';
import { NativeQueryService } from './nativeQueryService';
import { queryReceiptState } from '@/utils/queryReceipt';

type MetadataContext = Pick<
  IContext,
  | 'projectService'
  | 'deployRepository'
  | 'nativeIdentityScope'
  | 'nativeHumanToken'
>;
const unavailable = () =>
  new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');

// This is the original MDL read consumer, including its captured native IDs and
// fresh Resource checks. A retrieved table name is never an authorization fact.
async function metadata(
  ctx: MetadataContext,
  reference: {
    hash: string;
    digest: string;
    queryScope?: string;
    generation?: number;
  },
) {
  const current = await new ModelResolver().getMDL(
    undefined,
    {
      hash: reference.hash,
      queryScope: reference.queryScope,
      generation: reference.generation,
    },
    ctx,
  );
  if (digest(current) !== reference.digest) throw unavailable();
}

export async function readNativeAskHistory(
  ctx: MetadataContext,
  config: NativeQueryDelivery,
  native: NativeHumanQuery,
  selected: ApiHistory,
  visited = new Set<string>(),
) {
  nativePreviewScope(config, ctx.nativeIdentityScope);
  const proof = selected.requestPayload?.nativeAsk;
  const result = selected.responsePayload?.nativeAsk;
  const sqlOnly = [ApiType.GENERATE_SQL, ApiType.STREAM_GENERATE_SQL].includes(
    selected.apiType,
  );
  if (
    !ctx.nativeHumanToken ||
    ![
      ApiType.ASK,
      ApiType.STREAM_ASK,
      ApiType.GENERATE_SQL,
      ApiType.STREAM_GENERATE_SQL,
    ].includes(selected.apiType) ||
    selected.projectId !== config.projectId ||
    selected.governanceBindingId !== config.bindingId ||
    selected.statusCode !== 200 ||
    !selected.id ||
    visited.has(selected.id) ||
    proof?.taskId !== selected.id ||
    proof.identityScope !== ctx.nativeIdentityScope ||
    (!sqlOnly && result?.doneQueryId !== selected.id) ||
    selected.responsePayload.threadId !== selected.threadId ||
    typeof proof?.metadataReference?.hash !== 'string' ||
    typeof proof.metadataReference.digest !== 'string'
  )
    throw unavailable();
  visited.add(selected.id);
  if (
    sqlOnly &&
    (proof.metadataReference.queryScope !==
      nativePreviewScope(config, ctx.nativeIdentityScope) ||
      !Number.isSafeInteger(proof.metadataReference.generation) ||
      proof.metadataReference.generation <= 0 ||
      result?.askResult?.status !== AskResultStatus.FINISHED ||
      result.askResult.type !== AskResultType.TEXT_TO_SQL ||
      result.askResult.error ||
      typeof result.askResult.response?.[0]?.sql !== 'string' ||
      !result.askResult.response[0].sql.trim() ||
      typeof selected.responsePayload.sql !== 'string' ||
      (selected.requestPayload.returnSqlDialect &&
        (!Object.prototype.hasOwnProperty.call(result, 'nativeSql') ||
          (result.nativeSql !== null &&
            typeof result.nativeSql !== 'string'))) ||
      (selected.requestPayload.returnSqlDialect
        ? (result.nativeSql || result.askResult.response[0].sql) !==
          selected.responsePayload.sql
        : result.askResult.response[0].sql !== selected.responsePayload.sql))
  )
    throw unavailable();
  await metadata(ctx, proof.metadataReference);
  if (!Array.isArray(proof.histories)) throw unavailable();
  for (const source of proof.histories) {
    const previous = await components.apiHistoryRepository.findOneBy({
      id: source.id,
      projectId: config.projectId,
      governanceBindingId: config.bindingId,
      threadId: selected.threadId,
      statusCode: 200,
    });
    if (
      !previous ||
      previous.id === selected.id ||
      digest(previous.requestPayload) !== source.requestHash ||
      digest(previous.responsePayload) !== source.resultHash
    )
      throw unavailable();
    if (
      [
        ApiType.ASK,
        ApiType.STREAM_ASK,
        ApiType.GENERATE_SQL,
        ApiType.STREAM_GENERATE_SQL,
      ].includes(previous.apiType)
    )
      await readNativeAskHistory(
        ctx,
        config,
        native,
        previous,
        new Set(visited),
      );
    else await native.readHistory(ctx.nativeHumanToken, previous);
  }
  if (sqlOnly) {
    // FINISHED belongs to the same persisted ask task; SQL generation does not
    // execute a database query or manufacture a query Action/summary task.
    if (result.queryReference || result.summaryStarted || result.streamClaimed)
      throw unavailable();
  } else if (selected.responsePayload.type === 'NON_SQL_QUERY') {
    if (
      typeof selected.responsePayload.explanation !== 'string' ||
      result.queryReference
    )
      throw unavailable();
  } else {
    const source = result.queryReference;
    if (
      typeof selected.responsePayload.sql !== 'string' ||
      typeof selected.responsePayload.summary !== 'string' ||
      source?.key !== selected.id
    )
      throw unavailable();
    const query = await components.apiHistoryRepository.findOneBy({
      id: source.historyId,
      apiType: ApiType.RUN_SQL,
      projectId: config.projectId,
      governanceBindingId: config.bindingId,
      governanceKey: source.key,
      governanceActionExecutionId: source.actionExecutionId,
      governanceOperationId: source.operationId,
      governanceParameterHash: source.parameterHash,
      governanceState: 'SUCCEEDED',
    });
    if (
      !query ||
      query.governanceDeploymentHash !== proof.metadataReference.hash ||
      query.requestPayload?.action !== 'data_query.query@v1' ||
      query.requestPayload.sql !== selected.responsePayload.sql ||
      query.requestPayload.limit !== selected.requestPayload.sampleSize ||
      query.threadId !== selected.threadId ||
      digest(query.requestPayload) !== source.requestHash ||
      digest(query.responsePayload) !== source.resultHash
    )
      throw unavailable();
    await native.readHistory(ctx.nativeHumanToken, query);
  }
  const current = await components.apiHistoryRepository.findOneBy({
    id: selected.id,
    apiType: selected.apiType,
    projectId: config.projectId,
    governanceBindingId: config.bindingId,
  });
  if (
    !current ||
    current.statusCode !== 200 ||
    current.threadId !== selected.threadId ||
    canonical(current.requestPayload) !== canonical(selected.requestPayload) ||
    canonical(current.responsePayload) !== canonical(selected.responsePayload)
  )
    throw unavailable();
  if (sqlOnly) await metadata(ctx, proof.metadataReference);
  const { nativeAsk: _requestProof, ...requestPayload } =
    current.requestPayload;
  const { nativeAsk: _resultProof, ...responsePayload } =
    current.responsePayload;
  return { requestPayload, responsePayload };
}

// The two original REST surfaces share only this governed execution consumer.
// Their standalone handlers, native SSE events and success payloads remain.
export async function governedRestAsk(
  req: NextApiRequest,
  res: NextApiResponse,
  streaming: boolean,
  sqlOnly = false,
) {
  const started = Date.now();
  res.setHeader('Cache-Control', 'private, no-store');
  let streamStarted = false;
  let currentState = StateType.SQL_GENERATION_START;
  const block = (type: EventType, value?: string) => {
    if (!streaming || !streamStarted) return;
    sendSSEEvent(res, {
      type,
      ...(type === EventType.CONTENT_BLOCK_START
        ? { content_block: { type: 'text', name: value } }
        : {}),
      ...(type === EventType.CONTENT_BLOCK_DELTA
        ? { delta: { type: 'text_delta', text: value } }
        : {}),
      timestamp: Date.now(),
    } as Parameters<typeof sendSSEEvent>[1]);
  };
  const state = (value: StateType, data?: Record<string, unknown>) => {
    currentState = value;
    if (streaming && streamStarted) sendStateUpdate(res, value, data);
  };
  const respond = (status: number, payload: Record<string, unknown>) => {
    if (!streamStarted) {
      res.status(status).json(payload);
      return;
    }
    if (status === 200) {
      endStream(res, String(payload.threadId), started);
    } else {
      // A closed pending/error transport is not the original message_stop
      // success event. The caller retains its exact key and observes again.
      if (status === 202)
        state(currentState, { ...payload, httpStatus: status });
      else
        sendError(
          res,
          String(payload.error ?? 'QUERY_EVIDENCE_UNAVAILABLE'),
          undefined,
          { ...payload, httpStatus: status },
        );
      res.end();
    }
  };
  try {
    if (req.method !== 'POST')
      throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
    const {
      question,
      sampleSize: requestedSampleSize = DEFAULT_PREVIEW_LIMIT,
      language,
      threadId,
    } = req.body ?? {};
    const sampleSize = sqlOnly ? DEFAULT_PREVIEW_LIMIT : requestedSampleSize;
    const returnSqlDialect =
      sqlOnly && !streaming ? req.body?.returnSqlDialect ?? false : false;
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
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      ) ||
      typeof question !== 'string' ||
      !question.trim() ||
      !Number.isSafeInteger(sampleSize) ||
      sampleSize <= 0 ||
      (language !== undefined && typeof language !== 'string') ||
      (threadId !== undefined && typeof threadId !== 'string') ||
      (sqlOnly && typeof returnSqlDialect !== 'boolean')
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const config = await loadQueryDelivery();
    if (
      Buffer.byteLength(JSON.stringify(req.body), 'utf8') >
      config.requestMaxBytes
    )
      throw new NativeQueryRefusal(413, 'INVALID_QUERY_PARAMETERS');
    const scope = nativePreviewScope(config, identityScope);
    const ctx: MetadataContext = {
      projectService: components.projectService,
      deployRepository: components.deployLogRepository,
      nativeHumanToken: token,
      nativeIdentityScope: identityScope,
    };
    const project = await components.projectService.getCurrentProject();
    if (project.id !== config.projectId)
      throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
    const native = new NativeHumanQuery(
      config,
      new NativeQueryService(
        config,
        components.projectRepository,
        components.deployLogRepository,
        components.apiHistoryRepository,
        components.queryService,
        components.viewRepository,
        components.modelRepository,
        components.modelColumnRepository,
      ),
      components.apiHistoryRepository,
    );
    const history = components.apiHistoryRepository;
    const apiType = sqlOnly
      ? streaming
        ? ApiType.STREAM_GENERATE_SQL
        : ApiType.GENERATE_SQL
      : streaming
        ? ApiType.STREAM_ASK
        : ApiType.ASK;
    const existing = await history.findOneBy({ id: key });
    const originalThreadId = threadId || key;
    const originalLanguage =
      language || WrenAILanguage[project.language] || WrenAILanguage.EN;
    if (
      existing &&
      (existing.apiType !== apiType ||
        existing.projectId !== project.id ||
        existing.governanceBindingId !== config.bindingId ||
        existing.threadId !== originalThreadId ||
        existing.requestPayload?.question !== question ||
        (sqlOnly
          ? existing.requestPayload.returnSqlDialect !== returnSqlDialect
          : existing.requestPayload.sampleSize !== sampleSize) ||
        existing.requestPayload.language !== originalLanguage ||
        existing.requestPayload.nativeAsk?.identityScope !== identityScope)
    )
      throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    const deploy = existing
      ? await components.deployLogRepository.findOneBy({
          hash: existing.requestPayload.nativeAsk.metadataReference.hash,
          projectId: project.id,
        })
      : await components.deployService.getLastDeployment(project.id);
    if (!deploy) throw unavailable();
    const mdl = await new ModelResolver().getMDL(
      undefined,
      { hash: deploy.hash },
      ctx,
    );
    const metadataReference = existing?.requestPayload.nativeAsk
      .metadataReference ?? {
      hash: deploy.hash,
      digest: digest(mdl),
      ...(sqlOnly
        ? {
            queryScope: scope,
            generation: (await authorizeNativeScope(config, token, 'discover'))
              .generation,
          }
        : {}),
    };
    await metadata(ctx, metadataReference);
    const histories =
      existing?.requestPayload.nativeAsk.histories ??
      (threadId
        ? (
            await history.findAllBy({
              threadId,
              projectId: project.id,
              governanceBindingId: config.bindingId,
            })
          )
            .filter(
              (item) =>
                item.id !== key &&
                item.statusCode === 200 &&
                transformHistoryInput([item]).length === 1,
            )
            .map((item) => ({
              id: item.id,
              requestHash: digest(item.requestPayload),
              resultHash: digest(item.responsePayload),
            }))
        : []);
    const visibleHistories = [];
    const authorize = async () => {
      await metadata(ctx, metadataReference);
      visibleHistories.length = 0;
      for (const source of histories) {
        const previous = await history.findOneBy({
          id: source.id,
          projectId: project.id,
          governanceBindingId: config.bindingId,
          threadId: originalThreadId,
          statusCode: 200,
        });
        if (
          !previous ||
          previous.id === key ||
          digest(previous.requestPayload) !== source.requestHash ||
          digest(previous.responsePayload) !== source.resultHash
        )
          throw unavailable();
        const visible = [
          ApiType.ASK,
          ApiType.STREAM_ASK,
          ApiType.GENERATE_SQL,
          ApiType.STREAM_GENERATE_SQL,
        ].includes(previous.apiType)
          ? await readNativeAskHistory(ctx, config, native, previous)
          : await native.readHistory(token, previous);
        visibleHistories.push({ ...previous, ...visible });
      }
    };
    await authorize();
    const prepared = await history.prepareNativeGeneration({
      id: key,
      projectId: project.id,
      apiType,
      governanceBindingId: config.bindingId,
      threadId: originalThreadId,
      headers: {},
      statusCode: 202,
      durationMs: 0,
      requestPayload: {
        question,
        ...(sqlOnly ? { returnSqlDialect } : { sampleSize }),
        language: originalLanguage,
        threadId: originalThreadId,
        nativeAsk: { taskId: key, identityScope, metadataReference, histories },
      },
      responsePayload: { threadId: originalThreadId, nativeAsk: {} },
    });
    if (!prepared) throw new NativeQueryRefusal(409, 'QUERY_INTENT_CONFLICT');
    let current = prepared.record;
    const pending = (queryReceipt?: unknown) =>
      respond(202, {
        id: key,
        threadId: originalThreadId,
        ...(queryReceipt ? { queryReceipt } : {}),
      });
    if (current.statusCode === 200) {
      const visible = await readNativeAskHistory(ctx, config, native, current);
      if (streaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.flushHeaders();
        streamStarted = true;
        sendMessageStart(res);
        if (sqlOnly)
          state(StateType.SQL_GENERATION_SUCCESS, {
            sql: visible.responsePayload.sql,
          });
        else {
          block(
            EventType.CONTENT_BLOCK_START,
            visible.responsePayload.type === 'NON_SQL_QUERY'
              ? ContentBlockContentType.EXPLANATION
              : ContentBlockContentType.SUMMARY_GENERATION,
          );
          block(
            EventType.CONTENT_BLOCK_DELTA,
            visible.responsePayload.explanation ??
              visible.responsePayload.summary,
          );
          block(EventType.CONTENT_BLOCK_STOP);
        }
      }
      respond(200, { id: key, ...visible.responsePayload });
      return;
    }
    if (current.statusCode === 409) {
      const proof = current.responsePayload.nativeAsk;
      if (
        !(
          [AskResultStatus.FAILED, AskResultStatus.STOPPED].includes(
            proof?.status,
          ) || proof?.summaryStatus === TextBasedAnswerStatus.FAILED
        )
      )
        throw unavailable();
      respond(409, {
        id: key,
        threadId: originalThreadId,
        error: current.responsePayload.error,
      });
      return;
    }
    if (current.statusCode !== 202 && !(sqlOnly && current.statusCode === 400))
      throw unavailable();
    if (streaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      streamStarted = true;
      sendMessageStart(res);
    }
    state(StateType.SQL_GENERATION_START, {
      question,
      threadId: originalThreadId,
      language: originalLanguage,
    });
    if (prepared.created) {
      await authorize();
      try {
        const task = await components.wrenAIAdaptor.ask({
          queryId: key,
          query: question,
          deployId: deploy.hash,
          histories: transformHistoryInput(visibleHistories) as any,
          configurations: { language: originalLanguage },
        });
        if (task?.queryId !== key) {
          pending();
          return;
        }
      } catch {
        /* The original fixed task can exist despite a lost ACK. */
      }
    }
    const advance = async (payload: Record<string, unknown>, status = 202) => {
      if (
        Buffer.byteLength(JSON.stringify(payload), 'utf8') >
        config.responseMaxBytes
      )
        throw unavailable();
      const changed = await history.advanceNativeGeneration(
        current,
        payload,
        status,
        Date.now() - started,
      );
      if (!changed) return false;
      current = changed;
      return true;
    };
    let askResult = current.responsePayload.nativeAsk.askResult;
    if (!askResult) {
      const deadline = Date.now() + MAX_WAIT_TIME;
      let previousStatus: AskResultStatus;
      for (;;) {
        try {
          askResult = await components.wrenAIAdaptor.getAskResult(key);
        } catch {
          pending();
          return;
        }
        await authorize();
        if (
          !askResult ||
          !Object.values(AskResultStatus).includes(askResult.status)
        ) {
          pending();
          return;
        }
        if (
          askResult.status !== previousStatus &&
          !(
            sqlOnly &&
            [
              AskResultStatus.FINISHED,
              AskResultStatus.FAILED,
              AskResultStatus.STOPPED,
            ].includes(askResult.status)
          )
        ) {
          state(getSqlGenerationState(askResult.status), {
            rephrasedQuestion: askResult.rephrasedQuestion,
            intentReasoning: askResult.intentReasoning,
            sqlGenerationReasoning: askResult.sqlGenerationReasoning,
            retrievedTables: askResult.retrievedTables,
            traceId: askResult.traceId,
            invalidSql: askResult.invalidSql,
          });
          previousStatus = askResult.status;
        }
        if (
          [AskResultStatus.FAILED, AskResultStatus.STOPPED].includes(
            askResult.status,
          )
        ) {
          if (
            !(await advance(
              {
                threadId: originalThreadId,
                error:
                  askResult.status === AskResultStatus.FAILED
                    ? 'ASK_GENERATION_FAILED'
                    : 'ASK_GENERATION_STOPPED',
                nativeAsk: { status: askResult.status },
              },
              409,
            ))
          ) {
            pending();
            return;
          }
          respond(409, {
            id: key,
            threadId: originalThreadId,
            error: current.responsePayload.error,
          });
          return;
        }
        if (
          askResult.status === AskResultStatus.FINISHED ||
          (!sqlOnly && askResult.type === AskResultType.GENERAL)
        )
          break;
        if (Date.now() > deadline) {
          pending();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (
        askResult.error ||
        ![
          AskResultType.GENERAL,
          AskResultType.TEXT_TO_SQL,
          ...(sqlOnly ? [AskResultType.MISLEADING_QUERY] : []),
        ].includes(askResult.type)
      )
        throw unavailable();
      if (
        !(await advance({
          ...current.responsePayload,
          nativeAsk: { ...current.responsePayload.nativeAsk, askResult },
        }))
      ) {
        pending();
        return;
      }
    }
    if (sqlOnly) {
      try {
        validateAskResult(askResult, key);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          askResult.status !== AskResultStatus.FINISHED ||
          ![AskResultType.GENERAL, AskResultType.MISLEADING_QUERY].includes(
            askResult.type,
          ) ||
          askResult.error
        )
          throw unavailable();
        const payload = {
          threadId: originalThreadId,
          code: error.code,
          error: error.message,
          ...error.additionalData,
          nativeAsk: current.responsePayload.nativeAsk,
        };
        if (current.statusCode === 202) {
          if (!(await advance(payload, error.statusCode))) {
            pending();
            return;
          }
        } else if (
          current.statusCode !== error.statusCode ||
          canonical(current.responsePayload) !== canonical(payload)
        )
          throw unavailable();
        await authorize();
        const { nativeAsk: _proof, ...visible } = payload;
        respond(error.statusCode, { id: key, ...visible });
        return;
      }
      let sql = askResult.response?.[0]?.sql;
      if (
        askResult.status !== AskResultStatus.FINISHED ||
        askResult.type !== AskResultType.TEXT_TO_SQL ||
        askResult.error ||
        typeof sql !== 'string' ||
        !sql.trim()
      )
        throw unavailable();
      await authorize();
      let nativeSql: string | null = null;
      if (returnSqlDialect) {
        const converted =
          project.type === DataSourceName.DUCKDB
            ? await components.wrenEngineAdaptor.getNativeSQL(sql, {
                manifest: deploy.manifest,
                modelingOnly: false,
              })
            : await components.ibisAdaptor.getNativeSql({
                dataSource: project.type,
                sql,
                mdl: deploy.manifest,
              });
        if (converted != null && typeof converted !== 'string')
          throw unavailable();
        nativeSql = converted ?? null;
        // Preserve the original empty-converter fallback, recording its actual
        // output separately instead of claiming the generated SQL was converted.
        sql = nativeSql || sql;
        if (typeof sql !== 'string' || !sql.trim()) throw unavailable();
        await authorize();
      }
      if (
        !(await advance(
          {
            sql,
            threadId: originalThreadId,
            nativeAsk: {
              ...current.responsePayload.nativeAsk,
              ...(returnSqlDialect ? { nativeSql } : {}),
            },
          },
          200,
        ))
      ) {
        pending();
        return;
      }
      const visible = await readNativeAskHistory(ctx, config, native, current);
      if (streaming)
        state(StateType.SQL_GENERATION_SUCCESS, {
          sql: visible.responsePayload.sql,
        });
      respond(200, { id: key, ...visible.responsePayload });
      return;
    }
    const general = askResult.type === AskResultType.GENERAL;
    let query: ApiHistory;
    let disclosedData: Record<string, unknown>;
    if (!general) {
      const sql = askResult.response?.[0]?.sql;
      if (typeof sql !== 'string' || !sql.trim()) throw unavailable();
      state(StateType.SQL_GENERATION_SUCCESS, { sql });
      state(StateType.SQL_EXECUTION_START, { sql });
      const receipt = await native.previewSql(
        token,
        key,
        sql,
        sampleSize,
        scope,
        false,
        originalThreadId,
        metadataReference.hash,
      );
      const queryState = queryReceiptState(receipt);
      if (!queryState.valid) throw unavailable();
      if (!queryState.completed) {
        respond(queryState.denied ? 403 : queryState.ended ? 409 : 202, {
          id: key,
          threadId: originalThreadId,
          queryReceipt: receipt,
        });
        return;
      }
      const selection = JSON.parse(receipt.inputReference.nativeObjectRef);
      query = await history.findOneBy({
        id: selection.historyId,
        apiType: ApiType.RUN_SQL,
        projectId: config.projectId,
        governanceBindingId: config.bindingId,
        governanceKey: key,
        governanceState: 'SUCCEEDED',
      });
      if (!query || query.id === key) throw unavailable();
      disclosedData = (await native.readHistory(token, query)).responsePayload;
      const queryReference = {
        historyId: query.id,
        key: query.governanceKey,
        actionExecutionId: query.governanceActionExecutionId,
        operationId: query.governanceOperationId,
        parameterHash: query.governanceParameterHash,
        requestHash: digest(query.requestPayload),
        resultHash: digest(query.responsePayload),
      };
      if (
        current.responsePayload.nativeAsk.queryReference &&
        canonical(current.responsePayload.nativeAsk.queryReference) !==
          canonical(queryReference)
      )
        throw unavailable();
      if (!current.responsePayload.nativeAsk.summaryStarted) {
        if (
          !(await advance({
            ...current.responsePayload,
            sql,
            nativeAsk: {
              ...current.responsePayload.nativeAsk,
              queryReference,
              summaryStarted: true,
            },
          }))
        ) {
          pending();
          return;
        }
        await authorize();
        await native.readHistory(token, query);
        try {
          const task = await components.wrenAIAdaptor.createTextBasedAnswer({
            queryId: key,
            query: question,
            sql,
            sqlData: disclosedData as any,
            threadId: originalThreadId,
            configurations: { language: originalLanguage },
          });
          if (task?.queryId !== key) {
            pending();
            return;
          }
        } catch {
          /* GET the same task after a lost ACK. */
        }
      }
      state(StateType.SQL_EXECUTION_END);
      let summaryResult;
      try {
        summaryResult =
          await components.wrenAIAdaptor.getTextBasedAnswerResult(key);
      } catch {
        pending();
        return;
      }
      await authorize();
      await native.readHistory(token, query);
      if (summaryResult?.status === TextBasedAnswerStatus.FAILED) {
        if (
          !(await advance(
            {
              ...current.responsePayload,
              error: 'SUMMARY_GENERATION_FAILED',
              nativeAsk: {
                ...current.responsePayload.nativeAsk,
                summaryStatus: summaryResult.status,
              },
            },
            409,
          ))
        ) {
          pending();
          return;
        }
        respond(409, {
          id: key,
          threadId: originalThreadId,
          error: 'SUMMARY_GENERATION_FAILED',
        });
        return;
      }
      if (
        summaryResult?.status !== TextBasedAnswerStatus.SUCCEEDED ||
        summaryResult.error
      ) {
        pending();
        return;
      }
    }
    if (current.responsePayload.nativeAsk.streamClaimed) {
      pending();
      return;
    }
    if (
      !(await advance({
        ...current.responsePayload,
        nativeAsk: {
          ...current.responsePayload.nativeAsk,
          streamClaimed: true,
        },
        ...(general
          ? { type: 'NON_SQL_QUERY', explanation: '' }
          : { summary: '' }),
      }))
    ) {
      pending();
      return;
    }
    await authorize();
    if (query) await native.readHistory(token, query);
    const stream = general
      ? await components.wrenAIAdaptor.getAskStreamingResult(key)
      : await components.wrenAIAdaptor.streamTextBasedAnswer(key);
    const stop = () => stream.destroy();
    res.once('close', stop);
    const deadline = Date.now() + MAX_WAIT_TIME;
    const timer = setTimeout(stop, Math.max(0, deadline - Date.now()));
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    let text = '';
    block(
      EventType.CONTENT_BLOCK_START,
      general
        ? ContentBlockContentType.EXPLANATION
        : ContentBlockContentType.SUMMARY_GENERATION,
    );
    try {
      for await (const chunk of stream) {
        buffer += decoder.write(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        );
        if (Buffer.byteLength(buffer, 'utf8') > config.responseMaxBytes)
          throw unavailable();
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = message
            .split('\n')
            .find((item) => item.startsWith('data:'));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim());
          await authorize();
          if (query) await native.readHistory(token, query);
          if (event.done === true && event.queryId === key) {
            if (
              !(await advance(
                {
                  ...current.responsePayload,
                  nativeAsk: {
                    ...current.responsePayload.nativeAsk,
                    doneQueryId: key,
                  },
                  [general ? 'explanation' : 'summary']: text,
                },
                200,
              ))
            ) {
              pending();
              return;
            }
            const visible = await readNativeAskHistory(
              ctx,
              config,
              native,
              current,
            );
            block(EventType.CONTENT_BLOCK_STOP);
            respond(200, { id: key, ...visible.responsePayload });
            return;
          }
          if (typeof event.message !== 'string' || event.done !== undefined)
            throw unavailable();
          text += event.message;
          if (
            !(await advance({
              ...current.responsePayload,
              [general ? 'explanation' : 'summary']: text,
            }))
          ) {
            pending();
            return;
          }
          block(EventType.CONTENT_BLOCK_DELTA, event.message);
        }
      }
      pending();
    } finally {
      clearTimeout(timer);
      res.off('close', stop);
      stream.destroy();
    }
  } catch (error) {
    respond(error instanceof NativeQueryRefusal ? error.status : 503, {
      error:
        error instanceof NativeQueryRefusal
          ? error.code
          : 'QUERY_EVIDENCE_UNAVAILABLE',
    });
  }
}

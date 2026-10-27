import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { TextBasedAnswerStatus } from '@/apollo/server/models/adaptor';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';
import { AskingResolver } from '@/apollo/server/resolvers/askingResolver';
import { IContext } from '@/apollo/server/types';
import {
  canonical,
  NativeQueryRefusal,
} from '@/apollo/server/services/nativeQueryAdmission';
import { isGovernedQueryMode } from '@/apollo/server/services/nativeQueryMode';
import { createInterface } from 'readline';

const { wrenAIAdaptor, askingService, telemetry } = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { responseId, queryId: expectedQueryId } = req.query;
  if (
    typeof responseId !== 'string' ||
    !Number.isSafeInteger(Number(responseId)) ||
    Number(responseId) <= 0 ||
    (expectedQueryId !== undefined &&
      (typeof expectedQueryId !== 'string' || !expectedQueryId))
  ) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }
  const bound = isGovernedQueryMode();
  try {
    const response = await askingService.getResponse(Number(responseId));
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // check response status
    if (
      response.answerDetail?.status !== ThreadResponseAnswerStatus.STREAMING
    ) {
      throw new Error(
        `Thread response ${responseId} is not in streaming status`,
      );
    }

    const queryId = response.answerDetail?.queryId;
    if (expectedQueryId !== undefined && expectedQueryId !== queryId)
      throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    if (!queryId) {
      throw new Error(`Thread response ${responseId} does not have queryId`);
    }

    const context = {
      ...components,
      deployRepository: components.deployLogRepository,
      nativeHumanToken: req.headers['x-kailo-native-human-token'],
      nativeIdentityScope: req.headers['x-kailo-native-identity-scope'],
    } as unknown as IContext;
    const authorize = async () => {
      // The nested reader selects its mode again after asynchronous work.
      // Retiring a delivery must not turn this governed stream into an
      // independent read, nor may a standalone stream outlive its mode.
      if (isGovernedQueryMode() !== bound)
        throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
      // queryId correlates this observation; original project/native ACL and
      // governed source admission remain authoritative, including legacy calls
      // without the optional browser correlation parameter.
      const current = await askingService.getResponse(Number(responseId));
      if (
        !current ||
        current.threadId !== response.threadId ||
        current.question !== response.question ||
        current.sql !== response.sql ||
        canonical(current.answerDetail) !== canonical(response.answerDetail)
      )
        throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
      if (bound)
        await new AskingResolver().authorizeNativeAnswerDetail(response, context, bound);
      if (isGovernedQueryMode() !== bound)
        throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
    };
    await authorize();
    const readCompletion = async () => {
      let observed;
      try { observed = await wrenAIAdaptor.getTextBasedAnswerResult(queryId); }
      catch { /* Unavailable result remains unknown. */ }
      await authorize();
      return observed?.status === TextBasedAnswerStatus.SUCCEEDED && !observed.error &&
        observed?.completion?.queryId === queryId &&
        typeof observed.completion.content === 'string' ? observed.completion : undefined;
    };
    const persistCompletion = async (content: string) => {
      const finished = await components.threadResponseRepository.claimNativeAnswer(response, {
        ...response.answerDetail, status: ThreadResponseAnswerStatus.FINISHED, content,
      });
      if (!finished) throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
    };
    const cached = await readCompletion();
    if (cached) {
      await persistCompletion(cached.content);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.write(`data: ${JSON.stringify({ message: cached.content })}\n\n`);
      res.end(`data: ${JSON.stringify({ done: true })}\n\n`);
      return;
    }
    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);
    let closed = false;
    let completed = false;
    let content = '';
    // IncomingMessage may already be complete before the async row reads.
    // The response close event owns this live SSE transport.
    res.on('close', () => {
      closed = true;
      stream.destroy();
      if (!bound && !completed)
        void authorize()
          .then(() =>
            components.threadResponseRepository.claimNativeAnswer(response, {
              ...response.answerDetail,
              status: ThreadResponseAnswerStatus.INTERRUPTED,
              content,
            }),
          )
          .catch((error) => console.error(error));
    });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        if (closed) return;
        if (!line) continue;
        if (!line.startsWith('data: '))
          throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
        const event = JSON.parse(line.slice('data: '.length));
        // Reuse the original same-AE history reader at each result exposure;
        // changed identities, native SQL, roles or Resource grants stop it.
        await authorize();
        if (closed) return;
        if (
          Object.keys(event).sort().join(',') === 'done,queryId' &&
          event.done === true &&
          event.queryId === queryId
        ) {
          const complete = await readCompletion();
          if (!complete) throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
          await persistCompletion(complete.content);
          completed = true;
          if (!complete.content.startsWith(content)) {
            // The native one-shot queue may have supplied only a tail. History
            // now owns the complete answer; never label this partial stream done.
            res.end();
            return;
          }
          const remainder = complete.content.slice(content.length);
          if (remainder) res.write(`data: ${JSON.stringify({ message: remainder })}\n\n`);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
          telemetry?.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION, {
            question: response.question,
          });
          return;
        }
        if (
          Object.keys(event).join(',') !== 'message' ||
          typeof event.message !== 'string'
        )
          throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
        content += event.message;
        res.write(`${line}\n\n`);
      }
      // Queue EOF is not terminal evidence. The original read-only result can
      // independently recover full content without consuming or resubmitting.
      const complete = await readCompletion();
      if (complete) {
        await persistCompletion(complete.content);
        completed = true;
      }
      res.end();
    } finally {
      stream.destroy();
    }
    return;
  } catch (error) {
    console.error(error);
    if (!res.headersSent)
      res.status(error instanceof NativeQueryRefusal ? error.status : 500);
    res.end();
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';
import { AskingResolver } from '@/apollo/server/resolvers/askingResolver';
import { IContext } from '@/apollo/server/types';
import { NativeQueryRefusal } from '@/apollo/server/services/nativeQueryAdmission';
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

  const { responseId } = req.query;
  if (
    typeof responseId !== 'string' ||
    !Number.isSafeInteger(Number(responseId)) ||
    Number(responseId) <= 0
  ) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }
  const bound = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
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
      if (bound)
        await new AskingResolver()
          .getThreadResponseNestedResolver()
          .answerDetail(response, {}, context);
    };
    await authorize();
    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);
    let closed = false;
    let completed = false;
    let content = '';
    req.on('close', () => {
      closed = true;
      stream.destroy();
      if (!bound && !completed)
        void askingService
          .changeThreadResponseAnswerDetailStatus(
            Number(responseId),
            ThreadResponseAnswerStatus.INTERRUPTED,
            content,
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
        if (event.done === true && event.queryId === queryId) {
          if (bound) {
            const finished =
              await components.threadResponseRepository.claimNativeAnswer(
                response,
                {
                  ...response.answerDetail,
                  status: ThreadResponseAnswerStatus.FINISHED,
                  content,
                },
              );
            if (!finished)
              throw new NativeQueryRefusal(409, 'NATIVE_OBJECT_CHANGED');
          } else {
            await askingService.changeThreadResponseAnswerDetailStatus(
              Number(responseId),
              ThreadResponseAnswerStatus.FINISHED,
              content,
            );
          }
          completed = true;
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
      // HTTP close without the original generator's completion receipt
      // remains indeterminate. It never produces a fake FINISHED/done.
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

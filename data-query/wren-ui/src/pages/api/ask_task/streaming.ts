import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { AskingResolver } from '@/apollo/server/resolvers/askingResolver';
import type { IContext } from '@/apollo/server/types';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@/apollo/server/services/nativeQueryAdmission';
import { MAX_WAIT_TIME } from '@/apollo/server/utils/apiUtils';
import { createInterface } from 'readline';

const { wrenAIAdaptor } = components;

// Both original planning surfaces expose the same native message/done stream.
// Their existing task/history reader remains the ownership/evidence authority.
export async function streamNativeAskingTask(
  req: NextApiRequest,
  res: NextApiResponse,
  authorize: () => Promise<unknown>,
) {
  res.setHeader('Cache-Control', 'private, no-store');
  let stream;
  let timer: NodeJS.Timeout;
  let stop: () => void;
  try {
    if (req.method !== 'GET')
      throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
    const queryId = req.query.queryId;
    if (typeof queryId !== 'string' || !queryId)
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const config = await loadQueryDelivery();
    await authorize();
    stream = await components.wrenAIAdaptor.getAskStreamingResult(queryId);
    stop = () => stream.destroy();
    res.once('close', stop);
    timer = setTimeout(stop, MAX_WAIT_TIME);
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    let bytes = 0;
    for await (const line of createInterface({
      input: stream,
      crlfDelay: Infinity,
    })) {
      if (!line) continue;
      bytes += Buffer.byteLength(line, 'utf8');
      if (bytes > config.responseMaxBytes)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      if (!line.startsWith('data:'))
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      const event = JSON.parse(line.slice(5).trim());
      await authorize();
      if (res.destroyed) return;
      if (event.done === true && event.queryId === queryId) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }
      if (
        Object.keys(event).join(',') !== 'message' ||
        typeof event.message !== 'string'
      )
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      res.write(`${line}\n\n`);
    }
    // Native EOF, queue/cache loss or timeout is never completion evidence.
    res.end();
  } catch (error) {
    if (!res.headersSent)
      res.status(error instanceof NativeQueryRefusal ? error.status : 503);
    res.end();
  } finally {
    if (timer) clearTimeout(timer);
    if (stop) res.off('close', stop);
    stream?.destroy();
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
    process.env.WREN_PLATFORM_BINDING_CONFIG_FILE !== undefined
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      if (
        !process.env.WREN_PLATFORM_QUERY_CONFIG_FILE?.startsWith('/') ||
        !process.env.WREN_PLATFORM_BINDING_CONFIG_FILE?.startsWith('/')
      )
        throw new NativeQueryRefusal(503, 'QUERY_ADMISSION_UNAVAILABLE');
      if (req.method !== 'GET')
        throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
      const queryId = req.query.queryId;
      if (typeof queryId !== 'string' || !queryId)
        throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
      const context = {
        ...components,
        deployRepository: components.deployLogRepository,
        nativeHumanToken: req.headers['x-kailo-native-human-token'],
        nativeIdentityScope: req.headers['x-kailo-native-identity-scope'],
      } as unknown as IContext;
      const resolver = new AskingResolver();
      const authorize = () =>
        resolver.authorizeNativeAskingTask(queryId, context);
      await authorize();
      if (!(await components.askingService.getAskingTask(queryId)))
        throw new NativeQueryRefusal(404, 'NATIVE_OBJECT_UNAVAILABLE');
      await streamNativeAskingTask(req, res, authorize);
    } catch (error) {
      if (!res.headersSent)
        res.status(error instanceof NativeQueryRefusal ? error.status : 503);
      res.end();
    }
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { queryId } = req.query;
  try {
    const stream = await wrenAIAdaptor.getAskStreamingResult(queryId as string);

    stream.on('data', (chunk) => {
      // pass the chunk directly to the client
      res.write(chunk);
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    // destroy the stream if the client closes the connection
    req.on('close', () => {
      stream.destroy();
    });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}

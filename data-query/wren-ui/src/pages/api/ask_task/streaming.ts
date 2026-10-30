import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { AskingResolver } from '@/apollo/server/resolvers/askingResolver';
import type { IContext } from '@/apollo/server/types';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@/apollo/server/services/nativeQueryAdmission';
import { isGovernedQueryMode } from '@/apollo/server/services/nativeQueryMode';
import { MAX_WAIT_TIME } from '@/apollo/server/utils/apiUtils';
import { createInterface } from 'readline';
import {
  AskResultType,
  generalCompletion,
} from '@/apollo/server/models/adaptor';
import { withDataSource } from '@server/utils/dataSourceScope';

// Both original planning surfaces expose the same native message/done stream.
// Their existing task/history reader remains the ownership/evidence authority.
async function forwardNativeAskingTask(
  req: NextApiRequest,
  res: NextApiResponse,
  authorize: () => Promise<unknown>,
  governed: boolean,
) {
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  let stream;
  let timer: NodeJS.Timeout;
  let stop: () => void;
  try {
    if (req.method !== 'GET')
      throw new NativeQueryRefusal(405, 'METHOD_NOT_ALLOWED');
    const queryId = req.query.queryId;
    if (typeof queryId !== 'string' || !queryId)
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const responseMaxBytes = governed
      ? (await loadQueryDelivery()).responseMaxBytes
      : undefined;
    await authorize();
    const original = await components.wrenAIAdaptor.getAskResult(queryId);
    await authorize();
    let emitted = '';
    const cached = generalCompletion(original, queryId);
    if (cached !== undefined) {
      if (
        responseMaxBytes !== undefined &&
        Buffer.byteLength(JSON.stringify({ message: cached }), 'utf8') >
          responseMaxBytes
      )
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ message: cached })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }
    const finish = async (nativeDone: boolean) => {
      const result = await components.wrenAIAdaptor.getAskResult(queryId);
      await authorize();
      if (res.destroyed) return;
      if (
        original.type === AskResultType.GENERAL ||
        result.type === AskResultType.GENERAL
      ) {
        const complete = generalCompletion(result, queryId);
        if (complete === undefined || !complete.startsWith(emitted)) return;
        if (
          responseMaxBytes !== undefined &&
          Buffer.byteLength(JSON.stringify({ message: complete }), 'utf8') >
            responseMaxBytes
        )
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        const remainder = complete.slice(emitted.length);
        if (remainder)
          res.write(`data: ${JSON.stringify({ message: remainder })}\n\n`);
      } else if (!nativeDone || result.type !== AskResultType.TEXT_TO_SQL) {
        return;
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    };
    stream = await components.wrenAIAdaptor.getAskStreamingResult(queryId);
    stop = () => stream.destroy();
    res.once('close', stop);
    // Preserve each deployment mode's existing stream lifetime; only the
    // governed path has the platform polling budget.
    if (governed) timer = setTimeout(stop, MAX_WAIT_TIME);
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    let bytes = 0;
    for await (const line of createInterface({
      input: stream,
      crlfDelay: Infinity,
    })) {
      if (!line) continue;
      bytes += Buffer.byteLength(line, 'utf8');
      if (responseMaxBytes !== undefined && bytes > responseMaxBytes)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      if (!line.startsWith('data:'))
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      const event = JSON.parse(line.slice(5).trim());
      if (!event || typeof event !== 'object' || Array.isArray(event))
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      await authorize();
      if (res.destroyed) return;
      if (
        Object.keys(event).length === 2 &&
        event.done === true &&
        event.queryId === queryId
      ) {
        await finish(true);
        res.end();
        return;
      }
      if (
        Object.keys(event).join(',') !== 'message' ||
        typeof event.message !== 'string'
      )
        throw new NativeQueryRefusal(503, 'NATIVE_EXECUTION_UNKNOWN');
      emitted += event.message;
      res.write(`${line}\n\n`);
    }
    // Only an independently retained full GENERAL result can recover an EOF.
    if (original.type === AskResultType.GENERAL) await finish(false);
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

export async function streamNativeAskingTask(
  req: NextApiRequest,
  res: NextApiResponse,
  authorize: () => Promise<unknown>,
) {
  return forwardNativeAskingTask(req, res, authorize, true);
}

export async function streamStandaloneAskingTask(
  req: NextApiRequest,
  res: NextApiResponse,
  authorize: () => Promise<unknown>,
) {
  return forwardNativeAskingTask(req, res, authorize, false);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isGovernedQueryMode()) {
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
      const authorize = async () => {
        // A stream admitted under governance cannot become standalone while
        // its original asynchronous task/source checks are in flight.
        if (!isGovernedQueryMode())
          throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
        const current = await resolver.authorizeNativeAskingTask(
          queryId,
          context,
        );
        if (!isGovernedQueryMode())
          throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
        return current;
      };
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
  // Standalone uses the same actual native completion receipt, without
  // selecting platform governance from a browser token or loading its delivery.
  // The original project/task reader remains the native ownership boundary.
  const authorize = async () => {
    if (isGovernedQueryMode())
      throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
    if (
      !(await components.askingService.getAskingTask(
        req.query.queryId as string,
      ))
    )
      throw new NativeQueryRefusal(404, 'NATIVE_OBJECT_UNAVAILABLE');
    if (isGovernedQueryMode())
      throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
  };
  await forwardNativeAskingTask(req, res, authorize, false);
}

// DD-169(2)①: the request names its data source (header or query parameter).
export default withDataSource(handler);

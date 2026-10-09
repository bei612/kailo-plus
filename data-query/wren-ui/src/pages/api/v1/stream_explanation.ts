import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { streamNativeAskingTask } from '../ask_task/streaming';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';
import { NativeQueryService } from '@server/services/nativeQueryService';
import { readNativeAskHistory } from '@server/services/nativeRestAsk';

const { wrenAIAdaptor } = components;

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
      const token = req.headers['x-kailo-native-human-token'];
      const identityScope = req.headers['x-kailo-native-identity-scope'];
      if (
        typeof token !== 'string' ||
        !token ||
        typeof identityScope !== 'string'
      )
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      const config = await loadQueryDelivery();
      nativePreviewScope(config, identityScope);
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
      const context = {
        projectService: components.projectService,
        deployRepository: components.deployLogRepository,
        nativeHumanToken: token,
        nativeIdentityScope: identityScope,
      };
      const authorize = async () => {
        const current = await history.findOneBy({
          id: queryId,
          projectId: config.projectId,
          governanceBindingId: config.bindingId,
        });
        if (
          !current ||
          ![ApiType.GENERATE_SQL, ApiType.STREAM_GENERATE_SQL].includes(
            current.apiType,
          ) ||
          current.statusCode !== 400
        )
          throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        // Original GENERAL/MISLEADING response is owned by this same native
        // task/history. Its captured MDL and each source are freshly read.
        await readNativeAskHistory(context, config, native, current);
      };
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
  if (!queryId) {
    res.status(400).json({ error: 'queryId is required' });
    return;
  }

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
    res.status(500).json({ error: error.message });
  }
}

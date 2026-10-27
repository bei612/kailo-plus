import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  streamNativeAskingTask,
  streamStandaloneAskingTask,
} from '../ask_task/streaming';
import { ApiHistory, ApiType } from '@server/repositories/apiHistoryRepository';
import {
  loadQueryDelivery,
  canonical,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import { isGovernedQueryMode } from '@server/services/nativeQueryMode';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';
import { NativeQueryService } from '@server/services/nativeQueryService';
import { readNativeAskHistory } from '@server/services/nativeRestAsk';

import {
  requestIsNativeService,
  requestKailoUser,
} from '@server/services/kailoUserService';

const explanationScope = (history: ApiHistory) => canonical({
  id: history.id,
  projectId: history.projectId,
  apiType: history.apiType,
  ownerKey: history.ownerKey ?? null,
  requestPayload: history.requestPayload,
  responsePayload: history.responsePayload,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
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
        if (!isGovernedQueryMode())
          throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
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
        if (!isGovernedQueryMode())
          throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
      };
      await streamNativeAskingTask(req, res, authorize);
    } catch (error) {
      if (!res.headersSent)
        res.status(error instanceof NativeQueryRefusal ? error.status : 503);
      res.end();
    }
    return;
  }
  let original: { id: string; projectId: number; scope: string };
  const standaloneIdentity = async () => {
    if (isGovernedQueryMode())
      throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
    // These private headers are set only after the existing middleware verifies
    // the native issuer/audience/instance. A service is not a HUMAN owner.
    const user = requestKailoUser(req.headers);
    if (!user && !requestIsNativeService(req.headers))
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (user && components.kailoMemberDirectory) {
      const access = await components.kailoMemberDirectory.access(user.key);
      if (!access.member)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    }
    if (isGovernedQueryMode())
      throw new NativeQueryRefusal(412, 'QUERY_ADMISSION_UNAVAILABLE');
  };
  const authorize = async () => {
    await standaloneIdentity();
    const project = await components.projectService.getCurrentProject();
    if (!project || (original && project.id !== original.projectId))
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const current = original
      ? await components.apiHistoryRepository.findOneBy({
          id: original.id,
          projectId: original.projectId,
        })
      : await components.apiHistoryRepository.findStandaloneExplanation(
          project.id,
          req.query.queryId as string,
        );
    if (
      !current?.id ||
      current.projectId !== project.id ||
      current.governanceBindingId != null ||
      current.requestPayload?.nativeAsk != null ||
      ![ApiType.GENERATE_SQL, ApiType.STREAM_GENERATE_SQL].includes(current.apiType) ||
      current.statusCode !== 400 ||
      current.responsePayload?.code !== 'NON_SQL_QUERY' ||
      current.responsePayload?.explanationQueryId !== req.query.queryId ||
      (original && explanationScope(current) !== original.scope)
    )
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    if ((await components.projectService.getCurrentProject())?.id !== project.id)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    await standaloneIdentity();
    original ??= { id: current.id, projectId: project.id, scope: explanationScope(current) };
  };
  await streamStandaloneAskingTask(req, res, authorize);
}

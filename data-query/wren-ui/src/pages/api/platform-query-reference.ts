import { NextApiRequest, NextApiResponse } from 'next';
import {
  canonical,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import { NativeQueryService } from '@server/services/nativeQueryService';
import { resolveNativeResource } from '@server/services/nativeHumanQuery';

// This is intentionally NOT a machine-route middleware exemption. Both direct
// and embedded browsers need the native issuer/sub and instance access grant.
// Exact object selection additionally consumes the existing Core HUMAN check;
// exporting metadata does not execute SQL or grant a Kailo Resource permission.
export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.status(405).end();
    return;
  }
  try {
    if (
      Object.keys(request.query).sort().join(',') !== 'limit,viewId' ||
      Object.values(request.query).some((value) => typeof value !== 'string')
    ) {
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    }
    const config = await loadQueryDelivery();
    const token = request.headers['x-kailo-native-human-token'];
    if (typeof token !== 'string' || !token)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const viewId = Number(request.query.viewId);
    const limit = Number(request.query.limit);
    if (
      !Number.isSafeInteger(viewId) ||
      viewId <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const resolve = () =>
      resolveNativeResource(
        config,
        token,
        'view',
        viewId,
        'data_query.query@v1',
      );
    const resource = await resolve();
    const { components } = await import('../../common');
    const service = new NativeQueryService(
      config,
      components.projectRepository,
      components.deployLogRepository,
      components.apiHistoryRepository,
      components.queryService,
      components.viewRepository,
    );
    const reference = await service.reference(
      resource.resourceId,
      viewId,
      limit,
    );
    const after = await resolve();
    if (canonical(resource) !== canonical(after))
      throw new NativeQueryRefusal(409, 'QUERY_REFERENCE_CHANGED');
    response.status(200).json(reference);
  } catch (error) {
    response
      .status(error instanceof NativeQueryRefusal ? error.status : 503)
      .json({
        error:
          error instanceof NativeQueryRefusal
            ? error.code
            : 'QUERY_EVIDENCE_UNAVAILABLE',
      });
  }
}

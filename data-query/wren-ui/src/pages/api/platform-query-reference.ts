import { NextApiRequest, NextApiResponse } from 'next';
import {
  canonical,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import { NativeQueryService } from '@server/services/nativeQueryService';
import {
  authorizeNativeScope,
  nativePreviewScope,
  resolveNativeResource,
} from '@server/services/nativeHumanQuery';

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
      Object.keys(request.query).sort().join(',') !==
        'generation,limit,queryScope,viewId' ||
      Object.values(request.query).some((value) => typeof value !== 'string')
    ) {
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    }
    const config = await loadQueryDelivery();
    const token = request.headers['x-kailo-native-human-token'];
    const identity = request.headers['x-kailo-native-identity-scope'];
    if (typeof token !== 'string' || !token || typeof identity !== 'string')
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const viewId = Number(request.query.viewId);
    const limit = Number(request.query.limit);
    const generation = Number(request.query.generation);
    if (
      !Number.isSafeInteger(viewId) ||
      viewId <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(generation) ||
      generation <= 0 ||
      !/^[a-f0-9]{64}$/.test(request.query.queryScope as string)
    )
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    const verifyRequest = async () => {
      const scope = await authorizeNativeScope(config, token, 'discover');
      if (
        request.query.queryScope !== nativePreviewScope(config, identity) ||
        generation !== scope.generation ||
        canonical(await loadQueryDelivery()) !== canonical(config)
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    // Bind this actual request to the client's current identity and generation,
    // not just two browser config reads that could miss A -> B -> A.
    await verifyRequest();
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
    await verifyRequest();
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

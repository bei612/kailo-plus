import { NextApiRequest, NextApiResponse } from 'next';
import { loadQueryDelivery, NativeQueryRefusal } from '@server/services/nativeQueryAdmission';
import { NativeQueryService } from '@server/services/nativeQueryService';

// This is intentionally NOT a machine-route middleware exemption. Both direct
// and embedded browsers need the native issuer/sub and instance access grant.
// Exporting metadata does not execute SQL or grant a Kailo Resource permission.
export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.status(405).end(); return; }
  try {
    if (Object.keys(request.query).sort().join(',') !== 'limit,resourceId,viewId' ||
      Object.values(request.query).some((value) => typeof value !== 'string')) {
      throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
    }
    const config = await loadQueryDelivery();
    const { components } = await import('../../common');
    const service = new NativeQueryService(config, components.projectRepository,
      components.deployLogRepository, components.apiHistoryRepository, components.queryService,
      components.viewRepository);
    response.status(200).json(await service.reference(String(request.query.resourceId),
      Number(request.query.viewId), Number(request.query.limit)));
  } catch (error) {
    response.status(error instanceof NativeQueryRefusal ? error.status : 503).json({
      error: error instanceof NativeQueryRefusal ? error.code : 'QUERY_EVIDENCE_UNAVAILABLE',
    });
  }
}

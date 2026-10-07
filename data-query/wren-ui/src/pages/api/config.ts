import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '@/apollo/server/config';
import { loadQueryDelivery } from '@server/services/nativeQueryAdmission';
import { nativePreviewScope } from '@server/services/nativeHumanQuery';

export default async function handler(
  request: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Cache-Control', 'private, no-store');
  const config = getConfig();
  const encodedTelemetryKey = config.posthogApiKey
    ? Buffer.from(config.posthogApiKey).toString('base64')
    : '';
  let queryScope: string | undefined;
  if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE) {
    try {
      const delivery = await loadQueryDelivery();
      const identity = request.headers['x-kailo-native-identity-scope'];
      if (delivery.humanAction && typeof identity === 'string') {
        queryScope = nativePreviewScope(delivery, identity);
      }
    } catch {
      /* No preview intent can be created without the exact scope. */
    }
  }

  res.status(200).json({
    isTelemetryEnabled: config.telemetryEnabled || false,
    telemetryKey: encodedTelemetryKey,
    telemetryHost: config.posthogHost || '',
    userUUID: config.userUUID || '',
    queryScope,
  });
}

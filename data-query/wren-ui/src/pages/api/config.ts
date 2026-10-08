import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '@/apollo/server/config';
import { loadQueryDelivery } from '@server/services/nativeQueryAdmission';
import {
  nativePreviewScope,
  authorizeNativeScope,
} from '@server/services/nativeHumanQuery';

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
  let nativeBindingGeneration: number | undefined;
  if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
    try {
      const delivery = await loadQueryDelivery();
      const identity = request.headers['x-kailo-native-identity-scope'];
      const token = request.headers['x-kailo-native-human-token'];
      if (
        delivery.humanAction &&
        typeof identity === 'string' &&
        typeof token === 'string'
      ) {
        const scope = await authorizeNativeScope(delivery, token, 'discover');
        queryScope = nativePreviewScope(delivery, identity);
        nativeBindingGeneration = scope.generation;
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
    nativeBindingConfigured:
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined,
    nativeBindingGeneration,
    queryScope,
  });
}

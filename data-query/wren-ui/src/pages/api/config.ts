import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '@/apollo/server/config';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
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
  const queryConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const bindingConfig = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  const nativeBindingConfigured =
    queryConfig !== undefined || bindingConfig !== undefined;
  if (nativeBindingConfigured) {
    if (request.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    try {
      if (!queryConfig?.startsWith('/') || !bindingConfig?.startsWith('/'))
        throw new NativeQueryRefusal(503, 'NATIVE_INSTANCE_UNAVAILABLE');
      const delivery = await loadQueryDelivery();
      const identity = request.headers['x-kailo-native-identity-scope'];
      const token = request.headers['x-kailo-native-human-token'];
      if (
        typeof identity !== 'string' ||
        !/^[a-f0-9]{64}$/.test(identity) ||
        typeof token !== 'string' ||
        !token
      )
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      // IdP authenticates. This original Node consumer rechecks the exact
      // binding, active membership and fresh SpiceDB discover permission.
      const scope = await authorizeNativeScope(delivery, token, 'discover');
      queryScope = nativePreviewScope(delivery, identity);
      nativeBindingGeneration = scope.generation;
      res.setHeader('x-kailo-native-identity-scope', identity);
    } catch (error) {
      return res
        .status(error instanceof NativeQueryRefusal ? error.status : 503)
        .json({ error: 'NATIVE_INSTANCE_UNAVAILABLE' });
    }
  }

  res.status(200).json({
    isTelemetryEnabled: config.telemetryEnabled || false,
    telemetryKey: encodedTelemetryKey,
    telemetryHost: config.posthogHost || '',
    userUUID: config.userUUID || '',
    nativeBindingConfigured,
    nativeBindingGeneration,
    queryScope,
  });
}

const env = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

export default env;

export type UserConfig = {
  queryScope?: string;
  isTelemetryEnabled: boolean;
  telemetryKey: string;
  telemetryHost: string;
  userUUID: string;
};

// Get the user configuration
export const getUserConfig = async (): Promise<UserConfig> => {
  const response = await fetch('/api/config', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Native configuration unavailable');
  const config = await response.json();
  const decodedTelemetryKey = Buffer.from(
    config.telemetryKey,
    'base64',
  ).toString();
  return { ...config, telemetryKey: decodedTelemetryKey };
};

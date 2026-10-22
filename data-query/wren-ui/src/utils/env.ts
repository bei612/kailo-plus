const env = {
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

export default env;

export type UserConfig = {
  nativeBindingConfigured: boolean;
  nativeBindingGeneration?: number;
  queryScope?: string;
};

// Get the user configuration
export const getUserConfig = async (): Promise<UserConfig> => {
  const response = await fetch('/api/config', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Native configuration unavailable');
  return await response.json();
};

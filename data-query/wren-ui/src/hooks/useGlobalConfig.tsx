import { useRouter } from 'next/router';
import { createContext, useContext, useEffect, useState } from 'react';
import { getUserConfig, UserConfig } from '@/utils/env';

type ContextProps = {
  config?: UserConfig | null;
};

const GlobalConfigContext = createContext<ContextProps>({});

export const GlobalConfigProvider = ({ children }) => {
  const router = useRouter();
  const [config, setConfig] = useState<UserConfig | null>(null);

  useEffect(() => {
    getUserConfig()
      .then((config) => {
        setConfig(config);
      })
      .catch((error) => {
        console.error('Failed to get user config', error);
      });
  }, [router]);

  const value = {
    config,
  };

  return (
    <GlobalConfigContext.Provider value={value}>
      {children}
    </GlobalConfigContext.Provider>
  );
};

export default function useGlobalConfig() {
  return useContext(GlobalConfigContext);
}

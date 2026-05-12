import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { AppConfig } from '@/api/types';

const DEFAULT_CONFIG: AppConfig = {
  agentgatewayUrl: 'http://localhost:8080',
  keycloakUrl: 'http://localhost:9000',
  defaultRealm: 'agw-dev',
  clientId: 'agw-client',
  clientSecret: '',
  stsPort: 7777,
  variables: {},
};

interface ConfigContextValue {
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;
  resetConfig: () => void;
  setVariable: (key: string, value: string) => void;
  deleteVariable: (key: string) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export const ConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useLocalStorage<AppConfig>('agw-tester-config', DEFAULT_CONFIG);

  const updateConfig = useCallback(
    (updates: Partial<AppConfig>) => {
      setConfig(prev => ({ ...prev, ...updates }));
    },
    [setConfig]
  );

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, [setConfig]);

  const setVariable = useCallback(
    (key: string, value: string) => {
      setConfig(prev => ({
        ...prev,
        variables: { ...prev.variables, [key]: value },
      }));
    },
    [setConfig]
  );

  const deleteVariable = useCallback(
    (key: string) => {
      setConfig(prev => {
        const { [key]: _, ...rest } = prev.variables;
        return { ...prev, variables: rest };
      });
    },
    [setConfig]
  );

  return (
    <ConfigContext.Provider
      value={{
        config,
        updateConfig,
        resetConfig,
        setVariable,
        deleteVariable,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = (): ConfigContextValue => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};

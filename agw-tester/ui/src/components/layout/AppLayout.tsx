import styled from '@emotion/styled';
import { Sidebar } from './Sidebar';
import { colors } from '@/styles/colors';
import { useConfig } from '@/context/ConfigContext';
import { useEffect, useState, useRef } from 'react';
import { apiClient } from '@/api/client';

const LayoutContainer = styled.div`
  display: flex;
  min-height: 100vh;
  background-color: ${colors.background};
`;

const MainContent = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

interface AppLayoutProps {
  children: React.ReactNode;
}

interface GatewayStatusResponse {
  connected: boolean;
  url?: string;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { config } = useConfig();
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'pending'>('pending');
  const currentUrlRef = useRef(config.agentgatewayUrl);

  useEffect(() => {
    let cancelled = false;
    const url = config.agentgatewayUrl;
    currentUrlRef.current = url;

    // Show pending immediately
    setConnectionStatus('pending');

    const checkConnection = async () => {
      if (cancelled || url !== currentUrlRef.current) return;
      try {
        const result = await apiClient.post<GatewayStatusResponse>('/api/gateway/status', {
          agentgatewayUrl: url,
        });
        if (!cancelled && url === currentUrlRef.current) {
          setConnectionStatus(result.connected ? 'online' : 'offline');
        }
      } catch {
        if (!cancelled && url === currentUrlRef.current) {
          setConnectionStatus('offline');
        }
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [config.agentgatewayUrl]);

  return (
    <LayoutContainer>
      <Sidebar connectionStatus={connectionStatus} />
      <MainContent>{children}</MainContent>
    </LayoutContainer>
  );
};

import styled from '@emotion/styled';
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input, FormField } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { useConfig } from '@/context/ConfigContext';
import { useMutation } from '@/hooks/useApi';
import { apiClient } from '@/api/client';
import type { TokenResponse, DecodedJWT, ProtectedResourceMetadata } from '@/api/types';
import { colors } from '@/styles/colors';
import { spacing, radius } from '@/styles/sizing';
import { fontSize, fontFamily } from '@/styles/typography';
import toast from 'react-hot-toast';

const Container = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
  height: 100%;
  overflow: auto;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[4]};
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
  margin-bottom: ${spacing[4]};
`;

const FullRow = styled.div`
  margin-bottom: ${spacing[4]};
`;

const TokenDisplay = styled.div`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.xs};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  padding: ${spacing[3]};
  border-radius: ${radius.md};
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
`;

const JWTSection = styled.div`
  margin-bottom: ${spacing[4]};
`;

const SectionTitle = styled.h4`
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  margin: 0 0 ${spacing[2]} 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const ClaimsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.sm};
`;

const ClaimRow = styled.tr`
  border-bottom: 1px solid ${colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const ClaimKey = styled.td`
  padding: ${spacing[2]};
  font-family: ${fontFamily.mono};
  color: ${colors.primary};
  width: 30%;
`;

const ClaimValue = styled.td`
  padding: ${spacing[2]};
  font-family: ${fontFamily.mono};
  color: ${colors.foreground};
  word-break: break-all;
`;

const ExpiryBadge = styled.div<{ expired: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${spacing[2]};
  padding: ${spacing[2]} ${spacing[3]};
  background-color: ${({ expired }) => (expired ? colors.errorBg : colors.successBg)};
  color: ${({ expired }) => (expired ? colors.error : colors.success)};
  border-radius: ${radius.md};
  font-size: ${fontSize.sm};
`;

const MetadataCard = styled(Card)`
  flex-shrink: 0;
`;

const decodeJWT = (token: string): DecodedJWT | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));

    return {
      header,
      payload,
      signature: parts[2],
      raw: token,
    };
  } catch {
    return null;
  }
};

const formatClaimValue = (value: unknown): string => {
  if (typeof value === 'number') {
    if (value > 1000000000 && value < 2000000000) {
      return new Date(value * 1000).toLocaleString();
    }
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

export const TokensTab: React.FC = () => {
  const { config } = useConfig();
  const [grantType, setGrantType] = useState<'password' | 'client_credentials'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState(config.clientId);
  const [clientSecret, setClientSecret] = useState(config.clientSecret);
  const [scope, setScope] = useState('openid');
  const [, setToken] = useState<TokenResponse | null>(null);
  const [decodedToken, setDecodedToken] = useState<DecodedJWT | null>(null);
  const [metadata, setMetadata] = useState<ProtectedResourceMetadata | null>(null);

  const acquireToken = useMutation(
    useCallback(async () => {
      const result = await apiClient.post<TokenResponse>('/api/keycloak/token', {
        grantType,
        username: grantType === 'password' ? username : undefined,
        password: grantType === 'password' ? password : undefined,
        clientId,
        clientSecret,
        scope,
      });
      return result;
    }, [grantType, username, password, clientId, clientSecret, scope])
  );

  const fetchMetadata = useMutation(
    useCallback(async () => {
      const result = await apiClient.get<ProtectedResourceMetadata>('/api/metadata/protected-resource');
      return result;
    }, [])
  );

  const handleAcquireToken = async () => {
    try {
      const result = await acquireToken.execute();
      setToken(result);
      const decoded = decodeJWT(result.access_token);
      setDecodedToken(decoded);
      toast.success('Token acquired');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to acquire token';
      toast.error(message);
    }
  };

  const handleFetchMetadata = async () => {
    try {
      const result = await fetchMetadata.execute();
      setMetadata(result);
      toast.success('Metadata fetched');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch metadata';
      toast.error(message);
    }
  };

  const isExpired = decodedToken
    ? (decodedToken.payload.exp as number) * 1000 < Date.now()
    : false;

  const timeUntilExpiry = decodedToken
    ? Math.max(0, (decodedToken.payload.exp as number) * 1000 - Date.now())
    : 0;

  return (
    <Container>
      <Column>
        <Card>
          <CardHeader>
            <CardTitle>Acquire Token</CardTitle>
          </CardHeader>
          <CardContent>
            <FullRow>
              <FormField label="Grant Type" fullWidth>
                <Select
                  value={grantType}
                  onChange={(e) => setGrantType(e.target.value as 'password' | 'client_credentials')}
                >
                  <option value="password">Password Grant</option>
                  <option value="client_credentials">Client Credentials</option>
                </Select>
              </FormField>
            </FullRow>

            {grantType === 'password' && (
              <Row>
                <FormField label="Username" fullWidth>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                  />
                </FormField>
                <FormField label="Password" fullWidth>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                  />
                </FormField>
              </Row>
            )}

            <Row>
              <FormField label="Client ID" fullWidth>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Enter client ID"
                />
              </FormField>
              <FormField label="Client Secret" fullWidth>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter client secret"
                />
              </FormField>
            </Row>

            <FullRow>
              <FormField label="Scope" fullWidth>
                <Input
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  placeholder="openid profile email"
                />
              </FormField>
            </FullRow>
          </CardContent>
          <CardFooter>
            <Button onClick={handleAcquireToken} disabled={acquireToken.loading}>
              {acquireToken.loading ? <Spinner size={16} color="#fff" /> : 'Acquire Token'}
            </Button>
          </CardFooter>
        </Card>

        <MetadataCard>
          <CardHeader>
            <CardTitle>Protected Resource Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            {metadata ? (
              <ClaimsTable>
                <tbody>
                  <ClaimRow>
                    <ClaimKey>resource</ClaimKey>
                    <ClaimValue>{metadata.resource}</ClaimValue>
                  </ClaimRow>
                  <ClaimRow>
                    <ClaimKey>authorization_servers</ClaimKey>
                    <ClaimValue>{metadata.authorization_servers?.join(', ')}</ClaimValue>
                  </ClaimRow>
                  {metadata.bearer_methods_supported && (
                    <ClaimRow>
                      <ClaimKey>bearer_methods</ClaimKey>
                      <ClaimValue>{metadata.bearer_methods_supported.join(', ')}</ClaimValue>
                    </ClaimRow>
                  )}
                </tbody>
              </ClaimsTable>
            ) : (
              <div style={{ color: colors.mutedForeground, fontSize: fontSize.sm }}>
                Click below to fetch OAuth protected resource metadata
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="secondary" onClick={handleFetchMetadata} disabled={fetchMetadata.loading}>
              {fetchMetadata.loading ? <Spinner size={16} /> : 'Fetch Metadata'}
            </Button>
          </CardFooter>
        </MetadataCard>
      </Column>

      <Column>
        <Card style={{ flex: 1 }}>
          <CardHeader>
            <CardTitle>JWT Inspector</CardTitle>
          </CardHeader>
          <CardContent>
            {decodedToken ? (
              <>
                <JWTSection>
                  <SectionTitle>Status</SectionTitle>
                  <ExpiryBadge expired={isExpired}>
                    {isExpired
                      ? 'Expired'
                      : `Expires in ${Math.floor(timeUntilExpiry / 1000 / 60)} minutes`}
                  </ExpiryBadge>
                </JWTSection>

                <JWTSection>
                  <SectionTitle>Header</SectionTitle>
                  <ClaimsTable>
                    <tbody>
                      {Object.entries(decodedToken.header).map(([key, value]) => (
                        <ClaimRow key={key}>
                          <ClaimKey>{key}</ClaimKey>
                          <ClaimValue>{formatClaimValue(value)}</ClaimValue>
                        </ClaimRow>
                      ))}
                    </tbody>
                  </ClaimsTable>
                </JWTSection>

                <JWTSection>
                  <SectionTitle>Payload</SectionTitle>
                  <ClaimsTable>
                    <tbody>
                      {Object.entries(decodedToken.payload).map(([key, value]) => (
                        <ClaimRow key={key}>
                          <ClaimKey>{key}</ClaimKey>
                          <ClaimValue>{formatClaimValue(value)}</ClaimValue>
                        </ClaimRow>
                      ))}
                    </tbody>
                  </ClaimsTable>
                </JWTSection>

                <JWTSection>
                  <SectionTitle>Raw Token</SectionTitle>
                  <TokenDisplay>{decodedToken.raw}</TokenDisplay>
                </JWTSection>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '200px',
                  color: colors.mutedForeground,
                  fontSize: fontSize.sm,
                }}
              >
                Acquire a token to inspect its contents
              </div>
            )}
          </CardContent>
        </Card>
      </Column>
    </Container>
  );
};

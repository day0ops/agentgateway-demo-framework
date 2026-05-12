import styled from '@emotion/styled';
import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input, FormField, Textarea } from '@/components/common/Input';
import { Spinner } from '@/components/common/Spinner';
import { useMutation } from '@/hooks/useApi';
import { apiClient } from '@/api/client';
import type { TokenResponse, DecodedJWT } from '@/api/types';
import { colors } from '@/styles/colors';
import { spacing, radius } from '@/styles/sizing';
import { fontSize, fontFamily } from '@/styles/typography';
import toast from 'react-hot-toast';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[4]};
  max-width: 1200px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
`;

const FullRow = styled.div`
  margin-bottom: ${spacing[4]};
`;

const FlowVisualization = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing[4]};
  padding: ${spacing[6]};
  background: ${colors.surfaceBg};
  border-radius: ${radius.lg};
  margin-bottom: ${spacing[4]};
`;

const FlowBox = styled.div<{ active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: ${spacing[4]};
  background: ${({ active }) => (active ? colors.primaryActive : colors.cardBg)};
  border: 2px solid ${({ active }) => (active ? colors.primary : colors.border)};
  border-radius: ${radius.lg};
  min-width: 150px;
`;

const FlowLabel = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.mutedForeground};
  margin-bottom: ${spacing[1]};
`;

const FlowValue = styled.span`
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  font-weight: 500;
`;

const Arrow = styled.div`
  font-size: 24px;
  color: ${colors.primary};
`;

const TokenComparison = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
`;

const TokenCard = styled.div`
  background: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.lg};
  padding: ${spacing[4]};
`;

const TokenTitle = styled.h4`
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  margin: 0 0 ${spacing[3]} 0;
  text-transform: uppercase;
`;

const ClaimsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.xs};
`;

const ClaimRow = styled.tr`
  border-bottom: 1px solid ${colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const ClaimKey = styled.td`
  padding: ${spacing[1]} ${spacing[2]};
  font-family: ${fontFamily.mono};
  color: ${colors.primary};
  width: 35%;
`;

const ClaimValue = styled.td<{ highlight?: boolean }>`
  padding: ${spacing[1]} ${spacing[2]};
  font-family: ${fontFamily.mono};
  color: ${({ highlight }) => (highlight ? colors.success : colors.foreground)};
  word-break: break-all;
`;

const decodeJWT = (token: string): DecodedJWT | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    return { header, payload, signature: parts[2], raw: token };
  } catch {
    return null;
  }
};

export const OBOTab: React.FC = () => {
  const [subjectToken, setSubjectToken] = useState('');
  const [audience, setAudience] = useState('');
  const [scope, setScope] = useState('openid');
  const [exchangedToken, setExchangedToken] = useState<TokenResponse | null>(null);

  const subjectDecoded = subjectToken ? decodeJWT(subjectToken) : null;
  const exchangedDecoded = exchangedToken ? decodeJWT(exchangedToken.access_token) : null;

  const exchangeToken = useMutation(
    useCallback(async () => {
      const result = await apiClient.post<TokenResponse>('/api/keycloak/token-exchange', {
        subjectToken,
        audience,
        scope,
      });
      return result;
    }, [subjectToken, audience, scope])
  );

  const handleExchange = async () => {
    if (!subjectToken) {
      toast.error('Subject token is required');
      return;
    }
    try {
      const result = await exchangeToken.execute();
      setExchangedToken(result);
      toast.success('Token exchanged successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token exchange failed';
      toast.error(message);
    }
  };

  const formatClaimValue = (value: unknown): string => {
    if (typeof value === 'number') {
      if (value > 1000000000 && value < 2000000000) {
        return new Date(value * 1000).toLocaleTimeString();
      }
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const getChangedClaims = (): Set<string> => {
    if (!subjectDecoded || !exchangedDecoded) return new Set();
    const changed = new Set<string>();
    const allKeys = new Set([
      ...Object.keys(subjectDecoded.payload),
      ...Object.keys(exchangedDecoded.payload),
    ]);
    for (const key of allKeys) {
      if (
        JSON.stringify(subjectDecoded.payload[key]) !==
        JSON.stringify(exchangedDecoded.payload[key])
      ) {
        changed.add(key);
      }
    }
    return changed;
  };

  const changedClaims = getChangedClaims();

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle>On-Behalf-Of Token Exchange</CardTitle>
        </CardHeader>
        <CardContent>
          <FlowVisualization>
            <FlowBox active={!!subjectDecoded}>
              <FlowLabel>Subject Token</FlowLabel>
              <FlowValue>
                {subjectDecoded ? (subjectDecoded.payload.sub as string) : 'Not provided'}
              </FlowValue>
            </FlowBox>
            <Arrow>→</Arrow>
            <FlowBox>
              <FlowLabel>STS</FlowLabel>
              <FlowValue>Token Exchange</FlowValue>
            </FlowBox>
            <Arrow>→</Arrow>
            <FlowBox active={!!exchangedDecoded}>
              <FlowLabel>Delegated Token</FlowLabel>
              <FlowValue>
                {exchangedDecoded
                  ? (exchangedDecoded.payload.act as { sub?: string })?.sub || 'Delegated'
                  : 'Not exchanged'}
              </FlowValue>
            </FlowBox>
          </FlowVisualization>

          <FullRow>
            <FormField label="Subject Token" fullWidth>
              <Textarea
                value={subjectToken}
                onChange={e => setSubjectToken(e.target.value)}
                placeholder="Paste the subject token (JWT) here..."
                style={{ minHeight: '80px' }}
              />
            </FormField>
          </FullRow>

          <Row>
            <FormField label="Audience" fullWidth>
              <Input
                value={audience}
                onChange={e => setAudience(e.target.value)}
                placeholder="Target audience (optional)"
              />
            </FormField>
            <FormField label="Scope" fullWidth>
              <Input value={scope} onChange={e => setScope(e.target.value)} placeholder="openid" />
            </FormField>
          </Row>
        </CardContent>
        <CardFooter>
          <Button onClick={handleExchange} disabled={exchangeToken.loading || !subjectToken}>
            {exchangeToken.loading ? <Spinner size={16} color="#fff" /> : 'Exchange Token'}
          </Button>
        </CardFooter>
      </Card>

      {(subjectDecoded || exchangedDecoded) && (
        <Card>
          <CardHeader>
            <CardTitle>Token Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenComparison>
              <TokenCard>
                <TokenTitle>Subject Token Claims</TokenTitle>
                {subjectDecoded ? (
                  <ClaimsTable>
                    <tbody>
                      {Object.entries(subjectDecoded.payload).map(([key, value]) => (
                        <ClaimRow key={key}>
                          <ClaimKey>{key}</ClaimKey>
                          <ClaimValue>{formatClaimValue(value)}</ClaimValue>
                        </ClaimRow>
                      ))}
                    </tbody>
                  </ClaimsTable>
                ) : (
                  <div style={{ color: colors.mutedForeground }}>No subject token</div>
                )}
              </TokenCard>

              <TokenCard>
                <TokenTitle>Exchanged Token Claims</TokenTitle>
                {exchangedDecoded ? (
                  <ClaimsTable>
                    <tbody>
                      {Object.entries(exchangedDecoded.payload).map(([key, value]) => (
                        <ClaimRow key={key}>
                          <ClaimKey>{key}</ClaimKey>
                          <ClaimValue highlight={changedClaims.has(key)}>
                            {formatClaimValue(value)}
                          </ClaimValue>
                        </ClaimRow>
                      ))}
                    </tbody>
                  </ClaimsTable>
                ) : (
                  <div style={{ color: colors.mutedForeground }}>
                    Exchange a token to see comparison
                  </div>
                )}
              </TokenCard>
            </TokenComparison>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

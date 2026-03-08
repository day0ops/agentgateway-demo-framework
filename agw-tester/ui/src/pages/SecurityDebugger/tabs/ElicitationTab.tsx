import styled from '@emotion/styled';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input, FormField, Textarea } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { Spinner } from '@/components/common/Spinner';
import { useMutation } from '@/hooks/useApi';
import { apiClient } from '@/api/client';
import { colors } from '@/styles/colors';
import { spacing, radius } from '@/styles/sizing';
import { fontSize, fontFamily } from '@/styles/typography';
import toast from 'react-hot-toast';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[4]};
  max-width: 1000px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
`;

const Timeline = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[3]};
  padding: ${spacing[4]};
  background: ${colors.surfaceBg};
  border-radius: ${radius.lg};
`;

const TimelineItem = styled.div<{ status: 'pending' | 'active' | 'completed' | 'error' }>`
  display: flex;
  gap: ${spacing[3]};
  align-items: flex-start;
`;

const TimelineDot = styled.div<{ status: 'pending' | 'active' | 'completed' | 'error' }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
  background-color: ${({ status }) => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'active':
        return colors.primary;
      case 'error':
        return colors.error;
      default:
        return colors.border;
    }
  }};
  ${({ status }) =>
    status === 'active' &&
    `
    animation: pulse 1.5s infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `}
`;

const TimelineContent = styled.div`
  flex: 1;
`;

const TimelineTitle = styled.div`
  font-size: ${fontSize.sm};
  font-weight: 500;
  color: ${colors.foreground};
`;

const TimelineDescription = styled.div`
  font-size: ${fontSize.xs};
  color: ${colors.mutedForeground};
  margin-top: ${spacing[1]};
`;

const ElicitationUrl = styled.div`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.xs};
  color: ${colors.info};
  background: ${colors.infoBg};
  padding: ${spacing[3]};
  border-radius: ${radius.md};
  word-break: break-all;
  margin-top: ${spacing[2]};

  a {
    color: ${colors.info};
    text-decoration: underline;
  }
`;

const ResponseDisplay = styled.pre`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.xs};
  color: ${colors.foreground};
  background: ${colors.cardBg};
  padding: ${spacing[3]};
  border-radius: ${radius.md};
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
`;

interface ElicitationStatus {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';
  elicitationUrl?: string;
  result?: unknown;
  createdAt: string;
  completedAt?: string;
}

export const ElicitationTab: React.FC = () => {
  const [endpoint, setEndpoint] = useState('/mcp');
  const [requestBody, setRequestBody] = useState(
    JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'require_approval_tool',
          arguments: { action: 'sensitive_action' },
        },
      },
      null,
      2
    )
  );
  const [elicitation, setElicitation] = useState<ElicitationStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendRequest = useMutation(
    useCallback(async () => {
      const body = JSON.parse(requestBody);
      const result = await apiClient.post<{ elicitation?: ElicitationStatus; response?: unknown }>(
        '/api/proxy/mcp',
        { endpoint, body }
      );
      return result;
    }, [endpoint, requestBody])
  );

  const pollStatus = useCallback(async () => {
    if (!elicitation?.id) return;
    try {
      const result = await apiClient.get<ElicitationStatus>(
        `/api/elicitation/status/${elicitation.id}`
      );
      setElicitation(result);
      if (result.status !== 'PENDING') {
        setIsPolling(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        if (result.status === 'COMPLETED') {
          toast.success('Elicitation completed');
        } else if (result.status === 'REJECTED') {
          toast.error('Elicitation rejected');
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [elicitation?.id]);

  useEffect(() => {
    if (isPolling && elicitation?.id) {
      pollingRef.current = setInterval(pollStatus, 2000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      };
    }
  }, [isPolling, elicitation?.id, pollStatus]);

  const handleSend = async () => {
    try {
      const result = await sendRequest.execute();
      if (result.elicitation) {
        setElicitation(result.elicitation);
        if (result.elicitation.status === 'PENDING') {
          setIsPolling(true);
          toast.success('Elicitation started - waiting for approval');
        }
      } else {
        toast.success('Request completed without elicitation');
        setElicitation(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      toast.error(message);
    }
  };

  const handleStopPolling = () => {
    setIsPolling(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const getTimelineStatus = (
    step: number
  ): 'pending' | 'active' | 'completed' | 'error' => {
    if (!elicitation) return 'pending';
    const currentStep = elicitation.status === 'PENDING' ? 2 : 3;
    if (elicitation.status === 'REJECTED' && step === 3) return 'error';
    if (step < currentStep) return 'completed';
    if (step === currentStep) return elicitation.status === 'PENDING' ? 'active' : 'completed';
    return 'pending';
  };

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle>Elicitation Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <Row style={{ marginBottom: spacing[4] }}>
            <FormField label="Endpoint" fullWidth>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="/mcp"
              />
            </FormField>
          </Row>

          <FormField label="Request Body (JSON-RPC)" fullWidth>
            <Textarea
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              style={{ minHeight: '150px' }}
            />
          </FormField>
        </CardContent>
        <CardFooter>
          {isPolling ? (
            <Button variant="secondary" onClick={handleStopPolling}>
              Stop Polling
            </Button>
          ) : (
            <Button onClick={handleSend} disabled={sendRequest.loading}>
              {sendRequest.loading ? <Spinner size={16} color="#fff" /> : 'Send Request'}
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Elicitation Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline>
            <TimelineItem status={getTimelineStatus(1)}>
              <TimelineDot status={getTimelineStatus(1)} />
              <TimelineContent>
                <TimelineTitle>Request Sent</TimelineTitle>
                <TimelineDescription>
                  MCP tool call initiated
                </TimelineDescription>
              </TimelineContent>
            </TimelineItem>

            <TimelineItem status={getTimelineStatus(2)}>
              <TimelineDot status={getTimelineStatus(2)} />
              <TimelineContent>
                <TimelineTitle>Awaiting Approval</TimelineTitle>
                <TimelineDescription>
                  {elicitation?.status === 'PENDING'
                    ? 'User action required'
                    : 'Waiting for elicitation trigger'}
                </TimelineDescription>
                {elicitation?.elicitationUrl && elicitation.status === 'PENDING' && (
                  <ElicitationUrl>
                    <a href={elicitation.elicitationUrl} target="_blank" rel="noopener noreferrer">
                      {elicitation.elicitationUrl}
                    </a>
                  </ElicitationUrl>
                )}
                {isPolling && (
                  <div style={{ marginTop: spacing[2] }}>
                    <Badge variant="info">
                      <Spinner size={12} /> Polling for updates...
                    </Badge>
                  </div>
                )}
              </TimelineContent>
            </TimelineItem>

            <TimelineItem status={getTimelineStatus(3)}>
              <TimelineDot status={getTimelineStatus(3)} />
              <TimelineContent>
                <TimelineTitle>
                  {elicitation?.status === 'COMPLETED'
                    ? 'Completed'
                    : elicitation?.status === 'REJECTED'
                      ? 'Rejected'
                      : elicitation?.status === 'EXPIRED'
                        ? 'Expired'
                        : 'Resolution'}
                </TimelineTitle>
                <TimelineDescription>
                  {elicitation?.status === 'COMPLETED'
                    ? `Completed at ${new Date(elicitation.completedAt!).toLocaleTimeString()}`
                    : elicitation?.status === 'REJECTED'
                      ? 'User rejected the elicitation'
                      : 'Final status pending'}
                </TimelineDescription>
                {elicitation?.result !== undefined && (
                  <ResponseDisplay>
                    {JSON.stringify(elicitation.result, null, 2)}
                  </ResponseDisplay>
                )}
              </TimelineContent>
            </TimelineItem>
          </Timeline>
        </CardContent>
      </Card>
    </Container>
  );
};

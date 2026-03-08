import styled from '@emotion/styled';
import { useState, useCallback, useEffect } from 'react';
import { PageHeader } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/Card';
import { Button, IconButton } from '@/components/common/Button';
import { Input, FormField } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { Badge } from '@/components/common/Badge';
import { Spinner } from '@/components/common/Spinner';
import { useConfig } from '@/context/ConfigContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useMutation } from '@/hooks/useApi';
import { apiClient } from '@/api/client';
import { DEFAULT_TEMPLATES, DEFAULT_PROVIDERS, type HistoryEntry, type LLMResponse } from '@/api/types';
import { colors } from '@/styles/colors';
import { spacing, radius } from '@/styles/sizing';
import { fontSize, fontFamily } from '@/styles/typography';
import toast from 'react-hot-toast';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ContentArea = styled.div<{ showSidebar: boolean }>`
  flex: 1;
  display: grid;
  grid-template-columns: ${({ showSidebar }) => showSidebar ? '1fr 400px' : '1fr'};
  gap: ${spacing[4]};
  padding: ${spacing[4]};
  overflow: hidden;
`;

const MainPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[4]};
  overflow-y: auto;
`;

const SidePanel = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid ${colors.border};
  padding-left: ${spacing[4]};
`;

const RequestCard = styled(Card)`
  flex-shrink: 0;
`;

const ResponseCard = styled(Card)`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ResponseContent = styled(CardContent)`
  flex: 1;
  overflow: auto;
`;

const Row = styled.div`
  display: flex;
  gap: ${spacing[3]};
  align-items: flex-end;
`;

const EndpointInput = styled.div`
  flex: 1;
`;

const HeadersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[2]};
`;

const HeaderRow = styled.div`
  display: flex;
  gap: ${spacing[2]};
  align-items: center;
`;

const HeaderInput = styled(Input)`
  flex: 1;
`;

const BodyEditor = styled.textarea`
  width: 100%;
  min-height: 200px;
  padding: ${spacing[3]};
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.md};
  resize: vertical;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }
`;

const ResponseMeta = styled.div`
  display: flex;
  gap: ${spacing[4]};
  align-items: center;
  margin-bottom: ${spacing[3]};
  padding-bottom: ${spacing[3]};
  border-bottom: 1px solid ${colors.border};
`;

const ResponseBody = styled.pre`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.xs};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  padding: ${spacing[3]};
  border-radius: ${radius.md};
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
`;

const EmptyResponse = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${colors.mutedForeground};
  font-size: ${fontSize.sm};
`;

const ModeToggle = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing[2]};
  margin-bottom: ${spacing[4]};
`;

const ToggleButton = styled.button<{ active: boolean }>`
  padding: ${spacing[2]} ${spacing[3]};
  font-size: ${fontSize.sm};
  color: ${({ active }) => active ? colors.foreground : colors.mutedForeground};
  background: ${({ active }) => active ? colors.primary : 'transparent'};
  border: 1px solid ${({ active }) => active ? colors.primary : colors.border};
  border-radius: ${radius.md};
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${({ active }) => active ? colors.primaryHover : colors.hoverBg};
  }
`;

const SimpleMessageInput = styled.textarea`
  width: 100%;
  min-height: 120px;
  padding: ${spacing[3]};
  font-family: ${fontFamily.sans};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.md};
  resize: vertical;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }

  &::placeholder {
    color: ${colors.dimForeground};
  }
`;

const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing[2]};
`;

const HistoryCard = styled(Card)`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const HistoryContent = styled(CardContent)`
  flex: 1;
  overflow-y: auto;
  padding: 0;
`;

const HistoryItem = styled.div<{ active?: boolean }>`
  padding: ${spacing[3]} ${spacing[4]};
  border-bottom: 1px solid ${colors.border};
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: ${colors.hoverBg};
  }

  ${({ active }) => active && `background-color: ${colors.activeBg};`}
`;

const HistoryItemHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${spacing[1]};
`;

const HistoryEndpoint = styled.span`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.xs};
  color: ${colors.foreground};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HistoryMeta = styled.div`
  display: flex;
  gap: ${spacing[2]};
  align-items: center;
  font-size: ${fontSize.xs};
  color: ${colors.mutedForeground};
`;

const getStatusVariant = (status: number): 'success' | 'warning' | 'error' => {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400) return 'error';
  return 'warning';
};

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SidebarIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    {open ? (
      <polyline points="10 8 6 12 10 16" />
    ) : (
      <polyline points="6 8 10 12 6 16" />
    )}
  </svg>
);

export const RequestBuilderPage: React.FC = () => {
  const { config } = useConfig();
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('agw-tester-history', []);
  const [lastEndpoint, setLastEndpoint] = useLocalStorage<string>('agw-tester-last-endpoint', '/openai/v1/chat/completions');

  const [endpoint, setEndpoint] = useState(lastEndpoint);
  const [method] = useState<'POST' | 'GET'>('POST');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [body, setBody] = useState(JSON.stringify(DEFAULT_TEMPLATES[0].body, null, 2));
  const [response, setResponse] = useState<LLMResponse | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [advancedMode, setAdvancedMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [messageContent, setMessageContent] = useState('Hello, how are you?');
  const [messageRole, setMessageRole] = useState<'user' | 'assistant' | 'system'>('user');

  // Generate body from simple inputs
  const generateBody = useCallback(() => {
    const isAnthropic = selectedProvider === 'anthropic';
    if (isAnthropic) {
      return {
        model: selectedModel,
        max_tokens: 1024,
        messages: [{ role: messageRole, content: messageContent }],
      };
    }
    return {
      model: selectedModel,
      messages: [{ role: messageRole, content: messageContent }],
    };
  }, [selectedProvider, selectedModel, messageRole, messageContent]);

  // Sync body when simple inputs change (only in simple mode)
  useEffect(() => {
    if (!advancedMode) {
      setBody(JSON.stringify(generateBody(), null, 2));
    }
  }, [advancedMode, generateBody]);

  const sendRequest = useMutation(
    useCallback(async () => {
      const headersObj = headers.reduce((acc, { key, value }) => {
        if (key.trim()) acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

      // In simple mode, always use freshly generated body
      let parsedBody: unknown;
      if (!advancedMode) {
        parsedBody = generateBody();
      } else {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          throw new Error('Invalid JSON body');
        }
      }

      const result = await apiClient.post<LLMResponse>('/api/proxy/llm', {
        endpoint,
        method,
        headers: headersObj,
        body: parsedBody,
        agentgatewayUrl: config.agentgatewayUrl,
      });

      return result;
    }, [endpoint, method, headers, body, config.agentgatewayUrl, advancedMode, generateBody])
  );

  const handleSend = async () => {
    try {
      setLastEndpoint(endpoint);
      const result = await sendRequest.execute();
      setResponse(result);

      const requestBody = advancedMode ? JSON.parse(body) : generateBody();
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type: endpoint.includes('/mcp') ? 'mcp' : 'llm',
        endpoint,
        method,
        request: requestBody,
        response: result.body,
        durationMs: result.durationMs,
        status: result.status,
      };
      setHistory((prev) => [entry, ...prev.slice(0, 49)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      toast.error(message);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = DEFAULT_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setEndpoint(template.endpoint);
      setHeaders(
        Object.entries(template.headers).map(([key, value]) => ({ key, value }))
      );
      setBody(JSON.stringify(template.body, null, 2));
      // Sync model and provider from template body
      const templateBody = template.body as { model?: string };
      if (templateBody.model) {
        setSelectedModel(templateBody.model);
        // Find provider for this model
        for (const provider of DEFAULT_PROVIDERS) {
          if (provider.models.some(m => m.id === templateBody.model)) {
            setSelectedProvider(provider.id);
            break;
          }
        }
      }
    }
  };

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId);
    const provider = DEFAULT_PROVIDERS.find((p) => p.id === providerId);
    if (provider && provider.models.length > 0) {
      const newModel = provider.models[0].id;
      setSelectedModel(newModel);
      try {
        const parsed = JSON.parse(body);
        parsed.model = newModel;
        setBody(JSON.stringify(parsed, null, 2));
      } catch {
        // Ignore parse errors
      }
    }
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    try {
      const parsed = JSON.parse(body);
      parsed.model = modelId;
      setBody(JSON.stringify(parsed, null, 2));
    } catch {
      // Ignore parse errors
    }
  };

  const handleAddHeader = () => {
    setHeaders((prev) => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', value: string) => {
    setHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, [field]: value } : h))
    );
  };

  const handleHistorySelect = (entry: HistoryEntry) => {
    setEndpoint(entry.endpoint);
    setBody(JSON.stringify(entry.request, null, 2));
    setResponse({
      status: entry.status,
      statusText: entry.status >= 200 && entry.status < 300 ? 'OK' : 'Error',
      headers: {},
      body: entry.response,
      durationMs: entry.durationMs,
    });
  };

  const handleClearHistory = () => {
    if (confirm('Clear all request history?')) {
      setHistory([]);
      toast.success('History cleared');
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const selectedProviderModels = DEFAULT_PROVIDERS.find((p) => p.id === selectedProvider)?.models || [];

  return (
    <PageContainer>
      <PageHeader
        title="Request Builder"
        description="Build and send requests to agentgateway"
      >
        <ToolbarRight>
          <IconButton
            onClick={() => setShowSidebar(!showSidebar)}
            title={showSidebar ? 'Hide history' : 'Show history'}
          >
            <SidebarIcon open={showSidebar} />
          </IconButton>
        </ToolbarRight>
      </PageHeader>

      <ContentArea showSidebar={showSidebar}>
        <MainPanel>
          <RequestCard>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent>
              <Row style={{ marginBottom: spacing[4] }}>
                <FormField label="Template" fullWidth>
                  <Select value={selectedTemplate} onChange={(e) => handleTemplateChange(e.target.value)}>
                    <option value="">Select a template...</option>
                    {DEFAULT_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Provider" fullWidth>
                  <Select value={selectedProvider} onChange={(e) => handleProviderChange(e.target.value)}>
                    {DEFAULT_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Model" fullWidth>
                  <Select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                  >
                    {selectedProviderModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </Row>

              <Row style={{ marginBottom: spacing[4] }}>
                <EndpointInput>
                  <FormField label="Endpoint" fullWidth>
                    <Input
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="/openai/v1/chat/completions"
                    />
                  </FormField>
                </EndpointInput>
                <Button
                  variant="primary"
                  onClick={handleSend}
                  disabled={sendRequest.loading}
                  style={{ minWidth: 100 }}
                >
                  {sendRequest.loading ? <Spinner size={16} color="#fff" /> : 'Send'}
                </Button>
              </Row>

              <FormField label="Headers" fullWidth>
                <HeadersContainer>
                  {headers.map((header, index) => (
                    <HeaderRow key={index}>
                      <HeaderInput
                        value={header.key}
                        onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                        placeholder="Header name"
                      />
                      <HeaderInput
                        value={header.value}
                        onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                        placeholder="Header value"
                      />
                      <IconButton onClick={() => handleRemoveHeader(index)}>
                        <TrashIcon />
                      </IconButton>
                    </HeaderRow>
                  ))}
                  <Button variant="ghost" size="sm" onClick={handleAddHeader} style={{ marginBottom: spacing[4] }}>
                    <PlusIcon /> Add Header
                  </Button>
                </HeadersContainer>
              </FormField>

              <ModeToggle>
                <ToggleButton active={!advancedMode} onClick={() => setAdvancedMode(false)}>
                  Simple
                </ToggleButton>
                <ToggleButton active={advancedMode} onClick={() => setAdvancedMode(true)}>
                  Advanced
                </ToggleButton>
              </ModeToggle>

              {!advancedMode ? (
                <>
                  <Row style={{ marginBottom: spacing[4] }}>
                    <FormField label="Role" fullWidth>
                      <Select value={messageRole} onChange={(e) => setMessageRole(e.target.value as 'user' | 'assistant' | 'system')}>
                        <option value="user">User</option>
                        <option value="assistant">Assistant</option>
                        <option value="system">System</option>
                      </Select>
                    </FormField>
                  </Row>
                  <FormField label="Message" fullWidth>
                    <SimpleMessageInput
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      placeholder="Enter your message..."
                    />
                  </FormField>
                </>
              ) : (
                <FormField label="Body (JSON)" fullWidth>
                  <BodyEditor
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder='{"key": "value"}'
                  />
                </FormField>
              )}
            </CardContent>
          </RequestCard>

          <ResponseCard>
            <CardHeader>
              <CardTitle>Response</CardTitle>
            </CardHeader>
            <ResponseContent>
              {response ? (
                <>
                  <ResponseMeta>
                    <Badge variant={getStatusVariant(response.status)}>
                      {response.status} {response.statusText}
                    </Badge>
                    <span style={{ color: colors.mutedForeground, fontSize: fontSize.sm }}>
                      {response.durationMs}ms
                    </span>
                  </ResponseMeta>
                  <ResponseBody>
                    {JSON.stringify(response.body, null, 2)}
                  </ResponseBody>
                </>
              ) : (
                <EmptyResponse>
                  Send a request to see the response
                </EmptyResponse>
              )}
            </ResponseContent>
          </ResponseCard>
        </MainPanel>

        {showSidebar && (
          <SidePanel>
          <HistoryCard>
            <CardHeader>
              <CardTitle>History</CardTitle>
              {history.length > 0 && (
                <IconButton onClick={handleClearHistory} title="Clear history">
                  <TrashIcon />
                </IconButton>
              )}
            </CardHeader>
            <HistoryContent>
              {history.length === 0 ? (
                <EmptyResponse style={{ padding: spacing[6] }}>
                  No request history yet
                </EmptyResponse>
              ) : (
                history.map((entry) => (
                  <HistoryItem
                    key={entry.id}
                    onClick={() => handleHistorySelect(entry)}
                  >
                    <HistoryItemHeader>
                      <HistoryEndpoint>{entry.endpoint}</HistoryEndpoint>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHistoryItem(entry.id);
                        }}
                      >
                        <TrashIcon />
                      </IconButton>
                    </HistoryItemHeader>
                    <HistoryMeta>
                      <Badge variant={getStatusVariant(entry.status)} style={{ padding: '2px 6px' }}>
                        {entry.status}
                      </Badge>
                      <span>{entry.durationMs}ms</span>
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </HistoryMeta>
                  </HistoryItem>
                ))
              )}
            </HistoryContent>
          </HistoryCard>
        </SidePanel>
        )}
      </ContentArea>
    </PageContainer>
  );
};

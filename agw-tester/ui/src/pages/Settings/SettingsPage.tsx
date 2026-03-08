import styled from '@emotion/styled';
import { useState } from 'react';
import { PageHeader } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/common/Card';
import { Button, IconButton } from '@/components/common/Button';
import { Input, FormField } from '@/components/common/Input';
import { useConfig } from '@/context/ConfigContext';
import { colors } from '@/styles/colors';
import { spacing, radius } from '@/styles/sizing';
import { fontSize } from '@/styles/typography';
import toast from 'react-hot-toast';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ContentArea = styled.div`
  flex: 1;
  padding: ${spacing[6]};
  overflow-y: auto;
`;

const Section = styled.div`
  margin-bottom: ${spacing[6]};
  max-width: 800px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${spacing[4]};
  margin-bottom: ${spacing[4]};
`;

const VariableRow = styled.div`
  display: flex;
  gap: ${spacing[3]};
  align-items: flex-start;
  margin-bottom: ${spacing[3]};
`;

const VariableInput = styled.div`
  flex: 1;
`;

const RemoveButton = styled(IconButton)`
  margin-top: 26px;
`;

const EmptyVariables = styled.div`
  padding: ${spacing[4]};
  text-align: center;
  color: ${colors.mutedForeground};
  font-size: ${fontSize.sm};
  background: ${colors.surfaceBg};
  border-radius: ${radius.md};
  border: 1px dashed ${colors.border};
`;

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const SettingsPage: React.FC = () => {
  const { config, updateConfig, resetConfig, setVariable, deleteVariable } = useConfig();
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  const handleAddVariable = () => {
    if (!newVarKey.trim()) {
      toast.error('Variable name is required');
      return;
    }
    setVariable(newVarKey.trim(), newVarValue);
    setNewVarKey('');
    setNewVarValue('');
    toast.success('Variable added');
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      resetConfig();
      toast.success('Settings reset to defaults');
    }
  };

  const variables = Object.entries(config.variables);

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Configure connection settings and variables"
      >
        <Button variant="secondary" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </PageHeader>

      <ContentArea>
        <Section>
          <Card>
            <CardHeader>
              <CardTitle>Connection Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <Row>
                <FormField label="Agentgateway URL" fullWidth>
                  <Input
                    value={config.agentgatewayUrl}
                    onChange={(e) => updateConfig({ agentgatewayUrl: e.target.value })}
                    placeholder="http://localhost:8080"
                  />
                </FormField>
                <FormField label="STS Port" fullWidth>
                  <Input
                    type="number"
                    value={config.stsPort}
                    onChange={(e) => updateConfig({ stsPort: parseInt(e.target.value) || 7777 })}
                    placeholder="7777"
                  />
                </FormField>
              </Row>
            </CardContent>
          </Card>
        </Section>

        <Section>
          <Card>
            <CardHeader>
              <CardTitle>Keycloak / OAuth Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <Row>
                <FormField label="Keycloak URL" fullWidth>
                  <Input
                    value={config.keycloakUrl}
                    onChange={(e) => updateConfig({ keycloakUrl: e.target.value })}
                    placeholder="http://localhost:9000"
                  />
                </FormField>
                <FormField label="Default Realm" fullWidth>
                  <Input
                    value={config.defaultRealm}
                    onChange={(e) => updateConfig({ defaultRealm: e.target.value })}
                    placeholder="agw-dev"
                  />
                </FormField>
              </Row>
              <Row>
                <FormField label="Client ID" fullWidth>
                  <Input
                    value={config.clientId}
                    onChange={(e) => updateConfig({ clientId: e.target.value })}
                    placeholder="agw-client"
                  />
                </FormField>
                <FormField label="Client Secret" fullWidth>
                  <Input
                    type="password"
                    value={config.clientSecret}
                    onChange={(e) => updateConfig({ clientSecret: e.target.value })}
                    placeholder="Enter client secret"
                  />
                </FormField>
              </Row>
            </CardContent>
          </Card>
        </Section>

        <Section>
          <Card>
            <CardHeader>
              <CardTitle>Custom Variables</CardTitle>
            </CardHeader>
            <CardContent>
              {variables.length === 0 ? (
                <EmptyVariables>
                  No custom variables defined. Add variables to use in request headers or bodies.
                </EmptyVariables>
              ) : (
                variables.map(([key, value]) => (
                  <VariableRow key={key}>
                    <VariableInput>
                      <FormField label="Name" fullWidth>
                        <Input value={key} disabled />
                      </FormField>
                    </VariableInput>
                    <VariableInput>
                      <FormField label="Value" fullWidth>
                        <Input
                          value={value}
                          onChange={(e) => setVariable(key, e.target.value)}
                        />
                      </FormField>
                    </VariableInput>
                    <RemoveButton onClick={() => deleteVariable(key)}>
                      <TrashIcon />
                    </RemoveButton>
                  </VariableRow>
                ))
              )}
            </CardContent>
            <CardFooter>
              <VariableRow style={{ marginBottom: 0, flex: 1 }}>
                <VariableInput>
                  <Input
                    value={newVarKey}
                    onChange={(e) => setNewVarKey(e.target.value)}
                    placeholder="Variable name"
                  />
                </VariableInput>
                <VariableInput>
                  <Input
                    value={newVarValue}
                    onChange={(e) => setNewVarValue(e.target.value)}
                    placeholder="Variable value"
                  />
                </VariableInput>
                <Button onClick={handleAddVariable}>Add</Button>
              </VariableRow>
            </CardFooter>
          </Card>
        </Section>
      </ContentArea>
    </PageContainer>
  );
};

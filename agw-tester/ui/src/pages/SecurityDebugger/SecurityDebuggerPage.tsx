import styled from '@emotion/styled';
import { useState } from 'react';
import { PageHeader } from '@/components/layout';
import { TabsContainer, TabList, Tab, TabPanel } from '@/components/common/Tabs';
import { TokensTab } from './tabs/TokensTab';
import { OBOTab } from './tabs/OBOTab';
import { ElicitationTab } from './tabs/ElicitationTab';
import { spacing } from '@/styles/sizing';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const StyledTabPanel = styled(TabPanel)`
  padding: ${spacing[4]};
`;

type TabId = 'tokens' | 'obo' | 'elicitation';

export const SecurityDebuggerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('tokens');

  return (
    <PageContainer>
      <PageHeader
        title="Security Debugger"
        description="Debug OAuth flows, token exchange, and elicitation"
      />

      <ContentArea>
        <TabsContainer>
          <TabList>
            <Tab active={activeTab === 'tokens'} onClick={() => setActiveTab('tokens')}>
              Tokens
            </Tab>
            <Tab active={activeTab === 'obo'} onClick={() => setActiveTab('obo')}>
              OBO / Token Exchange
            </Tab>
            <Tab active={activeTab === 'elicitation'} onClick={() => setActiveTab('elicitation')}>
              Elicitation
            </Tab>
          </TabList>

          <StyledTabPanel>
            {activeTab === 'tokens' && <TokensTab />}
            {activeTab === 'obo' && <OBOTab />}
            {activeTab === 'elicitation' && <ElicitationTab />}
          </StyledTabPanel>
        </TabsContainer>
      </ContentArea>
    </PageContainer>
  );
};

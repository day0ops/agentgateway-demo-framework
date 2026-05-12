import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

export const TabsContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

export const TabList = styled.div`
  display: flex;
  gap: ${spacing[1]};
  border-bottom: 1px solid ${colors.border};
  padding: 0 ${spacing[4]};
`;

interface TabProps {
  active?: boolean;
}

export const Tab = styled.button<TabProps>`
  padding: ${spacing[3]} ${spacing[4]};
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.medium};
  color: ${({ active }) => (active ? colors.foreground : colors.mutedForeground)};
  background: transparent;
  border: none;
  border-bottom: 2px solid ${({ active }) => (active ? colors.primary : 'transparent')};
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: -1px;

  &:hover {
    color: ${colors.foreground};
  }

  &:focus-visible {
    outline: none;
    background-color: ${colors.hoverBg};
    border-radius: ${radius.sm} ${radius.sm} 0 0;
  }
`;

export const TabPanel = styled.div`
  flex: 1;
  overflow: auto;
`;

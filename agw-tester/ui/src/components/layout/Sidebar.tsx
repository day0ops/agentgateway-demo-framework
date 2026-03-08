import styled from '@emotion/styled';
import { NavLink } from 'react-router-dom';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight, fontFamily } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';
import { StatusDot } from '../common/Badge';

interface SidebarProps {
  connectionStatus: 'online' | 'offline' | 'pending';
}

const SidebarContainer = styled.aside`
  width: 240px;
  min-width: 240px;
  height: 100vh;
  background-color: ${colors.sidebarBg};
  border-right: 1px solid ${colors.sidebarBorder};
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
`;

const LogoSection = styled.div`
  padding: 28px ${spacing[5]} 27px;
  border-bottom: 1px solid ${colors.border};
`;

const LogoTitle = styled.h1`
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
  color: ${colors.foreground};
  margin: 0;
  display: flex;
  align-items: center;
  gap: ${spacing[2]};
`;

const LogoSubtext = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.dimForeground};
  margin-top: ${spacing[1]};
  display: block;
`;

const NavSection = styled.nav`
  flex: 1;
  padding: ${spacing[3]};
  display: flex;
  flex-direction: column;
  gap: ${spacing[1]};
`;

const NavSectionTitle = styled.div`
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  color: ${colors.dimForeground};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: ${spacing[2]} ${spacing[3]};
  margin-top: ${spacing[3]};

  &:first-of-type {
    margin-top: 0;
  }
`;

const StyledNavLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${spacing[3]};
  padding: ${spacing[2]} ${spacing[3]};
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  border-radius: ${radius.md};
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    background-color: ${colors.sidebarItemHover};
    color: ${colors.foreground};
  }

  &.active {
    background-color: ${colors.sidebarItemActive};
    color: ${colors.foreground};
  }

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
`;

const StatusSection = styled.div`
  padding: ${spacing[4]};
  border-top: 1px solid ${colors.border};
  display: flex;
  align-items: center;
  gap: ${spacing[2]};
  font-size: ${fontSize.xs};
  color: ${colors.mutedForeground};
`;

const RequestsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const SecurityIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const Sidebar: React.FC<SidebarProps> = ({ connectionStatus }) => {
  const statusText = connectionStatus === 'online'
    ? 'Gateway connected'
    : connectionStatus === 'offline'
      ? 'Gateway disconnected'
      : 'Checking connection...';

  return (
    <SidebarContainer>
      <LogoSection>
        <LogoTitle>
          Agent Gateway Tester
        </LogoTitle>
        <LogoSubtext>Testing UI</LogoSubtext>
      </LogoSection>

      <NavSection>
        <NavSectionTitle>Testing</NavSectionTitle>
        <StyledNavLink to="/requests">
          <RequestsIcon />
          Request Builder
        </StyledNavLink>
        <StyledNavLink to="/security">
          <SecurityIcon />
          Security Debugger
        </StyledNavLink>

        <NavSectionTitle>Configuration</NavSectionTitle>
        <StyledNavLink to="/settings">
          <SettingsIcon />
          Settings
        </StyledNavLink>
      </NavSection>

      <StatusSection>
        <StatusDot status={connectionStatus} />
        {statusText}
      </StatusSection>
    </SidebarContainer>
  );
};

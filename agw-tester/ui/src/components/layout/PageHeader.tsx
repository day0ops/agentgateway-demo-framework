import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing } from '@/styles/sizing';

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${spacing[5]} ${spacing[6]};
  border-bottom: 1px solid ${colors.border};
  background-color: ${colors.cardBg};
`;

const TitleSection = styled.div``;

const Title = styled.h1`
  font-size: ${fontSize['2xl']};
  font-weight: ${fontWeight.semibold};
  color: ${colors.foreground};
  margin: 0;
`;

const Description = styled.p`
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  margin: ${spacing[1]} 0 0 0;
`;

const ActionsSection = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing[3]};
`;

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, children }) => {
  return (
    <HeaderContainer>
      <TitleSection>
        <Title>{title}</Title>
        {description && <Description>{description}</Description>}
      </TitleSection>
      {children && <ActionsSection>{children}</ActionsSection>}
    </HeaderContainer>
  );
};

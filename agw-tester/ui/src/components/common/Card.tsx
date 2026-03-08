import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

export const Card = styled.div`
  background-color: ${colors.cardBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.lg};
  overflow: hidden;
`;

export const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${spacing[4]} ${spacing[5]};
  border-bottom: 1px solid ${colors.border};
`;

export const CardTitle = styled.h2`
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
  color: ${colors.foreground};
  margin: 0;
`;

export const CardDescription = styled.p`
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  margin: 0;
  margin-top: ${spacing[1]};
`;

export const CardContent = styled.div`
  padding: ${spacing[5]};
`;

export const CardFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${spacing[3]};
  padding: ${spacing[4]} ${spacing[5]};
  border-top: 1px solid ${colors.border};
`;

import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
}

const getVariantStyles = (variant: BadgeVariant) => {
  switch (variant) {
    case 'success':
      return `
        background-color: ${colors.successBg};
        color: ${colors.success};
        border-color: ${colors.successBorder};
      `;
    case 'warning':
      return `
        background-color: ${colors.warningBg};
        color: ${colors.warning};
        border-color: ${colors.warningBorder};
      `;
    case 'error':
      return `
        background-color: ${colors.errorBg};
        color: ${colors.error};
        border-color: ${colors.errorBorder};
      `;
    case 'info':
      return `
        background-color: ${colors.infoBg};
        color: ${colors.info};
        border-color: ${colors.infoBorder};
      `;
    default:
      return `
        background-color: ${colors.secondary};
        color: ${colors.mutedForeground};
        border-color: ${colors.border};
      `;
  }
};

export const Badge = styled.span<BadgeProps>`
  display: inline-flex;
  align-items: center;
  gap: ${spacing[1]};
  padding: ${spacing[1]} ${spacing[2]};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.medium};
  border-radius: ${radius.sm};
  border: 1px solid;

  ${({ variant = 'default' }) => getVariantStyles(variant)}
`;

export const StatusDot = styled.span<{ status: 'online' | 'offline' | 'pending' }>`
  width: 8px;
  height: 8px;
  border-radius: ${radius.full};
  background-color: ${({ status }) => {
    switch (status) {
      case 'online':
        return colors.success;
      case 'offline':
        return colors.error;
      case 'pending':
        return colors.warning;
    }
  }};
`;

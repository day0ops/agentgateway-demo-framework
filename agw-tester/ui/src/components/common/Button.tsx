import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const getVariantStyles = (variant: ButtonVariant) => {
  switch (variant) {
    case 'primary':
      return `
        background-color: ${colors.primary};
        color: ${colors.foreground};
        &:hover:not(:disabled) {
          background-color: ${colors.primaryHover};
        }
        &:active:not(:disabled) {
          background-color: ${colors.primaryActive};
        }
      `;
    case 'secondary':
      return `
        background-color: ${colors.secondary};
        color: ${colors.foreground};
        border: 1px solid ${colors.border};
        &:hover:not(:disabled) {
          background-color: ${colors.secondaryHover};
          border-color: ${colors.borderLight};
        }
        &:active:not(:disabled) {
          background-color: ${colors.secondaryActive};
        }
      `;
    case 'danger':
      return `
        background-color: ${colors.error};
        color: ${colors.foreground};
        &:hover:not(:disabled) {
          background-color: #DC2626;
        }
        &:active:not(:disabled) {
          background-color: #B91C1C;
        }
      `;
    case 'success':
      return `
        background-color: ${colors.success};
        color: ${colors.foreground};
        &:hover:not(:disabled) {
          background-color: #16A34A;
        }
        &:active:not(:disabled) {
          background-color: #15803D;
        }
      `;
    case 'ghost':
      return `
        background-color: transparent;
        color: ${colors.mutedForeground};
        &:hover:not(:disabled) {
          background-color: ${colors.hoverBg};
          color: ${colors.foreground};
        }
        &:active:not(:disabled) {
          background-color: ${colors.activeBg};
        }
      `;
    default:
      return '';
  }
};

const getSizeStyles = (size: ButtonSize) => {
  switch (size) {
    case 'sm':
      return `
        padding: ${spacing[1]} ${spacing[3]};
        font-size: ${fontSize.xs};
      `;
    case 'md':
      return `
        padding: ${spacing[2]} ${spacing[4]};
        font-size: ${fontSize.sm};
      `;
    case 'lg':
      return `
        padding: ${spacing[3]} ${spacing[6]};
        font-size: ${fontSize.md};
      `;
    default:
      return '';
  }
};

export const Button = styled.button<ButtonProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing[2]};
  border: none;
  border-radius: ${radius.md};
  font-weight: ${fontWeight.medium};
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  ${({ variant = 'primary' }) => getVariantStyles(variant)}
  ${({ size = 'md' }) => getSizeStyles(size)}
  ${({ fullWidth }) => fullWidth && 'width: 100%;'}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 2px;
  }
`;

export const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: ${radius.md};
  background-color: transparent;
  color: ${colors.mutedForeground};
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background-color: ${colors.hoverBg};
    color: ${colors.foreground};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

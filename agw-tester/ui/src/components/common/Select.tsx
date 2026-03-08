import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontFamily } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

export const Select = styled.select`
  width: 100%;
  padding: ${spacing[2]} ${spacing[3]};
  padding-right: ${spacing[8]};
  font-family: ${fontFamily.sans};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.md};
  cursor: pointer;
  transition: all 0.15s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23A1A1AA' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right ${spacing[3]} center;

  &:hover:not(:disabled) {
    border-color: ${colors.borderLight};
  }

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(104, 68, 255, 0.2);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  option {
    background-color: ${colors.cardBg};
    color: ${colors.foreground};
  }
`;

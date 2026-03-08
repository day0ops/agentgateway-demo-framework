import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontFamily } from '@/styles/typography';
import { spacing, radius } from '@/styles/sizing';

export const Input = styled.input`
  width: 100%;
  padding: ${spacing[2]} ${spacing[3]};
  font-family: ${fontFamily.sans};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.md};
  transition: all 0.15s ease;

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

  &::placeholder {
    color: ${colors.dimForeground};
  }

  /* Override browser autofill styles */
  &:-webkit-autofill,
  &:-webkit-autofill:hover,
  &:-webkit-autofill:focus,
  &:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px ${colors.surfaceBg} inset !important;
    -webkit-text-fill-color: ${colors.foreground} !important;
    caret-color: ${colors.foreground};
  }
`;

export const Textarea = styled.textarea`
  width: 100%;
  min-height: 100px;
  padding: ${spacing[2]} ${spacing[3]};
  font-family: ${fontFamily.mono};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  background-color: ${colors.surfaceBg};
  border: 1px solid ${colors.border};
  border-radius: ${radius.md};
  resize: vertical;
  transition: all 0.15s ease;

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

  &::placeholder {
    color: ${colors.dimForeground};
  }
`;

export const InputWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${spacing[1]};
`;

export const Label = styled.label`
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  display: flex;
  align-items: center;
  gap: ${spacing[2]};
`;

export const InputError = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.error};
`;

export const InputHint = styled.span`
  font-size: ${fontSize.xs};
  color: ${colors.dimForeground};
`;

interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  hint,
  children,
  fullWidth,
}) => {
  return (
    <InputWrapper style={fullWidth ? { width: '100%' } : undefined}>
      <Label>{label}</Label>
      {children}
      {error && <InputError>{error}</InputError>}
      {hint && !error && <InputHint>{hint}</InputHint>}
    </InputWrapper>
  );
};

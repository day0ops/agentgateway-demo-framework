import styled from '@emotion/styled';
import { colors } from '@/styles/colors';
import { fontSize, fontWeight } from '@/styles/typography';
import { spacing } from '@/styles/sizing';

export const TableContainer = styled.div`
  overflow-x: auto;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

export const TableHead = styled.thead`
  background-color: ${colors.surfaceBg};
`;

export const TableBody = styled.tbody``;

interface TableRowProps {
  clickable?: boolean;
}

export const TableRow = styled.tr<TableRowProps>`
  border-bottom: 1px solid ${colors.border};

  ${({ clickable }) =>
    clickable &&
    `
    cursor: pointer;
    &:hover {
      background-color: ${colors.tableRowHover};
    }
  `}
`;

interface TableHeaderProps {
  align?: 'left' | 'center' | 'right';
}

export const TableHeader = styled.th<TableHeaderProps>`
  padding: ${spacing[3]} ${spacing[4]};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  color: ${colors.mutedForeground};
  text-align: ${({ align = 'left' }) => align};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

interface TableCellProps {
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
}

export const TableCell = styled.td<TableCellProps>`
  padding: ${spacing[3]} ${spacing[4]};
  font-size: ${fontSize.sm};
  color: ${colors.foreground};
  text-align: ${({ align = 'left' }) => align};
  font-family: ${({ mono }) => (mono ? "'JetBrains Mono', monospace" : 'inherit')};
`;

export const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: ${spacing[10]};
`;

export const EmptyStateText = styled.p`
  font-size: ${fontSize.sm};
  color: ${colors.mutedForeground};
  text-align: center;
`;

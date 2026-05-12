import { css } from '@emotion/react';
import { colors } from './colors';
import { fontFamily, fontSize, fontWeight, lineHeight } from './typography';

export const globalStyles = css`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html,
  body {
    height: 100%;
    width: 100%;
  }

  body {
    font-family: ${fontFamily.sans};
    font-size: ${fontSize.sm};
    font-weight: ${fontWeight.regular};
    line-height: ${lineHeight.normal};
    color: ${colors.foreground};
    background-color: ${colors.background};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  #root {
    height: 100%;
  }

  a {
    color: ${colors.primary};
    text-decoration: none;

    &:hover {
      color: ${colors.primaryHover};
    }
  }

  code,
  pre {
    font-family: ${fontFamily.mono};
  }

  ::selection {
    background-color: ${colors.primary};
    color: ${colors.foreground};
  }

  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: ${colors.background};
  }

  ::-webkit-scrollbar-thumb {
    background: ${colors.border};
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.borderLight};
  }
`;

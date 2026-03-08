import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Global } from '@emotion/react';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter } from 'react-router-dom';
import { globalStyles } from '@/styles/global';
import { ConfigProvider } from '@/context/ConfigContext';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Global styles={globalStyles} />
    <BrowserRouter>
      <ConfigProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#11101C',
              color: '#FAFAFA',
              border: '1px solid #27242E',
            },
            success: {
              iconTheme: {
                primary: '#22C55E',
                secondary: '#FAFAFA',
              },
            },
            error: {
              iconTheme: {
                primary: '#EF4444',
                secondary: '#FAFAFA',
              },
            },
          }}
        />
      </ConfigProvider>
    </BrowserRouter>
  </StrictMode>
);

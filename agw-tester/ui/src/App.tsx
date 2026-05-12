import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout';
import { RequestBuilderPage } from '@/pages/RequestBuilder/RequestBuilderPage';
import { SecurityDebuggerPage } from '@/pages/SecurityDebugger/SecurityDebuggerPage';
import { SettingsPage } from '@/pages/Settings/SettingsPage';

export const App: React.FC = () => {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/requests" replace />} />
        <Route path="/requests" element={<RequestBuilderPage />} />
        <Route path="/security" element={<SecurityDebuggerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
};

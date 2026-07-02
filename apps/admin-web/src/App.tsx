import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppLayout from './components/AppLayout';
import LoadingBlock from './components/LoadingBlock';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SnapshotProvider } from './contexts/SnapshotContext';
import AccessPage from './pages/AccessPage';
import ApprovalsPage from './pages/ApprovalsPage';
import LoginPage from './pages/LoginPage';
import OrdersPage from './pages/OrdersPage';
import OverviewPage from './pages/OverviewPage';
import StatisticsPage from './pages/StatisticsPage';

function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, role, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <LoadingBlock label="Checking your session…" />;
  }

  if (!session || role !== 'admin') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAdmin>
              <SnapshotProvider>
                <AppLayout />
              </SnapshotProvider>
            </RequireAdmin>
          }
        >
          <Route path="/" element={<OverviewPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/access" element={<AccessPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

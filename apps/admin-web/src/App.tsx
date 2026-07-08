import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import AppLayout from './components/AppLayout';
import LoadingBlock from './components/LoadingBlock';
import RequireRole from './components/RequireRole';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SnapshotProvider } from './contexts/SnapshotContext';
import LoginPage from './pages/LoginPage';

// Authenticated pages are code-split so the login/first paint doesn't ship the
// whole dashboard bundle (StatisticsPage pulls in Recharts). Each becomes its
// own chunk loaded on navigation.
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const StatisticsPage = lazy(() => import('./pages/StatisticsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));

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
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <OverviewPage />
              </Suspense>
            }
          />
          <Route
            path="/orders"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <OrdersPage />
              </Suspense>
            }
          />
          <Route
            path="/approvals"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <ApprovalsPage />
              </Suspense>
            }
          />
          <Route
            path="/access"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <AccessPage />
              </Suspense>
            }
          />
          <Route
            path="/dispatch"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <DispatchPage />
              </Suspense>
            }
          />
          <Route
            path="/statistics"
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <StatisticsPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/inbox"
          element={
            <RequireRole roles={['admin', 'support']}>
              <SnapshotProvider>
                <AppLayout />
              </SnapshotProvider>
            </RequireRole>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<LoadingBlock label="Loading…" />}>
                <InboxPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

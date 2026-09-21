import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import AppLayout from './components/AppLayout';
import LoadingBlock from './components/LoadingBlock';
import RequireRole from './components/RequireRole';
import { AuthProvider, useAuth } from './contexts/AuthContext';
// Mounted with SnapshotProvider, not inside it: the sidebar's waiting-work
// counts are two separate reads on their own slow, visibility-gated poll,
// and SnapshotContext's header is explicit about what its aggregate covers.
import { NavCountsProvider } from './contexts/NavCountsContext';
import { SnapshotProvider } from './contexts/SnapshotContext';
import LoginPage from './pages/LoginPage';

// Authenticated pages are code-split so the login/first paint doesn't ship the
// whole dashboard bundle (StatisticsPage pulls in Recharts). Each becomes its
// own chunk loaded on navigation.
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const DispatchPage = lazy(() => import('./pages/DispatchPage'));
const StatisticsPage = lazy(() => import('./pages/StatisticsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage'));
const PromosPage = lazy(() => import('./pages/PromosPage'));

function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, role, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <LoadingBlock label="Checking your session..." />;
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
                <NavCountsProvider>
                  <AppLayout />
                </NavCountsProvider>
              </SnapshotProvider>
            </RequireAdmin>
          }
        >
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <OverviewPage />
              </Suspense>
            }
          />
          <Route
            path="/orders"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <OrdersPage />
              </Suspense>
            }
          />
          <Route
            path="/approvals"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <ApprovalsPage />
              </Suspense>
            }
          />
          <Route
            path="/observability"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <ObservabilityPage />
              </Suspense>
            }
          />
          {/* /risk-signals was a second mount of ObservabilityPage, with no
              nav link and no page of its own -- pages/RiskSignalsPage.tsx was
              a one-line `export { default } from './ObservabilityPage'` that
              this route did not even import. Two URLs for one screen, so a
              redirect rather than a duplicate: any bookmark still lands on
              the real page, and there is now one canonical address for it.
              The .risk-signals-* CSS is NOT dead -- ObservabilityPage styles
              its alert list with it. */}
          <Route path="/risk-signals" element={<Navigate to="/observability" replace />} />
          {/* Its own route rather than a panel on /observability: that page
              answers "is something wrong now" and owns a WRITE (the feature
              flag toggles). This one answers "what did we do, and who did it"
              and must be unambiguously read-only. See AuditLogPage.tsx. */}
          <Route
            path="/audit"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <AuditLogPage />
              </Suspense>
            }
          />
          <Route
            path="/access"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <AccessPage />
              </Suspense>
            }
          />
          <Route
            path="/dispatch"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <DispatchPage />
              </Suspense>
            }
          />
          <Route
            path="/statistics"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <StatisticsPage />
              </Suspense>
            }
          />
          <Route
            path="/broadcasts"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <BroadcastsPage />
              </Suspense>
            }
          />
          <Route
            path="/promos"
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
                <PromosPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/inbox"
          element={
            <RequireRole roles={['admin', 'support']}>
              <SnapshotProvider>
                <NavCountsProvider>
                  <AppLayout />
                </NavCountsProvider>
              </SnapshotProvider>
            </RequireRole>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<LoadingBlock label="Loading..." />}>
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

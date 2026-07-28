import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AppRole } from '../../../../packages/domain/src';
import { useAuth } from '../contexts/AuthContext';
import LoadingBlock from './LoadingBlock';

export default function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { session, role, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <LoadingBlock label="Checking your session…" />;
  }

  if (!session || !role || !roles.includes(role)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

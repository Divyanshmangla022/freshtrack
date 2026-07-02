import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../api/types';

/**
 * Gate a route by authentication and (optionally) role. Hub users additionally
 * must have selected an active warehouse for warehouse-scoped routes.
 */
export function ProtectedRoute({
  role,
  requireWarehouse,
  children,
}: {
  role?: Role;
  requireWarehouse?: boolean;
  children: ReactNode;
}) {
  const { user, activeWarehouse, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loading">
        <span className="spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  if (requireWarehouse && user.role === 'HUB_USER' && !activeWarehouse) {
    return <Navigate to="/hub/select-warehouse" replace />;
  }
  return <>{children}</>;
}

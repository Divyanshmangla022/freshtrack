import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { WarehouseSelectPage } from './pages/hub/WarehouseSelectPage';
import { HubInvoicesPage } from './pages/hub/HubInvoicesPage';
import { ScanPage } from './pages/hub/ScanPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { InvoicesPage } from './pages/admin/InvoicesPage';
import { InvoiceUploadPage } from './pages/admin/InvoiceUploadPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { WarehousesPage } from './pages/admin/WarehousesPage';
import { AuditPage } from './pages/admin/AuditPage';

function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'CENTRAL_ADMIN' ? '/admin' : '/hub'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/hub/select-warehouse"
        element={
          <ProtectedRoute role="HUB_USER">
            <WarehouseSelectPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <RoleHome />
          </ProtectedRoute>
        }
      />

      {/* Hub (warehouse-scoped) */}
      <Route
        element={
          <ProtectedRoute role="HUB_USER" requireWarehouse>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/hub" element={<HubInvoicesPage />} />
        <Route path="/hub/scan/:id" element={<ScanPage />} />
      </Route>

      {/* Central Admin console */}
      <Route
        element={
          <ProtectedRoute role="CENTRAL_ADMIN">
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/invoices" element={<InvoicesPage />} />
        <Route path="/admin/upload" element={<InvoiceUploadPage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/warehouses" element={<WarehousesPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

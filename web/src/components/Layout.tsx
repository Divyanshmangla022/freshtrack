import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const adminNav = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/invoices', label: 'Invoices' },
  { to: '/admin/upload', label: 'Upload' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/warehouses', label: 'Warehouses' },
  { to: '/admin/audit', label: 'Audit' },
];

export function Layout() {
  const { user, activeWarehouse, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'CENTRAL_ADMIN';

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <div>
            FreshTrack <small>Inbound Receiving</small>
          </div>
        </div>

        <nav className="nav">
          {isAdmin ? (
            adminNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))
          ) : (
            <>
              <NavLink to="/hub" end className={({ isActive }) => (isActive ? 'active' : '')}>
                Receiving
              </NavLink>
              <NavLink to="/hub/select-warehouse" className={({ isActive }) => (isActive ? 'active' : '')}>
                Switch warehouse
              </NavLink>
            </>
          )}
        </nav>

        <div className="spacer" />

        <div className="usermenu">
          {!isAdmin && activeWarehouse && (
            <span className="badge badge-ok" title="Active warehouse">
              📍 {activeWarehouse.code}
            </span>
          )}
          <div className="who">
            <b>{user?.username}</b>
            <span>{isAdmin ? 'Central Admin' : 'Hub User'}</span>
          </div>
          <button className="btn btn-ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <Outlet />
    </div>
  );
}

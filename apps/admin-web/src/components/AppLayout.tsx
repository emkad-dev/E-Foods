import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSnapshot } from '../contexts/SnapshotContext';

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/access', label: 'Access' },
  { to: '/dispatch', label: 'Dispatch' },
  { to: '/statistics', label: 'Statistics' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/broadcasts', label: 'Broadcasts' },
];

const SUPPORT_NAV = [{ to: '/inbox', label: 'Inbox', end: true }];

export default function AppLayout() {
  const { session, role, signOut } = useAuth();
  const { lastUpdated } = useSnapshot();

  const navItems = role === 'support' ? SUPPORT_NAV : ADMIN_NAV;

  const rawName = session?.user.user_metadata?.display_name || session?.user.email?.split('@')[0] || 'Admin';
  const greetingName = String(rawName).slice(0, 24);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="wordmark-green">FEAST</span>
          <span className="wordmark-orange">Y</span>
        </div>
        
        <nav>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1 className="topbar-title">Hello, {greetingName}!</h1>
          <div className="topbar-meta">
            {lastUpdated ? <span>Updated {lastUpdated.toLocaleTimeString()}</span> : <span>Loading data…</span>}
            <span className="badge badge-primary">{session?.user.email}</span>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

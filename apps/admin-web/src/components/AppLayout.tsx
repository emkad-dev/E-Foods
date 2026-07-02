import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSnapshot } from '../contexts/SnapshotContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/access', label: 'Access' },
  { to: '/statistics', label: 'Statistics' },
];

export default function AppLayout() {
  const { session, signOut } = useAuth();
  const { lastUpdated } = useSnapshot();

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
          {NAV_ITEMS.map((item) => (
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

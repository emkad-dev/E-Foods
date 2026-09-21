import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNavCounts } from '../contexts/NavCountsContext';
import { useSnapshot } from '../contexts/SnapshotContext';
import { describeNavCount, formatNavCount, type NavCountKey } from '../lib/navCounts';
import { resolveViewState } from '../lib/viewState';

/**
 * `countKey` marks the links that carry a waiting-work count. Only the two
 * queues a human has to work have one: eleven identical links gave the
 * operator no way to tell whether anything needed them without opening
 * Approvals and Inbox, and a number on all eleven would restore exactly that
 * problem in a louder form.
 */
type NavItem = {
  countKey?: NavCountKey;
  end?: boolean;
  label: string;
  to: string;
};

const ADMIN_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/approvals', label: 'Approvals', countKey: 'approvals' },
  { to: '/observability', label: 'Observability' },
  { to: '/audit', label: 'Audit log' },
  { to: '/access', label: 'Access' },
  { to: '/dispatch', label: 'Dispatch' },
  { to: '/statistics', label: 'Statistics' },
  { to: '/inbox', label: 'Inbox', countKey: 'inbox' },
  { to: '/broadcasts', label: 'Broadcasts' },
  { to: '/promos', label: 'Promos' },
];

/** The `support` role's whole nav. It is one link, and it is a queue. */
const SUPPORT_NAV: NavItem[] = [{ to: '/inbox', label: 'Inbox', end: true, countKey: 'inbox' }];

/**
 * Dark green pill, white number, right-aligned in the link's existing flex
 * row. Utilities only -- global.css imports Tailwind without preflight
 * precisely so new markup can be styled additively, and the stylesheet's
 * header says not to grow it for this.
 *
 * `--accent-strong` (#1b5e20) rather than the soft green: this sits on the
 * white sidebar AND on the active link's `--accent-soft` background, and
 * only the strong one reads against both. Colour is not carrying the
 * message anyway -- the number is, and the link's accessible name repeats it
 * in words.
 */
const BADGE_CLASS =
  'ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-accent-strong px-1.5 py-0.5 text-xs font-bold tabular-nums text-white';

export default function AppLayout() {
  const { session, role, signOut } = useAuth();
  const { lastUpdated, error, hasData } = useSnapshot();
  const navCounts = useNavCounts();

  const navItems = role === 'support' ? SUPPORT_NAV : ADMIN_NAV;

  // Same defect as the three dashboards had, in one line: with no snapshot the
  // freshness label claimed a load was still running, so a failed fetch sat
  // under a permanent 'Loading data...' that contradicted the error banner on
  // the page below it.
  const snapshotState = resolveViewState({ hasData, error });

  const rawName = session?.user.user_metadata?.display_name || session?.user.email?.split('@')[0] || 'Admin';
  const greetingName = String(rawName).slice(0, 24);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="wordmark-icon" src="/feasty-pizza.png" alt="" />
          <span>
            <span className="wordmark-green">FEAST</span>
            <span className="wordmark-orange">Y</span>
          </span>
        </div>

        <nav>
          {navItems.map((item) => {
            const count = item.countKey ? navCounts[item.countKey] : null;
            // null for "nothing waiting" AND for "we could not ask". Both
            // render an unbadged link; what must never happen is a `0`,
            // which would state that a queue is clear on the strength of a
            // read that failed. See lib/navCounts.ts.
            const badge = formatNavCount(count);
            const accessibleName = describeNavCount(item.label, count);

            return (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link" aria-label={accessibleName}>
                <span>{item.label}</span>
                {/*
                  Hidden from the accessibility tree on purpose: left exposed
                  it is a second bare text node in the link, announced as
                  "Approvals 3" -- a number with no unit. The aria-label
                  above is the one name that says both, so the badge is never
                  the only carrier of the information.
                */}
                {badge === null ? null : (
                  <span className={BADGE_CLASS} aria-hidden="true">
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
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
            {lastUpdated ? (
              <span>Updated {lastUpdated.toLocaleTimeString()}</span>
            ) : snapshotState === 'error' ? (
              <span>Not updated</span>
            ) : (
              <span>Loading data...</span>
            )}
            <span className="badge badge-primary">{session?.user.email}</span>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

import { NavLink, Outlet, useLocation } from 'react-router-dom';
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

type NavGroup = {
  /** Omitted for a list short enough that a heading would be noise. */
  label?: string;
  items: NavItem[];
};

/**
 * Grouped, because thirteen links in one column is a list to read rather than
 * a map to navigate. The grouping is by what the operator came to do, not by
 * how the app is built: the day's work, the two queues that accumulate while
 * nobody is looking, the growth tools, and the things consulted only when
 * something is wrong.
 *
 * `Queues` holds exactly the two links that carry counts, so the one part of
 * the nav that changes during a shift sits together.
 */
const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/orders', label: 'Orders' },
      { to: '/dispatch', label: 'Dispatch' },
      { to: '/restaurants', label: 'Restaurants' },
    ],
  },
  {
    label: 'Queues',
    items: [
      { to: '/approvals', label: 'Approvals', countKey: 'approvals' },
      { to: '/inbox', label: 'Inbox', countKey: 'inbox' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { to: '/broadcasts', label: 'Broadcasts' },
      { to: '/promos', label: 'Promos' },
      { to: '/promo-codes', label: 'Promo codes' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/observability', label: 'Observability' },
      { to: '/statistics', label: 'Statistics' },
      { to: '/audit', label: 'Audit log' },
      { to: '/access', label: 'Access' },
    ],
  },
];

/** The `support` role's whole nav. It is one link, and it is a queue. */
const SUPPORT_NAV: NavGroup[] = [{ items: [{ to: '/inbox', label: 'Inbox', end: true, countKey: 'inbox' }] }];

/**
 * Ink pill, white number, right-aligned in the link's existing flex row.
 * Utilities only -- global.css imports Tailwind without preflight precisely
 * so new markup can be styled additively, and the stylesheet's header says
 * not to grow it for this.
 *
 * Ink rather than the green it used to be. Colour in this console means
 * state (see the --action note in global.css), and a queue with work waiting
 * is not a success; painting the count green said it was. Nothing is lost,
 * because colour was never carrying the message here -- the number is, and
 * the link's accessible name repeats it in words.
 */
const BADGE_CLASS =
  'ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-ink px-1.5 py-0.5 text-xs font-bold tabular-nums text-white';

/**
 * The section the operator is currently in, for the topbar heading.
 *
 * Longest matching path wins, so `/promo-codes` does not resolve to `/promos`
 * and every path resolves to something before falling back.
 */
const resolveSectionLabel = (groups: NavGroup[], pathname: string): string => {
  let best: NavItem | null = null;

  for (const group of groups) {
    for (const item of group.items) {
      const matches = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/');
      if (matches && (best === null || item.to.length > best.to.length)) {
        best = item;
      }
    }
  }

  return best?.label ?? 'Admin';
};

export default function AppLayout() {
  const { session, role, signOut } = useAuth();
  const { lastUpdated, error, hasData } = useSnapshot();
  const navCounts = useNavCounts();
  const { pathname } = useLocation();

  const navGroups = role === 'support' ? SUPPORT_NAV : ADMIN_NAV;

  // Same defect as the three dashboards had, in one line: with no snapshot the
  // freshness label claimed a load was still running, so a failed fetch sat
  // under a permanent 'Loading data...' that contradicted the error banner on
  // the page below it.
  const snapshotState = resolveViewState({ hasData, error });

  // Where you are, not who you are. The widest strip in the console used to
  // spend itself on "Hello, <name>!" -- a greeting the operator has read a
  // thousand times -- while the page itself was left unlabelled, since the
  // pages put filters in their header rather than a title.
  const sectionLabel = resolveSectionLabel(navGroups, pathname);

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
          {navGroups.map((group) => (
            <div key={group.label ?? 'main'}>
              {group.label ? <div className="nav-section-label">{group.label}</div> : null}
              {group.items.map((item) => {
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
                      Hidden from the accessibility tree on purpose: left
                      exposed it is a second bare text node in the link,
                      announced as "Approvals 3" -- a number with no unit. The
                      aria-label above is the one name that says both, so the
                      badge is never the only carrier of the information.
                    */}
                    {badge === null ? null : (
                      <span className={BADGE_CLASS} aria-hidden="true">
                        {badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
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
          <h1 className="topbar-title">{sectionLabel}</h1>
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

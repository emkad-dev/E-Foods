import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVisiblePolling } from '../../../../packages/runtime/src';
import { countOpenConversations, countPendingApplications, type NavCounts } from '../lib/navCounts';
import { useDocumentVisibility } from '../lib/useDocumentVisibility';
import { getAdminApprovalQueue } from '../services/platformReads';
import { getInbox } from '../services/supportInbox';
import { useAuth } from './AuthContext';

/**
 * How many items are waiting in the two queues a human has to work:
 * Approvals and Inbox. Nothing else in the console needs this, and nothing
 * else in the sidebar gets a badge.
 *
 * WHY THIS IS NOT PART OF SnapshotContext: that context's header states what
 * its aggregate covers and why it is a slow safety-net poll rather than a
 * realtime-driven one. Widening it to carry two more RPCs would put the
 * sidebar's needs inside a comment that no longer describes it. This is its
 * own provider, with its own reads, mounted beside it.
 *
 * COST. The org is on the Supabase free plan and its bill is driven by
 * app-rpc INVOCATION COUNT, not payload size (see the egress note in the
 * repo's notes: 970-byte catalog, cost coming from ungated polling). So this
 * provider deliberately does the cheapest thing that can work:
 *
 *   - 120s interval, matching SnapshotContext and usePolledRpc rather than
 *     inventing a faster one for a sidebar hint;
 *   - paused entirely while the tab is hidden, via the same
 *     useVisiblePolling + useDocumentVisibility pair every other poll in
 *     this app uses, so a console left open overnight costs nothing;
 *   - the approvals read is skipped outright for the `support` role, which
 *     has no Approvals link and no permission for that RPC -- badging a link
 *     that role cannot see is not worth a 403 every two minutes.
 *
 * That is 2 requests per 120s for an admin and 1 per 120s for support, both
 * only while someone is looking at the tab.
 *
 * These reads deliberately duplicate the ones on ApprovalsPage and
 * InboxPage rather than reaching into them: the counts must be current on
 * every page, including the nine that mount neither, and no new RPC action
 * is introduced for them (adding one means updating four separately
 * maintained copies of the contract).
 */
const POLL_INTERVAL_MS = 120000;

/**
 * `null` means "we have no count", never "the count is zero".
 *
 * A zero is a claim that the queue is clear, and only a read that came back
 * is entitled to make it. Consumers render nothing for either, but the two
 * must stay distinguishable here so a failed fetch can never be formatted
 * into a confident `0` badge -- the same rule resolveViewState() enforces
 * for the dashboards' empty states.
 */
const EMPTY_COUNTS: NavCounts = { approvals: null, inbox: null };

const NavCountsContext = createContext<NavCounts>(EMPTY_COUNTS);

export function NavCountsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const isVisible = useDocumentVisibility();
  const [approvals, setApprovals] = useState<number | null>(null);
  const [inbox, setInbox] = useState<number | null>(null);
  const activeRef = useRef(true);

  // `support` sees only the Inbox link (SUPPORT_NAV in AppLayout) and is not
  // an admin as far as app-rpc is concerned, so asking for the approval
  // queue would be a guaranteed rejection on a loop.
  const canReadApprovals = role === 'admin';

  const refresh = useCallback(async () => {
    // Settled, not Promise.all: the two queues fail independently, and one
    // being unreachable must not take the other's badge down with it.
    await Promise.allSettled([
      (async () => {
        if (!canReadApprovals) {
          return;
        }

        try {
          const queue = await getAdminApprovalQueue();

          if (activeRef.current) {
            setApprovals(countPendingApplications(queue));
          }
        } catch {
          // Held deliberately. A count already on screen is stale, not
          // wrong, and dropping it would turn "we could not ask" into a
          // sidebar that looks exactly like a cleared queue -- the failure
          // this badge exists to prevent. Before any read has succeeded the
          // state is still null, so a first-load failure shows no badge
          // rather than a zero. Nothing here is surfaced to the operator:
          // the sidebar has no room for a banner, and the page they land on
          // reports its own failure with the detail.
        }
      })(),
      (async () => {
        try {
          const { conversations } = await getInbox({ status: 'open', scope: 'all' });

          if (activeRef.current) {
            setInbox(countOpenConversations(conversations));
          }
        } catch {
          // Same as above.
        }
      })(),
    ]);
  }, [canReadApprovals]);

  useEffect(() => {
    activeRef.current = true;
    void refresh();

    return () => {
      activeRef.current = false;
    };
  }, [refresh]);

  // Paused while the tab is hidden; returning to the foreground fires one
  // immediate catch-up read.
  useVisiblePolling(() => void refresh(), POLL_INTERVAL_MS, isVisible);

  const value = useMemo<NavCounts>(
    () => ({ approvals: canReadApprovals ? approvals : null, inbox }),
    [approvals, canReadApprovals, inbox]
  );

  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>;
}

/**
 * Unlike useSnapshot this does not throw when unprovided: the counts are a
 * hint, and a sidebar is not worth taking the console down over. Outside the
 * provider every link simply renders unbadged, exactly as before.
 */
export function useNavCounts(): NavCounts {
  return useContext(NavCountsContext);
}

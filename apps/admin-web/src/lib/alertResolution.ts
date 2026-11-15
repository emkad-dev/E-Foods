/** The fields of an operational alert this module reads. */
export type ResolvableAlert = { id: string; resolvedAt?: string | null };

export const isAlertResolved = (alert: ResolvableAlert): boolean =>
  typeof alert.resolvedAt === 'string' && alert.resolvedAt.length > 0;

/**
 * The alert list once `resolved` has come back from the server, without
 * waiting for the next read: the row is replaced by the server's copy, and
 * dropped altogether when the list is showing open alerts only. Otherwise a
 * just-resolved alert would sit in an "open" list until the next poll, which
 * is the stale-button feeling this page was fixed for.
 */
export const alertsAfterResolve = <T extends ResolvableAlert>(
  alerts: readonly T[],
  resolved: T,
  showResolved: boolean
): T[] =>
  alerts.flatMap((alert) => {
    if (alert.id !== resolved.id) {
      return [alert];
    }
    return showResolved || !isAlertResolved(resolved) ? [resolved] : [];
  });

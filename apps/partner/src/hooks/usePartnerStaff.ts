import { useCallback, useEffect, useRef, useState } from 'react';
import { openStaffInvites, type StaffInvite, type StaffMember } from '../domain/staffInvites';
import { getPartnerStaff } from '../services/partnerStaff';

/**
 * Who can act for this restaurant, and who has been asked to.
 *
 * Fetched once per mount and re-fetched only after the owner changes
 * something. No polling: app-rpc invocations are this project's measured cost
 * driver (2026-07-29 -- payload size is noise, invocation count is not), and a
 * staff list changes a handful of times a year. Nothing here is time-critical
 * enough to justify a background timer on a screen an owner leaves open.
 *
 * No realtime channel either: `StaffInvite` and `UserAccount` are served
 * through service-role handlers and have no client-readable RLS policy, so a
 * subscription would be a silent no-op of exactly the kind this repo has
 * already shipped once.
 */
export const usePartnerStaff = () => {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * "Did a fetch ever succeed?" -- `staff.length === 0` cannot answer it, and
   * "No one else has access yet" is a CLAIM ABOUT THE RESTAURANT that a failed
   * request has not earned the right to make. An owner shown that sentence
   * after a network blip would conclude a staff member had been removed.
   */
  const [loaded, setLoaded] = useState(false);

  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    try {
      const page = await getPartnerStaff();

      if (!mountedRef.current) {
        return;
      }

      setStaff(page.staff ?? []);
      setInvites(page.invites ?? []);
      setLoaded(true);
      setError(null);
    } catch (nextError: any) {
      if (!mountedRef.current) {
        return;
      }

      // Rows already on screen are kept. A refresh that failed after a
      // successful revoke must not blank the list the owner is working in.
      setError(nextError?.message ?? 'Unable to load your team right now.');
    } finally {
      inFlightRef.current = false;

      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();

    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return {
    error,
    invites: openStaffInvites(invites),
    loaded,
    loading,
    /** Call after any mutation. The server is the authority on what changed. */
    refresh: load,
    staff,
  };
};

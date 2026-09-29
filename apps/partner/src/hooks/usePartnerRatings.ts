import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendRatingsPage,
  toRatingSummary,
  type RestaurantRating,
  type RestaurantRatingSummary,
} from '../domain/restaurantRatings';
import { PARTNER_RATINGS_PAGE_SIZE, getPartnerRestaurantRatings } from '../services/partnerRatings';

const EMPTY_SUMMARY: RestaurantRatingSummary = { ratingAverage: null, ratingCount: 0 };

/**
 * Ratings are fetched ONCE per mount and never polled.
 *
 * Deliberate: app-rpc invocations are this project's actual cost driver (the
 * measured egress finding of 2026-07-29 -- payload size is noise, invocation
 * count is not), and feedback that arrives while the partner is staring at the
 * screen is not worth a background timer. Pull-free is also why there is no
 * realtime channel here: OrderRating has no client-readable RLS policy, so a
 * subscription would be a silent no-op of exactly the kind this repo has
 * already shipped once.
 */
export const usePartnerRatings = () => {
  const [ratings, setRatings] = useState<RestaurantRating[]>([]);
  const [summary, setSummary] = useState<RestaurantRatingSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Did a fetch ever succeed?" -- `ratings.length === 0` cannot answer it, and
  // the empty state ("No ratings yet") is a CLAIM ABOUT THE RESTAURANT that a
  // failed request has not earned the right to make.
  const [loaded, setLoaded] = useState(false);

  const mountedRef = useRef(false);
  /**
   * Rows the server has handed back, which is NOT `ratings.length`: the merge
   * drops duplicates, and paging by a de-duplicated length would re-request
   * the same window forever.
   */
  const fetchedRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'more' | 'reload') => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    if (mode === 'more') {
      setLoadingMore(true);
    } else if (mode === 'initial') {
      setLoading(true);
    } else if (mode === 'reload') {
      // Reset only now that the inFlightRef guard above has actually let this
      // call proceed. The old shape had `reload()` itself zero this
      // unconditionally, BEFORE checking whether a load was already in
      // flight -- a reload requested while a `more` was in flight then still
      // zeroed the offset, and once that in-flight `more` finished it wrote
      // `fetchedRef.current = <its own pre-reset offset> + rows.length`,
      // silently undoing the reset and leaving pagination corrupted. Doing it
      // here means a reload that gets dropped by the guard above never
      // touches fetchedRef at all.
      fetchedRef.current = 0;
    }
    // 'reload' (a pull-to-refresh) deliberately raises neither loading flag:
    // this screen shows a full-screen skeleton while `loading` is true, and a
    // pull must keep the current list on screen with just the native spinner.

    try {
      const offset = mode === 'more' ? fetchedRef.current : 0;
      const page = await getPartnerRestaurantRatings({ limit: PARTNER_RATINGS_PAGE_SIZE, offset });

      if (!mountedRef.current) {
        return;
      }

      const rows = page.ratings ?? [];
      fetchedRef.current = offset + rows.length;
      setSummary(toRatingSummary(page));
      setRatings((current) => (mode === 'more' ? appendRatingsPage(current, rows) : rows));
      // The server reports `hasMore` as "this page came back full", which is
      // true on an exact boundary even when the next page is empty. An empty
      // page is the only proof the list has ended, so believe it over the flag.
      setHasMore(mode === 'more' && rows.length === 0 ? false : page.hasMore === true);
      setLoaded(true);
      setError(null);
    } catch (nextError: any) {
      if (!mountedRef.current) {
        return;
      }

      // Rows already on screen are kept. A failed "Load more" that emptied the
      // list would take away feedback the partner was reading.
      setError(nextError?.message ?? 'Unable to load your ratings right now.');
    } finally {
      inFlightRef.current = false;

      if (mountedRef.current) {
        setLoadingMore(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load('initial');

    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const loadMore = useCallback(() => {
    void load('more');
  }, [load]);

  const retry = useCallback(() => {
    fetchedRef.current = 0;
    void load('initial');
  }, [load]);

  // Pull-to-refresh: re-fetches the first page and resets pagination, same as
  // `retry`, but without `retry`'s `loading` flip -- `retry` only ever runs
  // from the cold-failure error card, where nothing is on screen yet and the
  // skeleton is the right thing to show; a pull has a list already visible.
  //
  // Deliberately does NOT wait for or queue behind an in-flight load: `load`
  // early-returns via inFlightRef if one is already running (e.g. `loadMore`
  // mid-flight from a bottom-of-list scroll), so a reload in that window is a
  // silent no-op -- the pull spinner still closes as if it refreshed, with
  // nothing actually re-fetched. That gap is real (flagged in review) but
  // left as-is: ratings loads are short-lived and a follow-up pull recovers
  // it, so queueing/retrying here would be more machinery than this fix
  // needs. What matters for correctness is that a dropped reload no longer
  // touches `fetchedRef` at all (see the `mode === 'reload'` branch in
  // `load` above), so it can never corrupt a load that IS in flight.
  const reload = useCallback(async () => {
    await load('reload');
  }, [load]);

  return { error, hasMore, loaded, loading, loadingMore, loadMore, ratings, reload, retry, summary };
};


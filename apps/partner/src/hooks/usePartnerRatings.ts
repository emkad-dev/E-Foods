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

  const load = useCallback(async (mode: 'initial' | 'more') => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    if (mode === 'more') {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

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

  return { error, hasMore, loaded, loading, loadingMore, loadMore, ratings, retry, summary };
};


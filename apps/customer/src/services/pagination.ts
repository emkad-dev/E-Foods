/**
 * Follows a cursor-paginated fetcher until exhausted and concatenates every
 * page. Pure (no Expo/Supabase imports) so it's unit-testable under plain
 * Node — see pagination.test.ts.
 *
 * Used by publicRestaurantReadModel.ts's getRestaurantList so 50 (the
 * server's page size) is a transfer chunk, not a visible cap: without this,
 * a catalog past 50 restaurants would silently lose everything after the
 * first page from every screen that calls getRestaurantList — no error, no
 * loading state, just missing restaurants (and, via CoverageContext, a
 * possibly-wrong nearestOrderableKm) with no way for a user action to
 * surface it.
 */

export type Page<T> = {
  restaurants: T[];
  nextCursor: string | null;
};

export type FetchPage<T> = (cursor: string | undefined) => Promise<Page<T>>;

// Safety net only, not an expected ceiling: at the server's 50/page, this
// covers a 2,000-restaurant catalog, an order of magnitude past anything
// this platform operates at. Its purpose is purely to turn a hypothetical
// server bug (a nextCursor that never actually advances) into a bounded loop
// instead of an infinite one — it should never be hit in practice.
const MAX_PAGES = 40;

/**
 * Fetches every page via `fetchPage`, starting with an undefined cursor and
 * following each response's `nextCursor` until it comes back null. Tolerates
 * a page coming back empty even though the caller expected more — the
 * server's paginateRestaurants treats an unrecognized cursor (e.g. the row a
 * cursor pointed at was deleted or unpublished between calls) as exhausted,
 * so an empty page always means "stop", never "retry this cursor".
 */
export const fetchAllPages = async <T>(fetchPage: FetchPage<T>): Promise<T[]> => {
  const all: T[] = [];
  let cursor: string | undefined;

  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const page = await fetchPage(cursor);
    all.push(...page.restaurants);

    if (!page.nextCursor || page.restaurants.length === 0) {
      break;
    }

    cursor = page.nextCursor;
  }

  return all;
};

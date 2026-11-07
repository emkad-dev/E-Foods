/**
 * The state machine behind `AddressSearchField`: when to ask for suggestions,
 * which answer to believe, and what the list shows. Kept free of React and
 * React Native so `node --test` drives it with fake timers.
 *
 * Rules it owns:
 *  - nothing is sent under 3 characters (the shared gate in
 *    packages/runtime/src/addressSearch.ts), and only after a ~400 ms pause;
 *  - a new keystroke cancels the pending timer AND aborts the request already
 *    in flight, so an older, slower answer can never replace a newer one;
 *  - a failing Worker becomes `unavailable`, which is where the screen offers
 *    the one-shot "Search the map" fallback. That fallback runs only from an
 *    explicit `searchMap()` call (a button press), never from typing, because
 *    Nominatim's policy forbids autocomplete-style traffic.
 */
import {
  ADDRESS_SEARCH_MAX_RESULTS,
  normalizeSearchQuery,
  type AddressSearchResult,
  type AddressSuggestion,
} from '../../../runtime/src/addressSearch.ts';
import { NOMINATIM_MIN_QUERY_LENGTH } from '../../../runtime/src/nominatimSearch.ts';

export type { AddressSuggestion };

export const SUGGESTION_DEBOUNCE_MS = 400;

/**
 * Whether "Search the map" can run for this query. The map search refuses
 * anything under four characters, so offering the button for "Yab" would end
 * in "nothing found" for a reason the customer cannot see; the field asks for
 * more detail instead.
 */
export const canSearchMapFor = (query: string | null | undefined): boolean =>
  typeof query === 'string' && query.trim().length >= NOMINATIM_MIN_QUERY_LENGTH;

export type SuggestionSearch = (query: string, options: { signal: AbortSignal }) => Promise<AddressSearchResult>;

/** What the one-shot fallback found. `failed` is every service on the path refusing or erroring. */
export type MapSearchOutcome = { kind: 'results'; results: AddressSuggestion[] } | { kind: 'failed' };

export type MapSearch = (query: string) => Promise<MapSearchOutcome>;

export type SuggestionView =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'results'; query: string; results: AddressSuggestion[] }
  | { kind: 'empty'; query: string }
  | { kind: 'unavailable'; query: string }
  | { kind: 'map-loading'; query: string }
  | { kind: 'map-results'; query: string; results: AddressSuggestion[] }
  | { kind: 'map-empty'; query: string }
  | { kind: 'map-failed'; query: string };

export type SuggestionTimers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type SuggestionControllerOptions = {
  search: SuggestionSearch;
  searchMap?: MapSearch;
  onChange: (view: SuggestionView) => void;
  debounceMs?: number;
  timers?: SuggestionTimers;
};

export type SuggestionController = {
  /** The field's text changed. */
  update: (text: string) => void;
  /** Run the one-shot fallback for the current query. Ignored without one. */
  searchMap: () => void;
  /** Close the list and cancel everything (after a pick, or on clear). */
  reset: () => void;
  dispose: () => void;
  getView: () => SuggestionView;
};

const defaultTimers: SuggestionTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const createSuggestionController = ({
  search,
  searchMap,
  onChange,
  debounceMs = SUGGESTION_DEBOUNCE_MS,
  timers = defaultTimers,
}: SuggestionControllerOptions): SuggestionController => {
  let view: SuggestionView = { kind: 'idle' };
  let query: string | null = null;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  // Bumped by every change of intent; an answer that comes back under an older
  // generation is stale and is dropped.
  let generation = 0;
  let disposed = false;

  const setView = (next: SuggestionView) => {
    if (disposed) {
      return;
    }
    view = next;
    onChange(next);
  };

  const cancelPending = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    inFlight?.abort();
    inFlight = null;
  };

  const run = async (runQuery: string, runGeneration: number) => {
    timer = null;
    const controller = new AbortController();
    inFlight = controller;
    setView({ kind: 'loading', query: runQuery });

    let result: AddressSearchResult;
    try {
      result = await search(runQuery, { signal: controller.signal });
    } catch {
      // The shared client never rejects; a custom one might. Same as a failure.
      result = { kind: 'unavailable', reason: 'network' };
    }

    if (runGeneration !== generation || controller.signal.aborted) {
      return;
    }
    inFlight = null;

    if (result.kind === 'unavailable') {
      setView({ kind: 'unavailable', query: runQuery });
      return;
    }

    const results = result.results.slice(0, ADDRESS_SEARCH_MAX_RESULTS);
    setView(results.length > 0 ? { kind: 'results', query: runQuery, results } : { kind: 'empty', query: runQuery });
  };

  return {
    update: (text) => {
      if (disposed) {
        return;
      }

      const next = normalizeSearchQuery(text);

      // Whitespace or case-preserving no-ops ("Bodija " -> "Bodija") must not
      // re-send or flash the list.
      if (next !== null && next === query && view.kind !== 'idle') {
        return;
      }

      generation += 1;
      cancelPending();
      query = next;

      // Map-search rows (or its spinner) answer the text as it was when the
      // button was pressed; once the text moves on they would be misleading.
      // Plain suggestions stay up during the pause so the list does not flicker.
      if (next === null || view.kind.startsWith('map-')) {
        setView({ kind: 'idle' });
      }

      if (next === null) {
        return;
      }

      const runGeneration = generation;
      timer = timers.set(() => {
        void run(next, runGeneration);
      }, debounceMs);
    },

    searchMap: () => {
      if (disposed || !searchMap || !canSearchMapFor(query) || query === null || view.kind === 'map-loading') {
        return;
      }

      generation += 1;
      cancelPending();
      const mapQuery = query;
      const mapGeneration = generation;
      setView({ kind: 'map-loading', query: mapQuery });

      void (async () => {
        let outcome: MapSearchOutcome;
        try {
          outcome = await searchMap(mapQuery);
        } catch {
          outcome = { kind: 'failed' };
        }

        if (mapGeneration !== generation) {
          return;
        }

        if (outcome.kind === 'failed') {
          setView({ kind: 'map-failed', query: mapQuery });
          return;
        }

        const results = outcome.results.slice(0, ADDRESS_SEARCH_MAX_RESULTS);
        setView(
          results.length > 0
            ? { kind: 'map-results', query: mapQuery, results }
            : { kind: 'map-empty', query: mapQuery }
        );
      })();
    },

    reset: () => {
      generation += 1;
      cancelPending();
      query = null;
      setView({ kind: 'idle' });
    },

    dispose: () => {
      generation += 1;
      cancelPending();
      disposed = true;
    },

    getView: () => view,
  };
};

/** The rows a view lists, for selection and keyboard movement. */
export const selectableResults = (view: SuggestionView): AddressSuggestion[] =>
  view.kind === 'results' || view.kind === 'map-results' ? view.results : [];

/**
 * Arrow-key movement through the list. -1 is "nothing highlighted"; moving
 * down from there lands on the first row, up from the first returns to the
 * field, and the ends do not wrap (wrapping hides where the list stops).
 */
export const moveHighlight = (current: number, direction: 'up' | 'down', count: number): number => {
  if (count <= 0) {
    return -1;
  }
  if (direction === 'down') {
    return Math.min(count - 1, current + 1);
  }
  return current <= 0 ? -1 : current - 1;
};

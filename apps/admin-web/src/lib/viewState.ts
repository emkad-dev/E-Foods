/**
 * Resolves the four mutually exclusive outcomes a data-backed surface can be
 * in. The admin console previously rendered several of them at once: a
 * skeleton as a *sibling* of a fully rendered body, whose empty states only
 * ever consulted `length === 0`. The result was a confident dashboard
 * asserting "0 orders", "Revenue NGN 0" and "Queue is clear" while the fetch
 * was still in flight -- and permanently after a failed fetch, because
 * SnapshotContext keeps its EMPTY_SNAPSHOT on the catch path.
 *
 * The rule the console now follows: an empty state is a claim about the
 * business, so it may only be made about data that actually arrived.
 */
export type ViewState = 'loading' | 'error' | 'empty' | 'ready';

export interface ViewStateInput {
  /**
   * True once a fetch has succeeded, so the rendered rows are real. This, not
   * `loading`, is the load-bearing input: both hooks here settle `loading` to
   * false whether the read succeeded or threw, so `!loading` cannot tell an
   * empty platform from an unreachable one.
   */
  hasData: boolean;
  /** Message from the most recent failed fetch, or null. */
  error: string | null;
  /**
   * Whether the arrived data is empty for this particular panel. Omitted by
   * page-level callers, which only need to know whether a body may render.
   */
  isEmpty?: boolean;
}

export function resolveViewState({ hasData, error, isEmpty }: ViewStateInput): ViewState {
  // No successful fetch yet, so nothing truthful can be said about the data.
  // A known failure outranks the spinner: neither SnapshotContext nor
  // usePolledRpc flips `loading` back to true on a retry, so keeping the
  // skeleton would shimmer forever behind the banner. Absent an error we
  // report `loading` even if the request is no longer in flight -- "we have
  // not loaded anything" must never be presented as "there is nothing".
  if (!hasData) {
    return error !== null ? 'error' : 'loading';
  }

  // Real data is in hand. A later refresh failing (error set) or being in
  // flight must not blank a dashboard that is already correct; the error
  // banner renders above the body in that case.
  return isEmpty === true ? 'empty' : 'ready';
}

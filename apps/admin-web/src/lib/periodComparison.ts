import { formatDeltaPercent } from './format.ts';

/**
 * Prior-period comparison for the range-filtered figures on Overview and
 * Statistics.
 *
 * A bare number on an operations dashboard is decoration: "Revenue ₦840,000"
 * does not tell an operator whether to act. The comparison that makes it
 * actionable is the same window, one window earlier -- and the admin snapshot
 * already carries the whole order and user history, so that figure is a
 * client-side filter away, with no extra backend read.
 *
 * What this module exists to prevent is the *fabricated* comparison. Two ways a
 * prior-period figure can be a lie:
 *
 * 1. Unequal windows. A current window bounded at `now` compared against a
 *    previous window bounded at a calendar midnight is not a comparison, it is
 *    a ratio of two different durations. `buildPeriodWindows` therefore emits
 *    two exactly-equal, contiguous, half-open windows.
 *
 * 2. A previous window that predates the data. If the platform's first record
 *    is 20 days old and the range is 30 days, the previous window is 30 days of
 *    nothing -- and "0 last period" is not a measurement, it is the absence of
 *    one. Rendering "New activity" or "+400%" off it invents a trend.
 *    `coversPreviousWindow` is the gate that turns that case into an honest
 *    caption instead of a delta.
 */

export interface PeriodWindows {
  /** Inclusive start of the window being displayed. */
  currentStart: Date;
  /** Exclusive end of the current window: `now`. */
  currentEnd: Date;
  /** Inclusive start of the equal-length window immediately before it. */
  previousStart: Date;
  /** Exclusive end of the previous window; identical to `currentStart`. */
  previousEnd: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Callers pass `RangeDays` (7 | 30 | 90), so this only guards against a value
 * arriving from outside that union -- a parsed query param, say. Zero or NaN
 * would otherwise collapse both windows onto the same instant and make every
 * comparison read "No change", which is a false statement rather than a
 * missing one; one day is the smallest window that can still be measured.
 */
const normalizeRangeDays = (rangeDays: number) => (Number.isFinite(rangeDays) && rangeDays > 0 ? rangeDays : 1);

/**
 * Two contiguous, equal-length, half-open windows ending at `now`.
 *
 * Deliberately rolling (exact millisecond spans) rather than snapped to local
 * calendar days. Snapping would make the two windows unequal across a DST
 * transition -- one of them 23 or 25 hours long -- and an operator comparing a
 * 719-hour window against a 721-hour one is reading a delta that partly
 * measures the clock. It also matches `computeDashboardKpis`, so the deltas
 * derived here and the ones it already returns describe the same two windows.
 */
export const buildPeriodWindows = (rangeDays: number, now = new Date()): PeriodWindows => {
  const span = normalizeRangeDays(rangeDays) * DAY_MS;
  const currentEnd = new Date(now.getTime());
  const currentStart = new Date(currentEnd.getTime() - span);

  return {
    currentStart,
    currentEnd,
    previousStart: new Date(currentEnd.getTime() - 2 * span),
    previousEnd: currentStart,
  };
};

/**
 * Half-open [start, end): an instant on the boundary belongs to exactly one of
 * two adjacent windows, so nothing is double-counted at `currentStart` and
 * nothing is dropped.
 */
export const isWithin = (date: Date | null, start: Date, end: Date): boolean =>
  date !== null && date.getTime() >= start.getTime() && date.getTime() < end.getTime();

export const filterWithin = <T>(items: T[], getDate: (item: T) => Date | null, start: Date, end: Date): T[] =>
  items.filter((item) => isWithin(getDate(item), start, end));

export const earliestDateIn = <T>(items: T[], getDate: (item: T) => Date | null): Date | null => {
  let earliest: Date | null = null;

  for (const item of items) {
    const date = getDate(item);

    if (date !== null && (earliest === null || date.getTime() < earliest.getTime())) {
      earliest = date;
    }
  }

  return earliest;
};

export const earlierOf = (left: Date | null, right: Date | null): Date | null => {
  if (left === null) return right;
  if (right === null) return left;
  return left.getTime() <= right.getTime() ? left : right;
};

/**
 * Whether the previous window sits entirely inside the span the loaded data can
 * actually speak for.
 *
 * `dataHorizon` is the oldest record the page holds -- for the admin snapshot,
 * the earlier of the first order and the first user account. Before it the
 * snapshot has nothing to say, and a count of zero there means "we cannot see"
 * rather than "it did not happen".
 *
 * Purged accounts and orders can only pull the horizon later, never earlier, so
 * the error this can make is suppressing a delta that was real -- never showing
 * one that is not.
 */
export const coversPreviousWindow = (dataHorizon: Date | null, windows: PeriodWindows): boolean =>
  dataHorizon !== null && dataHorizon.getTime() <= windows.previousStart.getTime();

/**
 * The subset of `KpiCard`'s props that carry a comparison, so a call site can
 * spread the result and get either a delta or an honest caption -- never a
 * delta computed against a window the data does not cover.
 */
export interface KpiComparisonProps {
  current?: number;
  previous?: number;
  caption?: string;
}

export const kpiComparison = (input: {
  current: number;
  previous: number;
  previousWindowCovered: boolean;
  /** Shown instead of a delta when the previous window predates the data. */
  fallbackCaption: string;
}): KpiComparisonProps =>
  input.previousWindowCovered
    ? { current: input.current, previous: input.previous }
    : { caption: input.fallbackCaption };

/**
 * Caption for a windowed total with no comparable prior window. It has to carry
 * both facts: the number is a total over the window (not, as KpiCard's default
 * would claim, a live count) and there is no earlier window to read it against.
 */
export const windowTotalCaption = (rangeDays: number) => `Window total · no prior ${rangeDays}d`;

/** The same statement as a sentence fragment, for figures that are plain text. */
export const noPriorWindowNote = (rangeDays: number) => `no prior ${rangeDays}d on record`;

const ARROWS = { up: '▲ ', down: '▼ ', flat: '' } as const;

/**
 * Trailing fragment for an inline figure -- the ones that are muted text rather
 * than a `KpiCard`, so they carry the arrow but none of the green/red, which is
 * the right call for a figure whose direction is not self-evidently good news.
 *
 * Zero-previous is `formatDeltaPercent`'s call and is left to it: a rise from
 * zero has no finite percentage, so it reads "New activity" rather than a
 * fictional +100%, and zero-to-zero reads "No change".
 */
export const comparisonText = (input: {
  current: number;
  previous: number;
  previousWindowCovered: boolean;
  fallback: string;
}): string => {
  if (!input.previousWindowCovered) {
    return input.fallback;
  }

  const { label, direction } = formatDeltaPercent(input.current, input.previous);
  return `${ARROWS[direction]}${label}`;
};

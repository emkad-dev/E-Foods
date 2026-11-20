/**
 * The console's date ranges, including ones with no fixed length.
 *
 * "All time" reaches back to the first record, so it is resolved to a day
 * count wherever window maths runs (resolveRangeDays). Every existing
 * calculation then keeps working on a plain number of days.
 *
 * Pure: no imports, so it runs under plain `node --test`.
 */

export type RangeDays = 7 | 30 | 90 | 182 | 365 | 'all';

export const RANGE_OPTIONS: { label: string; value: RangeDays }[] = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last 6 months', value: 182 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: 'all' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days covered by a range; "all" reaches back to the earliest record. */
export const resolveRangeDays = (range: RangeDays, earliest: Date | null, now = new Date()): number => {
  if (range !== 'all') {
    return range;
  }

  if (!earliest) {
    return 1;
  }

  return Math.max(1, Math.ceil((now.getTime() - earliest.getTime()) / DAY_MS) + 1);
};

/** Short form for tile labels: "30d", "6mo", "1y", "all time". */
export const rangeShortLabel = (range: RangeDays | number): string => {
  if (range === 'all') return 'all time';
  if (range === 365) return '1y';
  if (range === 182) return '6mo';
  return `${range}d`;
};

/** Sentence form: "the last 30 days", "the last 6 months", "all recorded history". */
export const rangePhrase = (range: RangeDays): string => {
  if (range === 'all') return 'all recorded history';
  if (range === 365) return 'the last year';
  if (range === 182) return 'the last 6 months';
  return `the last ${range} days`;
};

export type SeriesBucket = 'day' | 'week';

/** Above about four months a bar per day is unreadable, so charts go weekly. */
export const seriesBucket = (spanDays: number): SeriesBucket => (spanDays > 120 ? 'week' : 'day');

/** Local midnight of the day, or of the Monday that starts the week. */
export const bucketStart = (date: Date, bucket: SeriesBucket): Date => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (bucket === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  }
  return start;
};

/** Same key shape the daily series already used, so 'day' behaves exactly as before. */
export const bucketKey = (date: Date, bucket: SeriesBucket): string => bucketStart(date, bucket).toISOString().slice(0, 10);

/** Every bucket from (now - spanDays + 1) to now, oldest first. */
export const buildBuckets = (spanDays: number, now = new Date()): { key: string; start: Date }[] => {
  const bucket = seriesBucket(spanDays);
  const first = bucketStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (spanDays - 1)), bucket);
  const last = bucketStart(now, bucket);
  const step = bucket === 'week' ? 7 : 1;
  const buckets: { key: string; start: Date }[] = [];

  for (let cursor = first; cursor <= last; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + step)) {
    buckets.push({ key: cursor.toISOString().slice(0, 10), start: cursor });
  }

  return buckets;
};

export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 120;
export const MAX_LIMIT = 5;

export type ParsedSearch = { ok: true; q: string; limit: number } | { ok: false };

// Whitespace is collapsed so "  Allen   Avenue " and "Allen Avenue" are one
// query. Other control characters are refused rather than forwarded upstream.
export const parseSearchParams = (params: URLSearchParams): ParsedSearch => {
  const raw = params.get('q');
  if (raw === null) return { ok: false };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return { ok: false };
  const q = raw.trim().replace(/\s+/g, ' ');
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) return { ok: false };

  const limitRaw = params.get('limit');
  let limit = MAX_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d{1,2}$/.test(limitRaw)) return { ok: false };
    limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) return { ok: false };
  }
  return { ok: true, q, limit };
};

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Whole amounts show no kobo (₦9,500); any other amount shows both kobo
 * digits (₦6,938.40). The single formatter this replaced allowed 0 to 2
 * fraction digits, so a sum of marked-up prices rendered as "₦6,938.4" --
 * read in the running console on the Orders totals.
 */
export const formatCurrency = (amount: number, currency = 'NGN') => {
  const code = currency?.trim().toUpperCase() || 'NGN';
  const whole = Number.isInteger(Math.round(amount * 100) / 100);
  const key = `${code}:${whole ? 0 : 2}`;
  let formatter = currencyFormatters.get(key);

  if (!formatter) {
    const digits = whole ? 0 : 2;
    try {
      formatter = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
    } catch {
      formatter = new Intl.NumberFormat('en-NG', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    }

    currencyFormatters.set(key, formatter);
  }

  return formatter.format(amount);
};

export const formatNumber = (value: number) => new Intl.NumberFormat('en-NG').format(value);

export const parseTimestamp = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

export const formatDateTime = (value: unknown) => {
  const parsed = parseTimestamp(value);

  if (!parsed) {
    return '—';
  }

  return parsed.toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatDeltaPercent = (current: number, previous: number): { label: string; direction: 'up' | 'down' | 'flat' } => {
  if (previous === 0) {
    if (current === 0) {
      return { label: 'No change', direction: 'flat' };
    }

    return { label: 'New activity', direction: 'up' };
  }

  const pct = ((current - previous) / previous) * 100;

  if (Math.abs(pct) < 0.5) {
    return { label: 'No change', direction: 'flat' };
  }

  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return {
    label: `${pct > 0 ? '+' : ''}${rounded}% vs previous period`,
    direction: pct > 0 ? 'up' : 'down',
  };
};

export const humanizeStatus = (value?: string | null) => {
  const normalized = (value ?? '').trim();

  if (!normalized) {
    return 'Unknown';
  }

  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

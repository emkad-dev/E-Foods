const currencyFormatters = new Map<string, Intl.NumberFormat>();

export const formatCurrency = (amount: number, currency = 'NGN') => {
  const code = currency?.trim().toUpperCase() || 'NGN';
  let formatter = currencyFormatters.get(code);

  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      });
    } catch {
      formatter = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
    }

    currencyFormatters.set(code, formatter);
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

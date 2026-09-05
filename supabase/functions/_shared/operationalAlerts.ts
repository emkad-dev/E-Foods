import { serviceClient } from './client.ts';
import { nowIso, parseInteger, sanitizeOptionalText, sanitizeText, type JsonObject } from './rpc/coercion.ts';

export const OPERATIONAL_ALERT_COLUMNS = [
  'id',
  'dedupeKey',
  'alertType',
  'severity',
  'subjectType',
  'subjectId',
  'title',
  'details',
  'metadata',
  'createdAt',
  'updatedAt',
].join(',');

export const OPERATIONAL_ALERT_SEVERITIES = ['low', 'medium', 'high'] as const;
export type OperationalAlertSeverity = (typeof OPERATIONAL_ALERT_SEVERITIES)[number];

export type OperationalAlertRow = {
  alertType: string;
  createdAt: string;
  dedupeKey: string;
  details: string;
  id: string;
  metadata: JsonObject;
  severity: OperationalAlertSeverity;
  subjectId: string;
  subjectType: string;
  title: string;
  updatedAt: string;
};

export type RecordOperationalAlertInput = {
  alertType: string;
  details: string;
  dedupeKey: string;
  metadata?: JsonObject;
  severity: OperationalAlertSeverity;
  subjectId: string;
  subjectType: string;
  title: string;
};

export type LoadOperationalAlertsInput = {
  alertType?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
  severity?: OperationalAlertSeverity | string | null;
  subjectId?: string | null;
  subjectType?: string | null;
};

type OperationalAlertUpsertRow = Omit<OperationalAlertRow, 'id'>;

type AlertWindow = {
  endsAt: string;
  startsAt: string;
};

type OperationalAlertClient = {
  from: (table: string) => {
    select?: (...args: any[]) => any;
    upsert: (...args: any[]) => any;
  };
};

const OPERATIONAL_ALERT_SEVERITY_RANK: Record<OperationalAlertSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const isOperationalAlertSeverity = (value: unknown): value is OperationalAlertSeverity =>
  typeof value === 'string' && (OPERATIONAL_ALERT_SEVERITIES as readonly string[]).includes(value);

const normalizeMetadata = (value: unknown): JsonObject => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
};

const normalizeOperationalAlertRow = (row: unknown): OperationalAlertRow | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const record = row as Record<string, unknown>;
  const severity = isOperationalAlertSeverity(record.severity) ? record.severity : 'low';

  return {
    alertType: sanitizeText(record.alertType),
    createdAt: sanitizeText(record.createdAt, nowIso()),
    dedupeKey: sanitizeText(record.dedupeKey),
    details: sanitizeText(record.details),
    id: sanitizeText(record.id),
    metadata: normalizeMetadata(record.metadata),
    severity,
    subjectId: sanitizeText(record.subjectId),
    subjectType: sanitizeText(record.subjectType),
    title: sanitizeText(record.title),
    updatedAt: sanitizeText(record.updatedAt, sanitizeText(record.createdAt, nowIso())),
  };
};

const sortOperationalAlerts = (alerts: OperationalAlertRow[]) =>
  [...alerts].sort((a, b) => {
    const severityDelta = OPERATIONAL_ALERT_SEVERITY_RANK[b.severity] - OPERATIONAL_ALERT_SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const updatedDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const createdDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    return a.id.localeCompare(b.id);
  });

const buildWindow = (windowMs: number): AlertWindow => {
  const endsAt = nowIso();
  const startsAt = new Date(Date.parse(endsAt) - windowMs).toISOString();
  return { startsAt, endsAt };
};

const buildAlert = (input: RecordOperationalAlertInput): OperationalAlertUpsertRow => {
  const now = nowIso();
  return {
    alertType: sanitizeText(input.alertType),
    createdAt: now,
    dedupeKey: sanitizeText(input.dedupeKey),
    details: sanitizeText(input.details),
    metadata: normalizeMetadata(input.metadata),
    severity: isOperationalAlertSeverity(input.severity) ? input.severity : 'low',
    subjectId: sanitizeText(input.subjectId),
    subjectType: sanitizeText(input.subjectType),
    title: sanitizeText(input.title),
    updatedAt: now,
  };
};

export const recordOperationalAlert = async (
  input: RecordOperationalAlertInput,
  client: OperationalAlertClient = serviceClient
): Promise<OperationalAlertUpsertRow | null> => {
  const row = buildAlert(input);

  try {
    const { error } = await client.from('OperationalAlert').upsert(row, { onConflict: 'dedupeKey' });
    if (error) {
      console.error('OperationalAlert persistence failed', error);
      return null;
    }
    return row;
  } catch (error) {
    console.error('OperationalAlert persistence failed', error);
    return null;
  }
};

export const loadOperationalAlerts = async (
  input: LoadOperationalAlertsInput = {},
  client: OperationalAlertClient = serviceClient
): Promise<OperationalAlertRow[]> => {
  let query = client.from('OperationalAlert').select?.(OPERATIONAL_ALERT_COLUMNS) ?? client.from('OperationalAlert');

  const alertType = sanitizeOptionalText(input.alertType);
  const severity = isOperationalAlertSeverity(input.severity) ? input.severity : null;
  const subjectType = sanitizeOptionalText(input.subjectType);
  const subjectId = sanitizeOptionalText(input.subjectId);
  const offset = Math.max(0, parseInteger(input.offset, 0));
  const limit = Math.max(1, parseInteger(input.limit, 25));

  if (alertType) {
    query = query.eq('alertType', alertType);
  }
  if (severity) {
    query = query.eq('severity', severity);
  }
  if (subjectType) {
    query = query.eq('subjectType', subjectType);
  }
  if (subjectId) {
    query = query.eq('subjectId', subjectId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = sortOperationalAlerts(
    ((data ?? []) as unknown[]).map(normalizeOperationalAlertRow).filter((row): row is OperationalAlertRow => row !== null)
  );

  return rows.slice(offset, offset + limit);
};

const buildSeverity = (count: number, medium: number, high: number): OperationalAlertSeverity | null => {
  if (count >= high) {
    return 'high';
  }

  if (count >= medium) {
    return 'medium';
  }

  return null;
};

export const evaluatePaymentWebhookFailureAlert = (input: {
  orderId: string;
  paymentReference: string;
  reason: string;
  retryCount?: number | null;
}) => {
  const count = Math.max(0, Math.floor(parseInteger(input.retryCount, 0)));
  const severity = buildSeverity(count, 3, 5);
  if (!severity) {
    return { alerts: [] as OperationalAlertUpsertRow[] };
  }

  const window = buildWindow(60 * 60 * 1000);
  return {
    alerts: [
      buildAlert({
        alertType: 'payment_webhook_failure_rate',
        dedupeKey: `ops:payment_webhook_failure_rate:${sanitizeText(input.paymentReference)}:${window.startsAt}`,
        details: `Payment verification failed after ${count} attempts for order ${sanitizeText(input.orderId)}.`,
        metadata: {
          count,
          reason: sanitizeText(input.reason),
          window,
        },
        severity,
        subjectId: sanitizeText(input.paymentReference),
        subjectType: 'payment',
        title: 'Payment webhook failures rising',
      }),
    ],
  };
};

export const evaluateDispatchPoolEmptyAlert = (input: { orderId: string; restaurantId: string; availableCount: number }) => {
  if (parseInteger(input.availableCount, 0) > 0) {
    return { alerts: [] as OperationalAlertUpsertRow[] };
  }

  return {
    alerts: [
      buildAlert({
        alertType: 'dispatch_pool_empty',
        dedupeKey: `ops:dispatch_pool_empty:${sanitizeText(input.orderId)}`,
        details: `No available dispatch rider could be found for order ${sanitizeText(input.orderId)}.`,
        metadata: {
          availableCount: 0,
          restaurantId: sanitizeText(input.restaurantId),
        },
        severity: 'medium',
        subjectId: sanitizeText(input.orderId),
        subjectType: 'order',
        title: 'Dispatch pool empty',
      }),
    ],
  };
};

export const evaluateDispatchOffersExhaustedAlert = (input: { maxOffers: number; orderId: string; restaurantId: string }) => ({
  alerts: [
    buildAlert({
      alertType: 'dispatch_offers_exhausted',
      dedupeKey: `ops:dispatch_offers_exhausted:${sanitizeText(input.orderId)}`,
      details: `Every available rider declined or ignored order ${sanitizeText(input.orderId)}.`,
      metadata: {
        maxOffers: parseInteger(input.maxOffers, 0),
        restaurantId: sanitizeText(input.restaurantId),
      },
      severity: 'high',
      subjectId: sanitizeText(input.orderId),
      subjectType: 'order',
      title: 'Dispatch offers exhausted',
    }),
  ] as OperationalAlertUpsertRow[],
});

export const evaluateAcceptanceDeadlineAlert = (input: { orderId: string; restaurantId: string }) => ({
  alerts: [
    buildAlert({
      alertType: 'acceptance_deadline_escalated',
      dedupeKey: `ops:acceptance_deadline_escalated:${sanitizeText(input.orderId)}`,
      details: `Order ${sanitizeText(input.orderId)} has missed the acceptance deadline.`,
      metadata: {
        restaurantId: sanitizeText(input.restaurantId),
      },
      severity: 'medium',
      subjectId: sanitizeText(input.orderId),
      subjectType: 'order',
      title: 'Order awaiting acceptance',
    }),
  ] as OperationalAlertUpsertRow[],
});

const writeAlerts = async (alerts: OperationalAlertUpsertRow[], client: OperationalAlertClient = serviceClient) => {
  for (const alert of alerts) {
    try {
      const { error } = await client.from('OperationalAlert').upsert(alert, { onConflict: 'dedupeKey' });
      if (error) {
        console.error('OperationalAlert persistence failed', error);
      }
    } catch (error) {
      console.error('OperationalAlert persistence failed', error);
    }
  }
};

export const capturePaymentWebhookFailureAlert = async (input: {
  orderId: string;
  paymentReference: string;
  reason: string;
  retryCount?: number | null;
}, client: OperationalAlertClient = serviceClient) => {
  const alerts = evaluatePaymentWebhookFailureAlert(input).alerts;
  await writeAlerts(alerts, client);
  return alerts;
};

export const captureDispatchPoolEmptyAlert = async (input: {
  availableCount: number;
  orderId: string;
  restaurantId: string;
}, client: OperationalAlertClient = serviceClient) => {
  const alerts = evaluateDispatchPoolEmptyAlert(input).alerts;
  await writeAlerts(alerts, client);
  return alerts;
};

export const captureDispatchOffersExhaustedAlert = async (input: {
  maxOffers: number;
  orderId: string;
  restaurantId: string;
}, client: OperationalAlertClient = serviceClient) => {
  const alerts = evaluateDispatchOffersExhaustedAlert(input).alerts;
  await writeAlerts(alerts, client);
  return alerts;
};

export const captureAcceptanceDeadlineAlert = async (
  input: { orderId: string; restaurantId: string },
  client: OperationalAlertClient = serviceClient
) => {
  const alerts = evaluateAcceptanceDeadlineAlert(input).alerts;
  await writeAlerts(alerts, client);
  return alerts;
};

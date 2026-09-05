import { serviceClient } from './client.ts';
import {
  nowIso,
  parseInteger,
  sanitizeOptionalText,
  sanitizeText,
  toSortableTimestamp,
  type JsonObject,
} from './rpc/coercion.ts';

export const RISK_EVENT_COLUMNS = [
  'id',
  'dedupeKey',
  'eventType',
  'severity',
  'subjectType',
  'subjectId',
  'actorUid',
  'orderId',
  'score',
  'reason',
  'metadata',
  'createdAt',
  'updatedAt',
].join(',');

export const RISK_EVENT_SEVERITIES = ['low', 'medium', 'high'] as const;
export type RiskEventSeverity = (typeof RISK_EVENT_SEVERITIES)[number];

export type RiskEventRow = {
  actorUid: string | null;
  createdAt: string;
  dedupeKey: string;
  eventType: string;
  id: string;
  metadata: JsonObject;
  orderId: string | null;
  reason: string;
  score: number;
  severity: RiskEventSeverity;
  subjectId: string;
  subjectType: string;
  updatedAt: string;
};

export type RecordRiskEventInput = {
  actorUid?: string | null;
  dedupeKey: string;
  eventType: string;
  metadata?: JsonObject;
  orderId?: string | null;
  reason: string;
  score: number;
  severity: RiskEventSeverity;
  subjectId: string;
  subjectType: string;
};

type RiskEventUpsertRow = Omit<RiskEventRow, 'id'>;

export type LoadRiskEventsInput = {
  eventType?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
  severity?: RiskEventSeverity | string | null;
  subjectId?: string | null;
  subjectType?: string | null;
};

const RISK_EVENT_SEVERITY_RANK: Record<RiskEventSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const isRiskEventSeverity = (value: unknown): value is RiskEventSeverity =>
  typeof value === 'string' && (RISK_EVENT_SEVERITIES as readonly string[]).includes(value);

const normalizeMetadata = (value: unknown): JsonObject => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
};

const normalizeRiskEventRow = (row: unknown): RiskEventRow | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const record = row as Record<string, unknown>;
  const severity = isRiskEventSeverity(record.severity) ? record.severity : 'low';

  return {
    actorUid: sanitizeOptionalText(record.actorUid),
    createdAt: sanitizeText(record.createdAt, nowIso()),
    dedupeKey: sanitizeText(record.dedupeKey),
    eventType: sanitizeText(record.eventType),
    id: sanitizeText(record.id),
    metadata: normalizeMetadata(record.metadata),
    orderId: sanitizeOptionalText(record.orderId),
    reason: sanitizeText(record.reason),
    score: parseInteger(record.score, 0),
    severity,
    subjectId: sanitizeText(record.subjectId),
    subjectType: sanitizeText(record.subjectType),
    updatedAt: sanitizeText(record.updatedAt, sanitizeText(record.createdAt, nowIso())),
  };
};

const sortRiskEvents = (events: RiskEventRow[]) =>
  [...events].sort((a, b) => {
    const severityDelta = RISK_EVENT_SEVERITY_RANK[b.severity] - RISK_EVENT_SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const updatedDelta = toSortableTimestamp(b.updatedAt) - toSortableTimestamp(a.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const createdDelta = toSortableTimestamp(b.createdAt) - toSortableTimestamp(a.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    return a.id.localeCompare(b.id);
  });

export const recordRiskEvent = async (input: RecordRiskEventInput): Promise<RiskEventUpsertRow | null> => {
  const now = nowIso();
  const row: RiskEventUpsertRow = {
    actorUid: sanitizeOptionalText(input.actorUid),
    createdAt: now,
    dedupeKey: sanitizeText(input.dedupeKey),
    eventType: sanitizeText(input.eventType),
    metadata: normalizeMetadata(input.metadata),
    orderId: sanitizeOptionalText(input.orderId),
    reason: sanitizeText(input.reason),
    score: parseInteger(input.score, 0),
    severity: isRiskEventSeverity(input.severity) ? input.severity : 'low',
    subjectId: sanitizeText(input.subjectId),
    subjectType: sanitizeText(input.subjectType),
    updatedAt: now,
  };

  try {
    const { error } = await serviceClient.from('RiskEvent').upsert(row, { onConflict: 'dedupeKey' });
    if (error) {
      console.error('RiskEvent persistence failed', error);
      return null;
    }
    return row;
  } catch (error) {
    console.error('RiskEvent persistence failed', error);
    return null;
  }
};

export const loadRiskEvents = async (input: LoadRiskEventsInput = {}): Promise<RiskEventRow[]> => {
  let query = serviceClient.from('RiskEvent').select(RISK_EVENT_COLUMNS);

  const eventType = sanitizeOptionalText(input.eventType);
  const severity = isRiskEventSeverity(input.severity) ? input.severity : null;
  const subjectType = sanitizeOptionalText(input.subjectType);
  const subjectId = sanitizeOptionalText(input.subjectId);
  const offset = Math.max(0, parseInteger(input.offset, 0));
  const limit = Math.max(1, parseInteger(input.limit, 25));

  if (eventType) {
    query = query.eq('eventType', eventType);
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

  const rows = sortRiskEvents(
    ((data ?? []) as unknown[]).map(normalizeRiskEventRow).filter((row): row is RiskEventRow => row !== null)
  );

  const filtered = rows.filter((row) => {
    if (eventType && row.eventType !== eventType) {
      return false;
    }
    if (severity && row.severity !== severity) {
      return false;
    }
    if (subjectType && row.subjectType !== subjectType) {
      return false;
    }
    if (subjectId && row.subjectId !== subjectId) {
      return false;
    }
    return true;
  });

  return filtered.slice(offset, offset + limit);
};

export const loadRiskEventDetail = async (riskEventId: string | null | undefined): Promise<RiskEventRow | null> => {
  const id = sanitizeOptionalText(riskEventId);
  if (!id) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('RiskEvent')
    .select(RISK_EVENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeRiskEventRow(data);
};

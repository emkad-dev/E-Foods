import { serviceClient } from './client.ts';
import { recordRiskEvent } from './riskEvents.ts';
import { nowIso, parseInteger, parseNumber, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

type JsonObject = Record<string, unknown>;

const ORDER_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const REFUND_ABUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAYMENT_VELOCITY_WINDOW_MS = 60 * 60 * 1000;

export const RISK_SIGNAL_THRESHOLDS = {
  accountVelocity: { medium: 5, high: 8 },
  cardVelocity: { medium: 4, high: 6 },
  deviceVelocity: { medium: 8, high: 12 },
  paymentVerificationFailure: { medium: 3, high: 5 },
  refundAbuse: { medium: 3, high: 5 },
} as const;

export type RiskSignalSeverity = 'low' | 'medium' | 'high';

export type RiskSignalEvent = {
  actorUid?: string | null;
  dedupeKey: string;
  eventType: string;
  metadata: JsonObject;
  orderId?: string | null;
  reason: string;
  score: number;
  severity: RiskSignalSeverity;
  subjectId: string;
  subjectType: string;
};

type CustomerOrderSignalRow = {
  createdAt?: string | null;
  customerId: string;
  payment?: JsonObject | null;
  status?: string | null;
  updatedAt?: string | null;
};

type PaymentTransactionSignalRow = {
  createdAt?: string | null;
  customerId: string;
  orderId?: string | null;
  reference?: string | null;
  webhookEvent?: JsonObject | null;
};

type SignalWindow = {
  endsAt: string;
  startsAt: string;
};

const buildWindow = (windowMs: number): SignalWindow => {
  const endsAt = nowIso();
  const startsAt = new Date(Date.parse(endsAt) - windowMs).toISOString();
  return { endsAt, startsAt };
};

const buildSeverity = (count: number, medium: number, high: number): RiskSignalSeverity | null => {
  if (count >= high) {
    return 'high';
  }

  if (count >= medium) {
    return 'medium';
  }

  return null;
};

const buildRiskEvent = (input: {
  actorUid?: string | null;
  dedupeKey: string;
  eventType: string;
  metadata: JsonObject;
  orderId?: string | null;
  reason: string;
  score: number;
  severity: RiskSignalSeverity;
  subjectId: string;
  subjectType: string;
}): RiskSignalEvent => ({
  actorUid: sanitizeOptionalText(input.actorUid),
  dedupeKey: sanitizeText(input.dedupeKey),
  eventType: sanitizeText(input.eventType),
  metadata: input.metadata ?? {},
  orderId: sanitizeOptionalText(input.orderId),
  reason: sanitizeText(input.reason),
  score: Math.max(0, Math.floor(parseNumber(input.score, 0))),
  severity: sanitizeText(input.severity, 'low') as RiskSignalSeverity,
  subjectId: sanitizeText(input.subjectId),
  subjectType: sanitizeText(input.subjectType),
});

const extractDeviceSessionId = (payment: JsonObject | null | undefined) =>
  sanitizeText(payment?.deviceSessionId ?? payment?.deviceId ?? payment?.sessionId ?? payment?.deviceToken);

const extractAuthorizationCode = (webhookEvent: JsonObject | null | undefined) => {
  const authorization = webhookEvent?.authorization as JsonObject | null | undefined;
  const nestedAuthorization = (webhookEvent?.data as JsonObject | null | undefined)?.authorization as
    | JsonObject
    | null
    | undefined;

  return sanitizeText(
    authorization?.authorization_code ?? authorization?.authorizationCode ?? nestedAuthorization?.authorization_code ??
      nestedAuthorization?.authorizationCode
  );
};

const loadRecentCustomerOrders = async (customerId: string, startsAt: string, endsAt: string) => {
  const { data, error } = await serviceClient
    .from('CustomerOrder')
    .select('customerId,payment,status,createdAt,updatedAt')
    .eq('customerId', sanitizeText(customerId))
    .gte('createdAt', startsAt)
    .lt('createdAt', endsAt)
    .returns<CustomerOrderSignalRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CustomerOrderSignalRow[];
};

const loadRecentPaymentTransactions = async (customerId: string, startsAt: string, endsAt: string) => {
  const { data, error } = await serviceClient
    .from('PaymentTransaction')
    .select('customerId,orderId,reference,webhookEvent,createdAt')
    .eq('customerId', sanitizeText(customerId))
    .gte('createdAt', startsAt)
    .lt('createdAt', endsAt)
    .returns<PaymentTransactionSignalRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PaymentTransactionSignalRow[];
};

const writeRiskEvents = async (events: RiskSignalEvent[]) => {
  for (const event of events) {
    try {
      await recordRiskEvent(event);
    } catch (error) {
      console.error(
        `Failed to record risk event ${event.eventType} for ${event.subjectType}:${event.subjectId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
};

export const evaluateAccountVelocitySignals = (input: {
  customerId: string;
  orderCount: number;
  window: SignalWindow;
  orderId: string;
}) => {
  const severity = buildSeverity(
    parseInteger(input.orderCount, 0),
    RISK_SIGNAL_THRESHOLDS.accountVelocity.medium,
    RISK_SIGNAL_THRESHOLDS.accountVelocity.high
  );

  if (!severity) {
    return { events: [] as RiskSignalEvent[] };
  }

  const count = Math.max(0, Math.floor(parseNumber(input.orderCount, 0)));
  return {
    events: [
      buildRiskEvent({
        dedupeKey: `risk:account_velocity:${sanitizeText(input.customerId)}:${input.window.startsAt}`,
        eventType: 'account_velocity',
        metadata: { count, window: input.window },
        orderId: input.orderId,
        reason: `Placed ${count} orders in the last hour`,
        score: count,
        severity,
        subjectId: input.customerId,
        subjectType: 'account',
      }),
    ],
  };
};

export const evaluateDeviceVelocitySignals = (input: {
  deviceSessionId: string;
  orderCount: number;
  window: SignalWindow;
  orderId: string;
}) => {
  const severity = buildSeverity(
    parseInteger(input.orderCount, 0),
    RISK_SIGNAL_THRESHOLDS.deviceVelocity.medium,
    RISK_SIGNAL_THRESHOLDS.deviceVelocity.high
  );

  if (!severity) {
    return { events: [] as RiskSignalEvent[] };
  }

  const count = Math.max(0, Math.floor(parseNumber(input.orderCount, 0)));
  return {
    events: [
      buildRiskEvent({
        dedupeKey: `risk:device_velocity:${sanitizeText(input.deviceSessionId)}:${input.window.startsAt}`,
        eventType: 'device_velocity',
        metadata: { count, window: input.window },
        orderId: input.orderId,
        reason: `Device session submitted ${count} orders in the last hour`,
        score: count,
        severity,
        subjectId: input.deviceSessionId,
        subjectType: 'device',
      }),
    ],
  };
};

export const evaluateCardVelocitySignals = (input: {
  authorizationCode: string;
  orderCount: number;
  orderId: string;
  window: SignalWindow;
}) => {
  const severity = buildSeverity(
    parseInteger(input.orderCount, 0),
    RISK_SIGNAL_THRESHOLDS.cardVelocity.medium,
    RISK_SIGNAL_THRESHOLDS.cardVelocity.high
  );

  if (!severity) {
    return { events: [] as RiskSignalEvent[] };
  }

  const count = Math.max(0, Math.floor(parseNumber(input.orderCount, 0)));
  return {
    events: [
      buildRiskEvent({
        dedupeKey: `risk:card_velocity:${sanitizeText(input.authorizationCode)}:${input.window.startsAt}`,
        eventType: 'card_velocity',
        metadata: { count, window: input.window },
        orderId: input.orderId,
        reason: `The same card authorization was used ${count} times in the last hour`,
        score: count,
        severity,
        subjectId: input.authorizationCode,
        subjectType: 'card',
      }),
    ],
  };
};

export const evaluateRefundAbuseSignals = (input: {
  customerId: string;
  refundCount: number;
  orderId: string;
  window: SignalWindow;
}) => {
  const severity = buildSeverity(
    parseInteger(input.refundCount, 0),
    RISK_SIGNAL_THRESHOLDS.refundAbuse.medium,
    RISK_SIGNAL_THRESHOLDS.refundAbuse.high
  );

  if (!severity) {
    return { events: [] as RiskSignalEvent[] };
  }

  const count = Math.max(0, Math.floor(parseNumber(input.refundCount, 0)));
  return {
    events: [
      buildRiskEvent({
        dedupeKey: `risk:refund_abuse:${sanitizeText(input.customerId)}:${input.window.startsAt}`,
        eventType: 'refund_abuse',
        metadata: { count, window: input.window },
        orderId: input.orderId,
        reason: `Triggered ${count} refunds in the last 24 hours`,
        score: count,
        severity,
        subjectId: input.customerId,
        subjectType: 'account',
      }),
    ],
  };
};

export const evaluatePaymentVerificationFailureSignals = (input: {
  orderId: string;
  paymentReference: string;
  retryCount: number;
  reason: string;
}) => {
  const severity = buildSeverity(
    parseInteger(input.retryCount, 0),
    RISK_SIGNAL_THRESHOLDS.paymentVerificationFailure.medium,
    RISK_SIGNAL_THRESHOLDS.paymentVerificationFailure.high
  );

  if (!severity) {
    return { events: [] as RiskSignalEvent[] };
  }

  const count = Math.max(0, Math.floor(parseNumber(input.retryCount, 0)));
  return {
    events: [
      buildRiskEvent({
        dedupeKey: `risk:payment_verification_failure:${sanitizeText(input.orderId)}:${sanitizeText(input.paymentReference)}`,
        eventType: 'payment_verification_failure',
        metadata: { count, reason: input.reason },
        orderId: input.orderId,
        reason: `Payment verification failed after ${count} attempts`,
        score: count,
        severity,
        subjectId: input.paymentReference,
        subjectType: 'payment',
      }),
    ],
  };
};

export const evaluatePaymentVerificationReplaySignals = (input: {
  orderId: string;
  paymentReference: string;
}) => ({
  events: [
    buildRiskEvent({
      dedupeKey: `risk:payment_verification_replay:${sanitizeText(input.orderId)}:${sanitizeText(input.paymentReference)}`,
      eventType: 'payment_verification_replay',
      metadata: {},
      orderId: input.orderId,
      reason: 'Payment verification repeated after the order was already marked paid',
      score: 1,
      severity: 'medium',
      subjectId: input.paymentReference,
      subjectType: 'payment',
    }),
  ] as RiskSignalEvent[],
});

export const captureOrderPlacementRiskSignals = async (input: {
  customerId: string;
  deviceSessionId?: string | null;
  orderId: string;
}) => {
  const window = buildWindow(ORDER_VELOCITY_WINDOW_MS);
  const recentOrders = await loadRecentCustomerOrders(input.customerId, window.startsAt, window.endsAt);
  const events: RiskSignalEvent[] = [
    ...evaluateAccountVelocitySignals({
      customerId: input.customerId,
      orderCount: recentOrders.length,
      orderId: input.orderId,
      window,
    }).events,
  ];

  const deviceSessionId = sanitizeText(input.deviceSessionId);
  if (deviceSessionId) {
    const deviceOrderCount = recentOrders.filter((order) => extractDeviceSessionId(order.payment) === deviceSessionId).length;
    events.push(
      ...evaluateDeviceVelocitySignals({
        deviceSessionId,
        orderCount: deviceOrderCount,
        orderId: input.orderId,
        window,
      }).events
    );
  }

  await writeRiskEvents(events);
  return events;
};

export const captureRefundAbuseSignals = async (input: {
  customerId: string;
  orderId: string;
}) => {
  const window = buildWindow(REFUND_ABUSE_WINDOW_MS);
  const recentOrders = await loadRecentCustomerOrders(input.customerId, window.startsAt, window.endsAt);
  const refundCount = recentOrders.filter((order) => {
    const payment = (order.payment ?? {}) as JsonObject;
    return Boolean(payment.refundedAt) || parseNumber(payment.refundAmount, 0) > 0;
  }).length;

  const events = evaluateRefundAbuseSignals({
    customerId: input.customerId,
    orderId: input.orderId,
    refundCount,
    window,
  }).events;

  await writeRiskEvents(events);
  return events;
};

export const capturePaymentVerificationRiskSignals = async (input: {
  customerId: string;
  orderId: string;
  paymentReference: string;
  transactionData: JsonObject;
}) => {
  const window = buildWindow(PAYMENT_VELOCITY_WINDOW_MS);
  const authorizationCode = extractAuthorizationCode(input.transactionData);
  if (!authorizationCode) {
    return [];
  }

  const recentTransactions = await loadRecentPaymentTransactions(input.customerId, window.startsAt, window.endsAt);
  const matchingAuthorizationCount = recentTransactions.filter(
    (transaction) => extractAuthorizationCode(transaction.webhookEvent) === authorizationCode
  ).length;

  const events = [
    ...evaluateCardVelocitySignals({
      authorizationCode,
      orderId: input.orderId,
      orderCount: matchingAuthorizationCount,
      window,
    }).events,
  ];

  await writeRiskEvents(events);
  return events;
};

export const capturePaymentVerificationReplaySignal = async (input: {
  orderId: string;
  paymentReference: string;
}) => {
  const events = evaluatePaymentVerificationReplaySignals(input).events;
  await writeRiskEvents(events);
  return events;
};

export const capturePaymentVerificationFailureSignal = async (input: {
  orderId: string;
  paymentReference: string;
  reason: string;
  retryCount?: number | null;
}) => {
  const events = evaluatePaymentVerificationFailureSignals({
    orderId: input.orderId,
    paymentReference: input.paymentReference,
    reason: input.reason,
    retryCount: Math.max(1, Math.floor(parseNumber(input.retryCount, 1))),
  }).events;

  await writeRiskEvents(events);
  return events;
};

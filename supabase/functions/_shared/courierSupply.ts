import { serviceClient } from './client.ts';
import { DEFAULT_CURRENCY } from './orders.ts';
import { nowIso, parseNumber, roundCurrency, sanitizeOptionalText, sanitizeText } from './rpc/coercion.ts';

export const DISPATCH_DOCUMENT_BUCKET = 'dispatch-kyc';

export const DISPATCH_DOCUMENT_KINDS = ['licence_front', 'licence_back'] as const;
export type DispatchDocumentKind = (typeof DISPATCH_DOCUMENT_KINDS)[number];

export type CourierShiftSlotRow = {
  courierId: string;
  createdAt?: string | null;
  endsAt: string;
  forecastDemand: number;
  id: string;
  notes?: string | null;
  startsAt: string;
  status: string;
  updatedAt?: string | null;
};

export type CourierEarningRow = {
  amount: number;
  courierId: string;
  createdAt?: string | null;
  currency: string;
  deliveredAt: string;
  id: string;
  orderId: string;
  payoutId?: string | null;
  restaurantId?: string | null;
  restaurantName?: string | null;
  updatedAt?: string | null;
};

export type CourierPayoutRow = {
  courierId: string;
  createdAt?: string | null;
  currency: string;
  id: string;
  ledgerTotal: number;
  paidAt?: string | null;
  periodEndsAt: string;
  periodStartsAt: string;
  reference?: string | null;
  reviewNotes?: string | null;
  status: string;
  updatedAt?: string | null;
};

export type CourierWeeklyEarningsWeek = {
  endsAt: string;
  startsAt: string;
  timezone: string;
};

export type CourierWeeklyEarningsRecord = {
  address: null;
  amount: number;
  deliveredAt: string;
  orderId: string;
  restaurantName: string | null;
};

export type CourierWeeklyEarningsPayout = {
  currency: string;
  id: string | null;
  ledgerTotal: number;
  paidAt: string | null;
  periodEndsAt: string;
  periodStartsAt: string;
  reference: string | null;
  reviewNotes: string | null;
  status: string;
};

export type CourierWeeklyEarningsSummary = {
  averagePerDelivery: number;
  currency: string;
  deliveredOrders: number;
  payout: CourierWeeklyEarningsPayout;
  records: CourierWeeklyEarningsRecord[];
  total: number;
  week: CourierWeeklyEarningsWeek;
};

type UploadDispatchDocumentInput = {
  base64: string;
  courierId: string;
  kind: DispatchDocumentKind;
  mimeType?: string | null;
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const getExtensionForMimeType = (mimeType: string) => {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
};

const isIsoDateInWindow = (value: string | null | undefined, startsAt: string, endsAt: string) => {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.parse(startsAt) && timestamp < Date.parse(endsAt);
};

export const buildCourierWeeklyEarningsSummary = (input: {
  payouts: CourierPayoutRow[];
  records: CourierEarningRow[];
  weekWindow: CourierWeeklyEarningsWeek;
}): CourierWeeklyEarningsSummary => {
  const records = input.records
    .map((earning) => ({
      address: null,
      amount: roundCurrency(parseNumber(earning.amount, 0)),
      deliveredAt: earning.deliveredAt,
      orderId: earning.orderId,
      restaurantName: sanitizeOptionalText(earning.restaurantName),
    }))
    .sort((left, right) => Date.parse(right.deliveredAt ?? '') - Date.parse(left.deliveredAt ?? ''));
  const total = roundCurrency(records.reduce((sum, record) => sum + record.amount, 0));
  const deliveredOrderCount = records.length;
  const matchingPayout =
    input.payouts.find(
      (payout) =>
        isIsoDateInWindow(sanitizeText(payout.periodStartsAt), input.weekWindow.startsAt, input.weekWindow.endsAt) ||
        isIsoDateInWindow(sanitizeText(payout.periodEndsAt), input.weekWindow.startsAt, input.weekWindow.endsAt)
    ) ?? null;

  return {
    averagePerDelivery: deliveredOrderCount > 0 ? roundCurrency(total / deliveredOrderCount) : 0,
    currency: DEFAULT_CURRENCY,
    deliveredOrders: deliveredOrderCount,
    payout: matchingPayout
      ? {
          currency: sanitizeText(matchingPayout.currency, DEFAULT_CURRENCY),
          id: matchingPayout.id,
          ledgerTotal: roundCurrency(parseNumber(matchingPayout.ledgerTotal, total)),
          paidAt: matchingPayout.paidAt ?? null,
          periodEndsAt: matchingPayout.periodEndsAt,
          periodStartsAt: matchingPayout.periodStartsAt,
          reference: sanitizeOptionalText(matchingPayout.reference),
          reviewNotes: sanitizeOptionalText(matchingPayout.reviewNotes),
          status: sanitizeText(matchingPayout.status, 'pending'),
        }
      : {
          currency: DEFAULT_CURRENCY,
          id: null,
          ledgerTotal: total,
          paidAt: null,
          periodEndsAt: input.weekWindow.endsAt,
          periodStartsAt: input.weekWindow.startsAt,
          reference: null,
          reviewNotes: null,
          status: 'pending',
        },
    records,
    total,
    week: input.weekWindow,
  };
};

export const uploadDispatchDocument = async ({ base64, courierId, kind, mimeType }: UploadDispatchDocumentInput) => {
  const safeCourierId = sanitizeText(courierId);
  const safeBase64 = sanitizeText(base64);
  const safeMimeType = sanitizeText(mimeType, 'image/jpeg');

  if (!safeCourierId) {
    throw new Error('A courier id is required to upload dispatch documents.');
  }

  if (!safeBase64) {
    throw new Error('A document payload is required.');
  }

  const extension = getExtensionForMimeType(safeMimeType);
  const filePath = `couriers/${safeCourierId}/${kind}/${nowIso().replace(/[:.]/g, '-')}.${extension}`;

  const { error } = await serviceClient.storage.from(DISPATCH_DOCUMENT_BUCKET).upload(filePath, base64ToBytes(safeBase64), {
    contentType: safeMimeType,
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  return filePath;
};

export const loadCourierShiftSlots = async (courierId: string) => {
  const { data, error } = await serviceClient
    .from('CourierShiftSlot')
    .select('id,courierId,startsAt,endsAt,forecastDemand,status,notes,createdAt,updatedAt')
    .eq('courierId', sanitizeText(courierId))
    .order('startsAt', { ascending: true })
    .returns<CourierShiftSlotRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const upsertCourierShiftSlots = async (
  courierId: string,
  slots: Array<{
    endsAt: string;
    forecastDemand?: number | null;
    id?: string;
    notes?: string | null;
    startsAt: string;
    status?: string;
  }>
) => {
  const now = nowIso();
  const { error } = await serviceClient.from('CourierShiftSlot').upsert(
    slots.map((slot) => ({
      courierId: sanitizeText(courierId),
      endsAt: slot.endsAt,
      forecastDemand: Math.max(0, Math.floor(parseNumber(slot.forecastDemand, 0))),
      id: sanitizeText(slot.id) || crypto.randomUUID(),
      notes: sanitizeOptionalText(slot.notes),
      startsAt: slot.startsAt,
      status: sanitizeText(slot.status, 'planned'),
      updatedAt: now,
      createdAt: now,
    })),
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

export const recordCourierEarning = async (input: {
  amount: number;
  courierId: string;
  deliveredAt: string;
  orderId: string;
  restaurantId?: string | null;
  restaurantName?: string | null;
  currency?: string;
}) => {
  const timestamp = nowIso();
  const { error } = await serviceClient.from('CourierEarning').upsert(
    {
      amount: roundCurrency(input.amount),
      courierId: sanitizeText(input.courierId),
      currency: sanitizeText(input.currency, DEFAULT_CURRENCY),
      deliveredAt: input.deliveredAt,
      id: `earning_${sanitizeText(input.orderId)}`,
      orderId: sanitizeText(input.orderId),
      restaurantId: sanitizeOptionalText(input.restaurantId),
      restaurantName: sanitizeOptionalText(input.restaurantName),
      updatedAt: timestamp,
      createdAt: timestamp,
    },
    { onConflict: 'orderId' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

export const loadCourierEarnings = async (courierId: string, startsAt?: string, endsAt?: string) => {
  let query = serviceClient
    .from('CourierEarning')
    .select('id,courierId,orderId,amount,currency,deliveredAt,restaurantId,restaurantName,payoutId,createdAt,updatedAt')
    .eq('courierId', sanitizeText(courierId))
    .order('deliveredAt', { ascending: false });

  if (startsAt) {
    query = query.gte('deliveredAt', startsAt);
  }

  if (endsAt) {
    query = query.lt('deliveredAt', endsAt);
  }

  const { data, error } = await query.returns<CourierEarningRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const loadCourierPayouts = async (courierId: string) => {
  const { data, error } = await serviceClient
    .from('CourierPayout')
    .select(
      'id,courierId,periodStartsAt,periodEndsAt,currency,ledgerTotal,status,paidAt,reference,reviewNotes,createdAt,updatedAt'
    )
    .eq('courierId', sanitizeText(courierId))
    .order('periodEndsAt', { ascending: false })
    .returns<CourierPayoutRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
};

export const upsertCourierPayout = async (input: {
  courierId: string;
  currency?: string;
  ledgerTotal: number;
  periodEndsAt: string;
  periodStartsAt: string;
  reference?: string | null;
  reviewNotes?: string | null;
  status?: string;
}) => {
  const timestamp = nowIso();
  const { error } = await serviceClient.from('CourierPayout').upsert(
    {
      courierId: sanitizeText(input.courierId),
      currency: sanitizeText(input.currency, DEFAULT_CURRENCY),
      id: `payout_${sanitizeText(input.courierId)}_${sanitizeText(input.periodStartsAt).replace(/[:.]/g, '-')}`,
      ledgerTotal: roundCurrency(input.ledgerTotal),
      paidAt: input.status === 'paid' ? timestamp : null,
      periodEndsAt: input.periodEndsAt,
      periodStartsAt: input.periodStartsAt,
      reference: sanitizeOptionalText(input.reference),
      reviewNotes: sanitizeOptionalText(input.reviewNotes),
      status: sanitizeText(input.status, 'pending'),
      updatedAt: timestamp,
      createdAt: timestamp,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }
};

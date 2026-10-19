// Pure projections behind the admin-only restaurant-payout and rider-roster
// reads. Kept free of any database access so the rules (what counts as
// "not splitting", what a rider row may expose) are unit testable.

import { isStorePaused } from './availability.ts';
import { isRiderLocationLive } from './riderLocation.ts';

export type PayoutRestaurantInput = {
  id: string;
  isPublished?: boolean | null;
  name?: string | null;
  ownerId?: string | null;
  paystackSubaccountCode?: string | null;
  pausedUntil?: string | null;
};

// Deliberately excludes bankCode / accountNumber / accountLast4 /
// resolvedAccountName: this read must never carry account details.
export type PayoutProfileInput = {
  lastError?: string | null;
  paystackSubaccountCode?: string | null;
  restaurantId?: string | null;
  status?: string | null;
  uid?: string | null;
  updatedAt?: string | null;
};

export type PaidTransactionInput = {
  amount?: number | null;
  restaurantId?: string | null;
  settlementMode?: string | null;
};

export type SettlementTotals = {
  manualAmount: number;
  manualCount: number;
  splitAmount: number;
  splitCount: number;
  // Paid with no recorded settlement mode (rows written before the column
  // existed). Counted separately so the manual/split numbers stay honest.
  unknownAmount: number;
  unknownCount: number;
};

export const emptySettlementTotals = (): SettlementTotals => ({
  manualAmount: 0,
  manualCount: 0,
  splitAmount: 0,
  splitCount: 0,
  unknownAmount: 0,
  unknownCount: 0,
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const addTransaction = (totals: SettlementTotals, transaction: PaidTransactionInput) => {
  const amount = Number.isFinite(Number(transaction.amount)) ? Number(transaction.amount) : 0;
  if (transaction.settlementMode === 'split') {
    totals.splitCount += 1;
    totals.splitAmount = roundMoney(totals.splitAmount + amount);
  } else if (transaction.settlementMode === 'manual') {
    totals.manualCount += 1;
    totals.manualAmount = roundMoney(totals.manualAmount + amount);
  } else {
    totals.unknownCount += 1;
    totals.unknownAmount = roundMoney(totals.unknownAmount + amount);
  }
};

/** Totals per restaurantId plus platform-wide totals (including unattributed rows). */
export const summarizeSettlement = (transactions: PaidTransactionInput[]) => {
  const byRestaurant = new Map<string, SettlementTotals>();
  const platform = emptySettlementTotals();
  for (const transaction of transactions) {
    addTransaction(platform, transaction);
    const restaurantId = (transaction.restaurantId ?? '').trim();
    if (!restaurantId) {
      continue;
    }
    let totals = byRestaurant.get(restaurantId);
    if (!totals) {
      totals = emptySettlementTotals();
      byRestaurant.set(restaurantId, totals);
    }
    addTransaction(totals, transaction);
  }
  return { byRestaurant, platform };
};

const hasText = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0;

/**
 * The payout profile for a restaurant. New-flow rows are keyed by the owner's
 * uid and gain restaurantId on approval; prefer an explicit restaurantId match.
 */
export const findPayoutProfile = (
  restaurant: PayoutRestaurantInput,
  profiles: PayoutProfileInput[]
): PayoutProfileInput | null =>
  profiles.find((profile) => profile.restaurantId === restaurant.id) ??
  (restaurant.ownerId ? profiles.find((profile) => profile.uid === restaurant.ownerId) : undefined) ??
  null;

export const buildRestaurantPayoutRow = (
  restaurant: PayoutRestaurantInput,
  profile: PayoutProfileInput | null,
  settlement: SettlementTotals | undefined,
  now: Date = new Date()
) => {
  // Orders are split from RestaurantRecord.paystackSubaccountCode alone
  // (resolvePaymentSettlementSummary), so that is the column that decides
  // whether money is split. The payout profile's status explains why not.
  const hasSubaccount = hasText(restaurant.paystackSubaccountCode);
  const isPublished = restaurant.isPublished === true;
  return {
    hasSubaccount,
    id: restaurant.id,
    isPaused: isStorePaused({ pausedUntil: restaurant.pausedUntil }, now),
    isPublished,
    name: hasText(restaurant.name) ? (restaurant.name as string).trim() : 'Unnamed restaurant',
    // True only when customers can pay this restaurant yet the platform is
    // the one receiving the money.
    notSplitting: isPublished && !hasSubaccount,
    pausedUntil: restaurant.pausedUntil ?? null,
    payoutLastError: profile?.lastError ?? null,
    payoutProfileHasSubaccount: hasText(profile?.paystackSubaccountCode),
    payoutStatus: profile ? (hasText(profile.status) ? (profile.status as string).trim() : 'unknown') : 'none',
    payoutUpdatedAt: profile?.updatedAt ?? null,
    settlement: settlement ?? emptySettlementTotals(),
  };
};

export type RiderRosterInput = {
  acceptanceRate?: number | null;
  activeLoad?: number | null;
  completedTrips?: number | null;
  displayName?: string | null;
  id: string;
  status?: string | null;
  updatedAt?: string | null;
  vehicleType?: string | null;
  verificationStatus?: string | null;
  zone?: string | null;
};

/**
 * One roster row. An allow-list rather than a strip-list: licence number,
 * plate, phone, address and coordinates are simply never read. `lastSeenAt`
 * is the live-location stamp when there is one, otherwise the durable record's
 * updatedAt; `online` says whether that stamp is fresh enough to be a live fix.
 */
export const buildRiderRosterRow = (
  rider: RiderRosterInput,
  liveUpdatedAt: string | null | undefined,
  nowMs: number
) => {
  const lastSeenAt = liveUpdatedAt ?? rider.updatedAt ?? null;
  return {
    acceptanceRate: rider.acceptanceRate ?? null,
    activeLoad: rider.activeLoad ?? 0,
    completedTrips: rider.completedTrips ?? 0,
    displayName: hasText(rider.displayName) ? (rider.displayName as string).trim() : 'Dispatch rider',
    id: rider.id,
    lastSeenAt,
    online: isRiderLocationLive(liveUpdatedAt, nowMs),
    status: hasText(rider.status) ? (rider.status as string).trim() : 'Unknown',
    vehicleType: hasText(rider.vehicleType) ? (rider.vehicleType as string).trim() : 'Unknown',
    verificationStatus: hasText(rider.verificationStatus) ? (rider.verificationStatus as string).trim() : 'pending',
    zone: hasText(rider.zone) ? (rider.zone as string).trim() : null,
  };
};

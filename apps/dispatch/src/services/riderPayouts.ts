import { callDispatchBackendRpc } from './backendRpc';

// Rider pay (FEASTY global-pool riders only). Both actions live in the ACCOUNT
// domain (feasty-account), not dispatch; callDispatchBackendRpc routes by
// action name through packages/domain rpcRoutes, so the caller does not care.

export type RiderPayoutRecipient = {
  accountName: string;
  accountNumberMasked: string;
  bankCode: string;
  bankName: string | null;
  holdReason: string | null;
  /** ISO time, or 'infinity' for an open-ended hold after a failed transfer. */
  holdUntil: string | null;
  verifiedAt: string | null;
};

export type RiderPayoutProfile = {
  isPlatformRider: boolean;
  minimumPayout: number;
  payouts: { amount: number; createdAt: string | null; id: string; paidAt: string | null; status: string }[];
  recipient: RiderPayoutRecipient | null;
  totals: { paid: number; pending: number; processing: number };
};

export const getRiderPayoutProfile = () => callDispatchBackendRpc<RiderPayoutProfile>('riderGetPayoutProfile');

export const submitRiderPayoutBank = (input: { accountNumber: string; bankCode: string; bankName: string }) =>
  callDispatchBackendRpc<{ recipient: RiderPayoutRecipient }>('riderSubmitPayoutBank', input);

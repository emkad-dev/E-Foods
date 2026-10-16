// Server-side redaction of an order snapshot for a PENDING offer. The rider
// has not accepted, so they must not receive the customer's address, phone,
// id, or payment detail -- today the offer screen only HIDES these; the data
// is still in the payload. Applied to pending offers only; an owned (accepted)
// order keeps its full snapshot because the rider needs the address to deliver.

const coarsen = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

export const redactOfferSnapshot = <T extends Record<string, unknown>>(snapshot: T): T => {
  const { deliveryAddress: _a, customerId: _c, customerPhone: _p, ...rest } =
    snapshot as Record<string, unknown>;
  const loc = rest.deliveryLocation as { latitude?: unknown; longitude?: unknown } | null | undefined;
  if (loc && typeof loc === 'object') {
    rest.deliveryLocation = { latitude: coarsen(loc.latitude), longitude: coarsen(loc.longitude) };
  }
  const payment = rest.payment as { status?: unknown } | null | undefined;
  if (payment && typeof payment === 'object') {
    rest.payment = { status: payment.status ?? null };
  }
  return rest as T;
};

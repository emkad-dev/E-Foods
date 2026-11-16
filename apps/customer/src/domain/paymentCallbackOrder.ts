/**
 * Finding the order a Paystack return belongs to when the callback URL carries
 * no orderId (payments started before the server added it, or any other return
 * that lost it). Paystack always sends back `reference`/`trxref`, and every
 * order the customer can read carries that same reference on `payment`.
 */

type OrderWithPaymentReference = {
  id?: string | null;
  orderGroupId?: string | null;
  payment?: { reference?: string | null } | null;
};

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The id of the customer's order paid with `reference`, or '' when none match.
 * A grouped checkout shares one reference across its member orders; the one to
 * open is the primary (its id is the group id), which is also the id checkout
 * itself navigates to.
 */
export const findOrderIdForPaymentReference = (
  orders: readonly OrderWithPaymentReference[] | null | undefined,
  reference: string
): string => {
  const wanted = clean(reference);
  if (!wanted || !orders) {
    return '';
  }

  const matches = orders.filter((order) => clean(order?.payment?.reference) === wanted && clean(order?.id));
  if (matches.length === 0) {
    return '';
  }

  const primary = matches.find((order) => clean(order.orderGroupId) === clean(order.id));
  return clean((primary ?? matches[0]).id);
};

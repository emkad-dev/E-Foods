// Pure so the precedence between the four states is testable without rendering
// the order screen. The fields come from the shared order snapshot; an order is
// in the confirmation flow only when `customerConfirmDueAt` is set (rider orders
// closed by delivery code, and orders delivered before the flow shipped, never
// get it), so those show nothing.

export type OrderConfirmationFields = {
  customerConfirmDueAt?: string | null;
  customerConfirmedAt?: string | null;
  customerConfirmationSource?: 'customer' | 'auto' | null;
  customerIssueReportedAt?: string | null;
};

export type OrderConfirmationLabel =
  | 'Waiting for customer to confirm'
  | 'Customer confirmed'
  | 'Closed automatically'
  | 'Customer reported a problem';

export const getOrderConfirmationStatus = (order: OrderConfirmationFields): OrderConfirmationLabel | null => {
  if (!order.customerConfirmDueAt) {
    return null;
  }

  // Confirmation is checked before the report: the customer can confirm after
  // reporting, and that later word is the final state. A source of 'auto' means
  // the timer closed it; anything else that is confirmed was the customer.
  if (order.customerConfirmedAt) {
    return order.customerConfirmationSource === 'auto' ? 'Closed automatically' : 'Customer confirmed';
  }

  // A report stops the auto-close timer, so it outranks "waiting".
  if (order.customerIssueReportedAt) {
    return 'Customer reported a problem';
  }

  return 'Waiting for customer to confirm';
};

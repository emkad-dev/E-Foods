export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Menu prices arrive from the catalog with the platform markup already
// embedded, so checkout is a plain sum. The server re-derives every amount
// authoritatively at order creation — this preview must add nothing.
export const calculateCheckoutTotal = ({
  deliveryFee,
  subtotal,
  tip,
}: {
  deliveryFee: number;
  subtotal: number;
  tip: number;
}) => {
  const safeSubtotal = roundCurrency(subtotal);
  const safeDeliveryFee = roundCurrency(deliveryFee);
  const safeTip = roundCurrency(tip);

  return {
    deliveryFee: safeDeliveryFee,
    subtotal: safeSubtotal,
    tip: safeTip,
    total: roundCurrency(safeSubtotal + safeDeliveryFee + safeTip),
  };
};

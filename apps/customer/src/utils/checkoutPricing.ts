export const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateServiceFee = (subtotal: number) => {
  if (subtotal <= 0) {
    return 0;
  }

  return roundCurrency(Math.min(Math.max(subtotal * 0.05, 0.49), 12));
};

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
  const serviceFee = calculateServiceFee(safeSubtotal);
  const total = roundCurrency(safeSubtotal + safeDeliveryFee + serviceFee + safeTip);

  return {
    deliveryFee: safeDeliveryFee,
    serviceFee,
    subtotal: safeSubtotal,
    tip: safeTip,
    total,
  };
};

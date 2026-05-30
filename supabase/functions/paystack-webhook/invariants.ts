export const resolveWebhookOrderIdForReference = ({
  metadataOrderId,
  transactionOrderId,
}: {
  metadataOrderId: string;
  transactionOrderId: string;
}) => {
  if (!transactionOrderId) {
    return {
      ignored: true,
      orderId: '',
      reason: 'order_not_found',
    };
  }

  if (metadataOrderId && metadataOrderId !== transactionOrderId) {
    return {
      ignored: true,
      orderId: '',
      reason: 'reference_order_mismatch',
    };
  }

  return {
    ignored: false,
    orderId: transactionOrderId,
    reason: null,
  };
};

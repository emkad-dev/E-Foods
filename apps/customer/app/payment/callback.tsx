import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BusyLabel, radius } from '@feasty/design-system';
import { useCart } from '../../src/contexts/CartContext';
import { refreshCustomerPaymentStatus } from '../../src/services/customerOrderActions';
import { getCustomerOrders } from '../../src/services/customerReadModel';
import { findOrderIdForPaymentReference } from '../../src/domain/paymentCallbackOrder';
import { toUserMessage } from '../../../../packages/observability/src/userMessage';
import { customerTheme } from '../../src/theme/palette';
import { pageTitleTextStyle } from '../../src/theme/screenChrome';

type CallbackParams = {
  orderId?: string | string[];
  reference?: string | string[];
  trxref?: string | string[];
  status?: string | string[];
};

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const normalizeStatus = (value: string) => value.trim().toLowerCase();

const isTerminalFailure = (status: string) => ['failed', 'cancelled', 'abandoned', 'error'].includes(status);

const ORDER_NOT_FOUND_MESSAGE =
  'We could not find the order for this payment. If you paid, it will appear in Orders shortly.';

export default function PaymentCallbackScreen() {
  const router = useRouter();
  const { clearCart } = useCart();
  const params = useLocalSearchParams<CallbackParams>();
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');
  const [gatewayStatus, setGatewayStatus] = useState<string>('');
  // Set when the return carried no orderId and the order was found another way.
  const [resolvedOrderId, setResolvedOrderId] = useState('');
  const resolvedOrderIdRef = useRef('');
  const [orderNotFound, setOrderNotFound] = useState(false);

  const orderId = useMemo(() => firstParam(params.orderId).trim(), [params.orderId]);
  const reference = useMemo(() => firstParam(params.reference).trim(), [params.reference]);
  const transactionRef = useMemo(() => firstParam(params.trxref).trim(), [params.trxref]);
  const status = useMemo(() => normalizeStatus(firstParam(params.status)), [params.status]);
  const paymentReference = reference || transactionRef;
  const activeOrderId = orderId || resolvedOrderId;

  // The server puts orderId on the Paystack callback URL, but a payment started
  // before that deploy (or any return that lost it) arrives with only the
  // reference. Every order the customer can read carries that reference on
  // `payment`, so the order is found from their own list instead of giving up.
  const resolveOrderId = useCallback(async (): Promise<string> => {
    if (orderId) {
      return orderId;
    }

    if (resolvedOrderIdRef.current) {
      return resolvedOrderIdRef.current;
    }

    if (!paymentReference) {
      return '';
    }

    const { orders } = await getCustomerOrders({ fresh: true });
    return findOrderIdForPaymentReference(orders, paymentReference);
  }, [orderId, paymentReference]);

  const confirmPayment = useCallback(
    async (isActive: () => boolean) => {
      setRefreshError(null);
      setOrderNotFound(false);

      let targetOrderId = '';
      try {
        targetOrderId = await resolveOrderId();
      } catch (nextError) {
        if (isActive()) {
          setRefreshError(toUserMessage(nextError, 'We could not look up this payment right now.'));
        }
        return;
      }

      if (!isActive()) {
        return;
      }

      if (!targetOrderId) {
        setOrderNotFound(true);
        return;
      }

      if (targetOrderId !== orderId) {
        resolvedOrderIdRef.current = targetOrderId;
        setResolvedOrderId(targetOrderId);
      }

      if (isTerminalFailure(status)) {
        setPaymentStatus('failed');
        setGatewayStatus(status);
        return;
      }

      try {
        const result = await refreshCustomerPaymentStatus(targetOrderId);
        if (!isActive()) {
          return;
        }

        setPaymentStatus(result.paymentStatus);
        setGatewayStatus(result.gatewayStatus);

        if (result.paymentStatus === 'paid') {
          clearCart();
          router.replace(`/orders/${targetOrderId}`);
          return;
        }

        if (result.paymentStatus === 'failed') {
          setRefreshError('The payment was not completed successfully.');
        }
      } catch (nextError) {
        if (isActive()) {
          setRefreshError(toUserMessage(nextError, 'We could not verify this payment right now.'));
        }
      }
    },
    [clearCart, orderId, resolveOrderId, router, status]
  );

  useEffect(() => {
    let active = true;
    setRefreshing(true);

    void confirmPayment(() => active).finally(() => {
      if (active) {
        setRefreshing(false);
      }
    });

    return () => {
      active = false;
    };
  }, [confirmPayment]);

  const handleRetry = async () => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    try {
      await confirmPayment(() => true);
    } finally {
      setRefreshing(false);
    }
  };

  const failed = isTerminalFailure(status) || paymentStatus === 'failed';

  const headline =
    paymentStatus === 'paid'
      ? 'Payment confirmed'
      : failed
        ? 'Payment not completed'
        : orderNotFound
          ? 'Order not found yet'
          : 'Confirming payment';

  const body =
    paymentStatus === 'paid'
      ? 'Your order is confirmed and we are sending you to the order details screen.'
      : failed
        ? 'The payment was cancelled or failed. You can go back to checkout and try again.'
        : orderNotFound
          ? ORDER_NOT_FOUND_MESSAGE
          : 'We are checking with Paystack and the backend before continuing.';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>FEASTY Paystack</Text>
        <Text style={styles.title}>{headline}</Text>
        <Text style={styles.copy}>{body}</Text>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Order</Text>
          <Text style={styles.metaValue}>{activeOrderId ? `#${activeOrderId.slice(-6)}` : 'Unknown'}</Text>
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Reference</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {paymentReference || 'Pending confirmation'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Gateway status</Text>
          <Text style={styles.statusValue}>{gatewayStatus || status || 'pending'}</Text>
        </View>

        {refreshing ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={customerTheme.brandGreen} />
            <Text style={styles.loadingText}>Checking payment...</Text>
          </View>
        ) : null}

        {refreshError ? <Text style={styles.errorText}>{refreshError}</Text> : null}

        {paymentStatus !== 'paid' ? (
          <Pressable accessibilityRole="button" onPress={handleRetry} style={styles.button} disabled={refreshing}>
            <BusyLabel busy={refreshing} label="Check again" busyLabel="Checking..." textStyle={styles.buttonText} />
          </Pressable>
        ) : null}

        {orderNotFound && paymentStatus !== 'paid' ? (
          <Pressable accessibilityRole="button" onPress={() => router.replace('/orders')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Go to Orders</Text>
          </Pressable>
        ) : null}

        {paymentStatus !== 'paid' ? (
          <Pressable accessibilityRole="button" onPress={() => router.replace('/cart')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Return to checkout</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderColor: '#E7ECEF',
    borderRadius: radius['2xl'],
    borderWidth: 1,
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
  eyebrow: {
    color: customerTheme.brandGreen,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    ...pageTitleTextStyle,
    marginBottom: 10,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 18,
  },
  metaBox: {
    backgroundColor: '#F7FAFC',
    borderColor: '#E7ECEF',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  metaLabel: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  metaValue: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: 4,
  },
  statusLabel: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  statusValue: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  loadingText: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: radius.xl,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonText: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderColor: '#E7ECEF',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 12,
    minHeight: 52,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
});

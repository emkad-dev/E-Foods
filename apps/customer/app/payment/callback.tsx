import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCart } from '../../src/contexts/CartContext';
import { refreshCustomerPaymentStatus } from '../../src/services/customerOrderActions';
import { customerTheme } from '../../src/theme/palette';

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

export default function PaymentCallbackScreen() {
  const router = useRouter();
  const { clearCart } = useCart();
  const params = useLocalSearchParams<CallbackParams>();
  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>('pending');
  const [gatewayStatus, setGatewayStatus] = useState<string>('');

  const orderId = useMemo(() => firstParam(params.orderId).trim(), [params.orderId]);
  const reference = useMemo(() => firstParam(params.reference).trim(), [params.reference]);
  const transactionRef = useMemo(() => firstParam(params.trxref).trim(), [params.trxref]);
  const status = useMemo(() => normalizeStatus(firstParam(params.status)), [params.status]);

  useEffect(() => {
    let active = true;

    const confirmPayment = async () => {
      if (!orderId) {
        if (active) {
          setRefreshing(false);
          setRefreshError('We could not confirm this payment because the order id is missing.');
        }
        return;
      }

      if (isTerminalFailure(status)) {
        if (active) {
          setPaymentStatus('failed');
          setGatewayStatus(status);
          setRefreshing(false);
        }
        return;
      }

      try {
        const result = await refreshCustomerPaymentStatus(orderId);
        if (!active) {
          return;
        }

        setPaymentStatus(result.paymentStatus);
        setGatewayStatus(result.gatewayStatus);

        if (result.paymentStatus === 'paid') {
          clearCart();
          router.replace(`/orders/${orderId}`);
          return;
        }

        if (result.paymentStatus === 'failed') {
          setRefreshError('The payment was not completed successfully.');
        }
      } catch (nextError: any) {
        if (active) {
          setRefreshError(nextError.message ?? 'We could not verify this payment right now.');
        }
      } finally {
        if (active) {
          setRefreshing(false);
        }
      }
    };

    void confirmPayment();

    return () => {
      active = false;
    };
  }, [clearCart, orderId, router, status]);

  const handleRetry = async () => {
    if (!orderId || refreshing) {
      return;
    }

    setRefreshing(true);
    setRefreshError(null);

    try {
      const result = await refreshCustomerPaymentStatus(orderId);
      setPaymentStatus(result.paymentStatus);
      setGatewayStatus(result.gatewayStatus);

      if (result.paymentStatus === 'paid') {
        clearCart();
        router.replace(`/orders/${orderId}`);
        return;
      }

      if (result.paymentStatus === 'failed') {
        setRefreshError('The payment was not completed successfully.');
      }
    } catch (nextError: any) {
      setRefreshError(nextError.message ?? 'We could not verify this payment right now.');
    } finally {
      setRefreshing(false);
    }
  };

  const headline =
    paymentStatus === 'paid'
      ? 'Payment confirmed'
      : isTerminalFailure(status) || paymentStatus === 'failed'
        ? 'Payment not completed'
        : 'Confirming payment';

  const body =
    paymentStatus === 'paid'
      ? 'Your order is confirmed and we are sending you to the order details screen.'
      : isTerminalFailure(status) || paymentStatus === 'failed'
        ? 'The payment was cancelled or failed. You can go back to checkout and try again.'
        : 'We are checking with Paystack and the backend before continuing.';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>FEASTY Paystack</Text>
        <Text style={styles.title}>{headline}</Text>
        <Text style={styles.copy}>{body}</Text>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Order</Text>
          <Text style={styles.metaValue}>{orderId ? `#${orderId.slice(-6)}` : 'Unknown'}</Text>
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Reference</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {reference || transactionRef || 'Pending confirmation'}
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
            <Text style={styles.buttonText}>{refreshing ? 'Checking...' : 'Check again'}</Text>
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
    borderRadius: 28,
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
    color: customerTheme.text,
    fontSize: 28,
    fontWeight: '900',
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
    borderRadius: 18,
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
    color: '#b91c1c',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: 18,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderColor: '#E7ECEF',
    borderRadius: 18,
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

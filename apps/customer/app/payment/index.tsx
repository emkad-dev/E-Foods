import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { FontAwesome } from '@expo/vector-icons';
import { customerTheme } from '../../src/theme/palette';
import { normalizeCustomerPaymentCallbackPath } from '../../src/services/paymentRouting';

type PaymentParams = {
  authorizationUrl?: string | string[];
  orderId?: string | string[];
};

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

const normalizeUrl = (url: string) => url.trim();

const readUrlParts = (url: string) => {
  try {
    const parsed = Linking.parse(url);
    const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
    const hostname = typeof parsed.hostname === 'string' ? parsed.hostname.trim() : '';
    return {
      path: path || hostname,
      queryParams: parsed.queryParams ?? {},
    };
  } catch {
    return {
      path: '',
      queryParams: {},
    };
  }
};

const isCallbackUrl = (url: string) => {
  const normalizedPath = normalizeCustomerPaymentCallbackPath(url);
  if (normalizedPath === 'payment/callback' || normalizedPath.endsWith('/payment/callback')) {
    return true;
  }

  const { path } = readUrlParts(url);
  return path === 'payment/callback' || path.endsWith('/payment/callback');
};

export default function PaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<PaymentParams>();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authorizationUrl = useMemo(() => normalizeUrl(firstParam(params.authorizationUrl)), [params.authorizationUrl]);
  const orderId = useMemo(() => firstParam(params.orderId), [params.orderId]);

  useEffect(() => {
    if (!authorizationUrl || !orderId) {
      setError('Payment could not be started.');
    }
  }, [authorizationUrl, orderId]);

  const forwardToCallback = (url: string) => {
    const { queryParams } = readUrlParts(url);
    const nextStatus = typeof queryParams.status === 'string' ? queryParams.status : '';
    router.replace(
      {
        pathname: '/payment/callback',
        params: {
          orderId,
          ...(typeof queryParams.reference === 'string' ? { reference: queryParams.reference } : null),
          ...(typeof queryParams.trxref === 'string' ? { trxref: queryParams.trxref } : null),
          ...(nextStatus ? { status: nextStatus } : null),
        },
      } as never
    );
  };

  const handleNavigation = (event: WebViewNavigation) => {
    const nextUrl = event.url;

    if (isCallbackUrl(nextUrl)) {
      forwardToCallback(nextUrl);
      return false;
    }

    return true;
  };

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
            <FontAwesome name="close" size={18} color={customerTheme.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Secure payment</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Payment unavailable</Text>
          <Text style={styles.stateCopy}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Return to checkout</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12} style={styles.iconButton}>
          <FontAwesome name="close" size={18} color={customerTheme.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>FEASTY Paystack</Text>
          <Text style={styles.headerTitle}>Secure payment</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.metaCard}>
        <Text style={styles.metaLabel}>Order</Text>
        <Text style={styles.metaValue}>{orderId ? `#${orderId.slice(-6)}` : 'Pending'}</Text>
        <Text style={styles.metaHint}>Complete your payment without leaving the app.</Text>
      </View>

      <View style={styles.webViewCard}>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={customerTheme.brandGreen} />
            <Text style={styles.loadingText}>Opening secure checkout...</Text>
          </View>
        ) : null}

        {authorizationUrl ? (
          <WebView
            ref={webViewRef}
            source={{ uri: authorizationUrl }}
            onLoadStart={() => {
              setError(null);
              setLoading(true);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError('We could not load the payment page. Please try again.');
            }}
            onShouldStartLoadWithRequest={handleNavigation}
            onNavigationStateChange={(event) => {
              if (isCallbackUrl(event.url)) {
                forwardToCallback(event.url);
              }
            }}
            startInLoadingState
            renderLoading={() => <View />}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            style={styles.webView}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    flex: 1,
    paddingTop: 18,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerCopy: {
    flex: 1,
  },
  headerEyebrow: {
    color: customerTheme.brandGreen,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: customerTheme.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  headerSpacer: {
    width: 42,
  },
  metaCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 18,
    marginTop: 18,
    padding: 16,
  },
  metaLabel: {
    color: customerTheme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  metaValue: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  metaHint: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  webViewCard: {
    backgroundColor: '#fff',
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    margin: 18,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: '#fff',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  loadingText: {
    color: customerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
  },
  stateCard: {
    backgroundColor: '#fff',
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    margin: 18,
    padding: 20,
  },
  stateTitle: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '900',
  },
  stateCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: 16,
    marginTop: 18,
    minHeight: 50,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});

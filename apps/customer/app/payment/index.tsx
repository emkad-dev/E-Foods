import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextProps,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { FontAwesome } from '@expo/vector-icons';
import { MIN_TAP_TARGET, radius, space } from '@feasty/design-system';
import { customerTheme } from '../../src/theme/palette';
import { screenTitleTextStyle } from '../../src/theme/screenChrome';
import { normalizeCustomerPaymentCallbackPath } from '../../src/services/paymentRouting';
import { formatMoney } from '../../src/utils/formatting';
import {
  describeExternalLinkFailure,
  openInSameWindow,
} from '../../../../packages/runtime/src/externalLink';

type PaymentParams = {
  amount?: string | string[];
  authorizationUrl?: string | string[];
  orderId?: string | string[];
};

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

const normalizeUrl = (url: string) => url.trim();

/** Same shape the orders list, order detail and payment callback screens show. */
const formatOrderReference = (orderId: string) => `#${orderId.slice(-6)}`;

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
  // Web handoff state. Native never reads this: it keeps the in-app WebView.
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const authorizationUrl = useMemo(() => normalizeUrl(firstParam(params.authorizationUrl)), [params.authorizationUrl]);
  const orderId = useMemo(() => firstParam(params.orderId), [params.orderId]);

  // Shown only when a caller forwards it. An amount is never derived or guessed
  // here: a wrong number on the screen that hands the customer to a real charge
  // is worse than no number at all.
  const amountLabel = useMemo(() => {
    const raw = firstParam(params.amount).trim();
    if (!raw) {
      return '';
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? formatMoney(parsed) : '';
  }, [params.amount]);

  const orderReference = orderId ? formatOrderReference(orderId) : '';

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

  // WEB ONLY. `react-native-webview` ships no web implementation -- its fallback
  // module renders a <Text> reading "React Native WebView does not support this
  // platform" -- so this screen rendered an order, a Paystack transaction, and
  // no way to pay for either. Every card order on app.feasty.com.ng died here.
  //
  // On success there is no state to set: the window is already navigating away.
  const handleOpenCheckout = async () => {
    setHandoffError(null);

    const result = await openInSameWindow(authorizationUrl);

    if (!result.ok) {
      // The URL is also on screen as a real link, so a refused navigation is a
      // detour rather than the end of the order.
      setHandoffError(describeExternalLinkFailure(result.reason, 'the Paystack checkout page'));
    }
  };

  // react-native-web renders a <Text href> as a real <a>, so this is a genuine
  // second route to checkout rather than a second call into the same code --
  // it survives whatever made the button fail. `_self` matches the button:
  // one window, which is the window Paystack's callback redirect lands in.
  // `href`/`hrefAttrs` are web-only props React Native does not declare.
  const checkoutLinkProps = {
    accessibilityRole: 'link',
    href: authorizationUrl,
    hrefAttrs: { rel: 'noopener noreferrer', target: '_self' },
  } as unknown as TextProps;

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

  if (Platform.OS === 'web') {
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

        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Pay with Paystack</Text>
          <Text style={styles.stateCopy}>
            Checkout opens with Paystack, the payment provider FEASTY uses. Card details are entered on Paystack, never
            on FEASTY.
          </Text>

          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Order</Text>
              <Text style={styles.summaryValue}>{orderReference || 'Pending'}</Text>
            </View>

            {amountLabel ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Amount</Text>
                <Text style={styles.summaryValue}>{amountLabel}</Text>
              </View>
            ) : null}
          </View>

          <Pressable accessibilityRole="button" onPress={handleOpenCheckout} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Continue to Paystack</Text>
          </Pressable>

          <Text style={styles.stateHint}>
            As soon as you finish paying, Paystack brings you back here and the order is confirmed automatically.
          </Text>

          {handoffError ? <Text style={styles.errorText}>{handoffError}</Text> : null}

          <Text style={styles.fallbackLabel}>Or go straight to the checkout page:</Text>
          <Text {...checkoutLinkProps} style={styles.fallbackLink} numberOfLines={2}>
            {authorizationUrl}
          </Text>
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
        <Text style={styles.metaValue}>{orderReference || 'Pending'}</Text>
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
    paddingTop: space.xl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    // Was 42 -- under the 44dp minimum, on the only control that dismisses a
    // payment screen.
    height: MIN_TAP_TARGET,
    justifyContent: 'center',
    width: MIN_TAP_TARGET,
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
    // Hand-rolled title bar, so it takes the shared title-bar scale: at 20/900
    // this was the third distinct size the same element rendered at.
    ...screenTitleTextStyle,
    marginTop: space.hair,
  },
  headerSpacer: {
    width: MIN_TAP_TARGET,
  },
  metaCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginHorizontal: space.xl,
    marginTop: space.xl,
    padding: space.lg,
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
    marginTop: space.sm,
  },
  metaHint: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: space.sm,
  },
  webViewCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    flex: 1,
    margin: space.xl,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
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
    marginTop: space.md,
  },
  stateCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    margin: space.xl,
    padding: space.xl,
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
    marginTop: space.sm,
  },
  stateHint: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: space.md,
  },
  summaryBox: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.sm,
    marginTop: space.lg,
    padding: space.lg,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: customerTheme.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: space.md,
  },
  fallbackLabel: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: space.lg,
  },
  fallbackLink: {
    color: customerTheme.link,
    fontSize: 13,
    lineHeight: 18,
    marginTop: space.xs,
    textDecorationLine: 'underline',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: radius.lg,
    marginTop: space.xl,
    minHeight: 50,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: customerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
});

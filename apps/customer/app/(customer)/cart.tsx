import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useAuthPrompt } from '@feasty/design-system';
import { useFocusEffect } from '@react-navigation/native';
import { RESTAURANTS_REALTIME_TOPIC, subscribeToRealtimeChanges } from '../../../../packages/auth/src';
import type { RealtimeResourceSubscribe } from '../../../../packages/runtime/src';
import { useRealtimeResource } from '../../../../packages/runtime/src';
import { useAppStateVisibility } from '../../../../packages/runtime/src/useAppStateVisibility';
import { useAuth } from '../../src/contexts/AuthContext';
import { useCart } from '../../src/contexts/CartContext';
import { useCoverage } from '../../src/contexts/CoverageContext';
import type { RestaurantDocument } from '../../src/domain/entities';
import {
  type CheckoutPaymentMethod,
  type FulfillmentType,
  formatPaymentMethodLabel,
} from '../../src/domain/orders';
import {
  initializeCustomerPayment,
  validateCustomerPromoCode,
  type PromoCodePreview,
} from '../../src/services/customerOrderActions';
import { trackAnalyticsEvent } from '../../../../packages/observability/src/analytics';
import { WAT_OFFSET_MS, buildScheduleSlots, type ScheduleSlotDay } from '../../src/domain/scheduleSlots';
import { getRestaurantDetail } from '../../src/services/publicRestaurantReadModel';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';
import { resolveAuthRedirectTo } from '../../src/utils/authPrompt';
import { groupCartItemsByRestaurant } from '../../src/utils/checkoutGrouping';
import { calculateCheckoutTotal } from '../../src/utils/checkoutPricing';
import { COVERAGE_COMING_SOON_COPY } from '../../src/utils/coverageMessaging';
import { getRestaurantAvailability } from '../../src/utils/restaurantAvailability';

const tipOptions = [0, 100, 150, 200] as const;
const DEFAULT_TIP_AMOUNT = tipOptions[0];
const CHECKOUT_FAILURE_MESSAGE = 'Check network and try again.';
const paymentOptions: CheckoutPaymentMethod[] = ['card', 'bank_transfer'];
const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;
const formatPlainNumber = (amount: number) => Math.round(amount).toLocaleString('en-US');

type RestaurantCheckoutSummary = {
  deliveryFee: number;
  items: ReturnType<typeof groupCartItemsByRestaurant>[number]['items'];
  minOrder: number;
  restaurant: RestaurantDocument | null;
  restaurantId: string;
  restaurantName: string;
  subtotal: number;
  supportsDelivery: boolean;
  supportsPickup: boolean;
  totalQuantity: number;
  warning: string | null;
};

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Labels a restaurant-local (WAT) day key. Presentation only - the slot rules
 * live in src/domain/scheduleSlots.ts. Deliberately not the device's locale
 * calendar: a customer in another timezone must still read the restaurant's day.
 */
const formatScheduleDayLabel = (dayKey: string) => {
  const todayKey = new Date(Date.now() + WAT_OFFSET_MS).toISOString().slice(0, 10);
  if (dayKey === todayKey) {
    return 'Today';
  }
  const tomorrowKey = new Date(Date.now() + WAT_OFFSET_MS + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (dayKey === tomorrowKey) {
    return 'Tomorrow';
  }
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    return dayKey;
  }
  return `${WEEKDAY_LABELS[new Date(parsed).getUTCDay()]} ${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`;
};

export default function CartScreen() {
  const {
    deliveryLocation,
    fulfillmentType,
    items,
    removeItem,
    restaurantId,
    restaurantName,
    setDeliveryLocation,
    setFulfillmentType,
    total,
    updateQuantity,
  } = useCart();
  const { user } = useAuth();
  const { isCovered } = useCoverage();
  const [deliveryNote, setDeliveryNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('card');
  const [submitting, setSubmitting] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(DEFAULT_TIP_AMOUNT);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<PromoCodePreview | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [autoOffers, setAutoOffers] = useState<PromoCodePreview['automaticOffers']>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantDocument | null>>({});
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);
  // Task 30 [H6]. 'now' is the default and leaves checkout exactly as it was.
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // Real cross-platform Modal. The old `promptForAuth` wrapped `Alert.alert`,
  // which react-native-web implements as an empty static method - so on
  // app.feasty.com.ng the sign-in demand at the end of checkout was silence.
  const { promptForAuth, authPromptDialog } = useAuthPrompt();
  const isMountedRef = useRef(true);
  const isCheckoutScreenFocusedRef = useRef(false);
  const safeTipAmount = tipOptions.includes(tipAmount as (typeof tipOptions)[number]) ? tipAmount : DEFAULT_TIP_AMOUNT;

  const restaurantGroups = useMemo(() => groupCartItemsByRestaurant(items), [items]);
  const restaurantIds = useMemo(
    () => Array.from(new Set(restaurantGroups.map((group) => group.restaurantId))),
    [restaurantGroups]
  );
  const restaurantIdsKey = restaurantIds.join('|');
  const isMixedBasket = restaurantIds.length > 1;
  const primaryRestaurantId = restaurantGroups[0]?.restaurantId ?? restaurantId;

  // Slots come from the primary restaurant's per-day hours, which only the
  // DETAIL projection carries. No hours (older cached response, or a restaurant
  // with none configured) means scheduling is simply not offered - never an
  // unrestricted picker whose slots the server would then reject.
  const scheduleDays: ScheduleSlotDay[] = useMemo(() => {
    if (isMixedBasket || !primaryRestaurantId) {
      return [];
    }
    const hours = restaurantsById[primaryRestaurantId]?.hours;
    if (!Array.isArray(hours) || hours.length === 0) {
      return [];
    }
    return buildScheduleSlots({ hours, now: Date.now() });
  }, [isMixedBasket, primaryRestaurantId, restaurantsById]);

  const schedulingAvailable = scheduleDays.length > 0;

  // If the offer set changes underneath a chosen slot (restaurant swapped, hours
  // refreshed, or the slot simply aged past the lead time) drop the selection
  // rather than submitting one the server will now refuse.
  useEffect(() => {
    if (!schedulingAvailable) {
      setScheduleMode('now');
      setSelectedSlotIso(null);
      return;
    }
    if (selectedSlotIso && !scheduleDays.some((day) => day.slots.some((slot) => slot.iso === selectedSlotIso))) {
      setSelectedSlotIso(null);
    }
  }, [scheduleDays, schedulingAvailable, selectedSlotIso]);
  const primaryRestaurantName = restaurantGroups[0]?.restaurantName ?? restaurantName;
  const allRestaurantsLoaded = restaurantIds.length > 0 && restaurantIds.every((id) => Boolean(restaurantsById[id]));

  const restaurantSummaries = useMemo<RestaurantCheckoutSummary[]>(
    () =>
      restaurantGroups.map((group) => {
        const restaurant = restaurantsById[group.restaurantId] ?? null;
        const availability = restaurant ? getRestaurantAvailability(restaurant, deliveryLocation) : null;
        const supportsDelivery = restaurant?.supportsDelivery === true;
        const supportsPickup = restaurant?.supportsPickup !== false;
        const minOrder = restaurant?.minOrder ?? 0;
        const deliveryFee = fulfillmentType === 'delivery' ? restaurant?.deliveryFee ?? 0 : 0;
        const belowMinimum = restaurant ? group.subtotal < minOrder : false;
        const outOfArea = fulfillmentType === 'delivery' && availability?.reason === 'out_of_area';
        let warning: string | null = null;

        if (restaurantsLoading) {
          warning = 'Loading restaurant details...';
        } else if (!restaurant) {
          warning = 'This restaurant is no longer available for checkout.';
        } else if (restaurant.isOpen === false) {
          warning = 'This restaurant is currently closed.';
        } else if (restaurant.isPublished !== true) {
          warning = 'This restaurant is currently unavailable for new orders.';
        } else if (fulfillmentType === 'delivery' && !supportsDelivery) {
          warning = 'This restaurant does not support delivery.';
        } else if (fulfillmentType === 'pickup' && !supportsPickup) {
          warning = 'Pickup is no longer available for this restaurant.';
        } else if (outOfArea) {
          warning = 'This restaurant does not deliver to your pinned address. Try pickup or choose a closer restaurant.';
        } else if (belowMinimum) {
          warning = `Add ${Math.max(1, Math.ceil(minOrder - group.subtotal)).toLocaleString('en-US')} more to meet the minimum order.`;
        }

        return {
          deliveryFee,
          items: group.items,
          minOrder,
          restaurant,
          restaurantId: group.restaurantId,
          restaurantName: restaurant?.name ?? group.restaurantName,
          subtotal: group.subtotal,
          supportsDelivery,
          supportsPickup,
          totalQuantity: group.totalQuantity,
          warning,
        };
      }),
    [deliveryLocation, fulfillmentType, restaurantGroups, restaurantsById, restaurantsLoading]
  );

  const basketSubtotal = restaurantSummaries.reduce((sum, group) => sum + group.subtotal, 0);
  const basketDeliveryFee = fulfillmentType === 'delivery' ? restaurantSummaries.reduce((sum, group) => sum + group.deliveryFee, 0) : 0;
  const pricingPreview = calculateCheckoutTotal({
    deliveryFee: basketDeliveryFee,
    subtotal: basketSubtotal,
    tip: safeTipAmount,
  });
  const basketSupportsDelivery = restaurantSummaries.length > 0 && restaurantSummaries.every((group) => group.supportsDelivery);
  const basketSupportsPickup = restaurantSummaries.length > 0 && restaurantSummaries.every((group) => group.supportsPickup);
  const checkoutBlockedReason = !isCovered
    ? COVERAGE_COMING_SOON_COPY
    : !allRestaurantsLoaded
      ? 'Loading restaurant details...'
      : restaurantSummaries.find((group) => group.warning)?.warning ?? null;
  const promoEligible = !isMixedBasket && restaurantSummaries.length === 1 && Boolean(primaryRestaurantId) && allRestaurantsLoaded;
  const promoDiscount = promoEligible && appliedPromo?.valid ? appliedPromo.discount : 0;
  const effectiveTotal = promoDiscount > 0 ? Math.max(pricingPreview.total - promoDiscount, 0) : pricingPreview.total;
  const checkoutTitle = isMixedBasket
    ? `${restaurantSummaries.length} restaurants in cart`
    : restaurantSummaries[0]?.restaurantName ?? primaryRestaurantName ?? 'Checkout';
  const checkoutSubtitle = isMixedBasket
    ? 'Orders are grouped by restaurant. One payment completes the basket.'
    : 'Review your order before checkout.';
  const needsDeliveryLocation = fulfillmentType === 'delivery' && !deliveryLocation;
  // A missing delivery address is deliberately NOT a disable reason: the button
  // labels itself "Choose delivery location" in that state and `handlePlaceOrder`
  // routes to the map, so disabling it made its own label a lie and left the
  // `router.push('/delivery-location')` branch below unreachable. The button is
  // disabled only for reasons that hold for signed-in and signed-out visitors
  // alike - already submitting, a blocked basket (closed, unpublished, out of
  // coverage, below minimum, still loading), or no restaurant at all.
  const checkoutDisabled = submitting || Boolean(checkoutBlockedReason) || !primaryRestaurantId;

  useEffect(() => {
    setDeliveryNote(deliveryLocation?.note ?? '');
  }, [deliveryLocation?.note]);

  useEffect(() => {
    if (restaurantsLoading) {
      return;
    }

    if (fulfillmentType === 'delivery' && !basketSupportsDelivery && basketSupportsPickup) {
      setFulfillmentType('pickup');
      return;
    }

    if (fulfillmentType === 'pickup' && !basketSupportsPickup && basketSupportsDelivery) {
      setFulfillmentType('delivery');
    }
  }, [basketSupportsDelivery, basketSupportsPickup, fulfillmentType, restaurantsLoading, setFulfillmentType]);

  useEffect(() => {
    if (!user) {
      setTipAmount(DEFAULT_TIP_AMOUNT);
      setCheckoutError(null);
    }
  }, [user]);

  useEffect(() => {
    setAppliedPromo(null);
    setPromoMessage(isMixedBasket ? 'Promo codes are unavailable for mixed baskets.' : null);
  }, [fulfillmentType, isMixedBasket, primaryRestaurantId, safeTipAmount, total]);

  useEffect(() => {
    if (!user || !primaryRestaurantId || items.length === 0 || isMixedBasket) {
      setAutoOffers([]);
      return;
    }

    let cancelled = false;
    validateCustomerPromoCode({ fulfillmentType, items, restaurantId: primaryRestaurantId, tipAmount: safeTipAmount })
      .then((preview) => {
        if (!cancelled) {
          setAutoOffers(preview.automaticOffers ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutoOffers([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fulfillmentType, isMixedBasket, items, primaryRestaurantId, safeTipAmount, user]);

  const handleApplyPromo = useCallback(async () => {
    const code = promoCodeInput.trim();
    if (isMixedBasket) {
      setPromoMessage('Promo codes are unavailable for mixed baskets.');
      return;
    }

    if (!code || !primaryRestaurantId) {
      return;
    }

    setPromoChecking(true);
    setPromoMessage(null);
    try {
      const preview = await validateCustomerPromoCode({
        fulfillmentType,
        items,
        promoCode: code,
        restaurantId: primaryRestaurantId,
        tipAmount: safeTipAmount,
      });
      setAppliedPromo(preview);
      setPromoMessage(preview.valid ? null : preview.message ?? 'This promo code is not valid.');
    } catch {
      setAppliedPromo(null);
      setPromoMessage('Could not check that code. Please try again.');
    } finally {
      setPromoChecking(false);
    }
  }, [fulfillmentType, isMixedBasket, items, primaryRestaurantId, promoCodeInput, safeTipAmount]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      isCheckoutScreenFocusedRef.current = true;
      setSubmitting(false);

      return () => {
        isCheckoutScreenFocusedRef.current = false;
      };
    }, [])
  );

  const isVisible = useAppStateVisibility();
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const loadRestaurants = useCallback(async () => {
    if (!restaurantIds.length) {
      return;
    }

    setRestaurantsLoading(true);
    try {
      const results = await Promise.allSettled(
        restaurantIds.map(async (id) => {
          const { restaurant } = await getRestaurantDetail(id);
          return [id, restaurant as RestaurantDocument | null] as const;
        })
      );

      if (!activeRef.current) {
        return;
      }

      const nextRestaurants: Record<string, RestaurantDocument | null> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const [id, restaurant] = result.value;
          nextRestaurants[id] = restaurant;
        }
      }
      setRestaurantsById(nextRestaurants);
    } catch {
      if (activeRef.current) {
        setRestaurantsById({});
      }
    } finally {
      if (activeRef.current) {
        setRestaurantsLoading(false);
      }
    }
  }, [restaurantIdsKey]);

  const subscribeToRestaurants = useCallback<RealtimeResourceSubscribe>(
    (onChanged, onStatusChange) =>
      subscribeToRealtimeChanges(
        supabase,
        [RESTAURANTS_REALTIME_TOPIC],
        (payload) => {
          const changedRestaurantId = typeof payload.restaurantId === 'string' ? payload.restaurantId : null;
          if (changedRestaurantId && !restaurantIds.includes(changedRestaurantId)) {
            return;
          }

          onChanged();
        },
        onStatusChange
      ),
    [restaurantIdsKey]
  );

  useRealtimeResource({
    subscribe: subscribeToRestaurants,
    load: loadRestaurants,
    isVisible,
    fallbackMs: 120000,
    enabled: restaurantIds.length > 0,
  });

  const handleFulfillmentChange = (nextType: FulfillmentType) => {
    if (nextType === 'delivery' && !basketSupportsDelivery) {
      return;
    }

    if (nextType === 'pickup' && !basketSupportsPickup) {
      return;
    }

    setCheckoutError(null);
    setFulfillmentType(nextType);
    trackAnalyticsEvent('customer_checkout_fulfillment_changed', {
      fulfillment_type: nextType,
    });
  };

  const handleDeliveryNoteChange = (note: string) => {
    setDeliveryNote(note);

    if (deliveryLocation) {
      setDeliveryLocation({
        ...deliveryLocation,
        note: note.trim() || null,
      });
    }
  };

  const handlePlaceOrder = async () => {
    if (!primaryRestaurantId || items.length === 0) {
      return;
    }

    setCheckoutError(null);

    // Belt and braces: the button is already disabled while this is set, and the
    // reason itself is rendered inline in the Fulfillment card. No Alert here -
    // Alert is inert on web, which is how the whole prompt path went silent.
    if (checkoutBlockedReason) {
      return;
    }

    // Before the sign-in demand, and for signed-out visitors too: picking where
    // the food goes needs no account (the cart, address included, is device-local),
    // and asking someone to sign in only to bounce them to a map afterwards is the
    // dead end this screen used to be.
    if (needsDeliveryLocation) {
      router.push('/delivery-location');
      return;
    }

    if (!user) {
      promptForAuth({
        title: 'Sign in to place your order',
        message: 'You can browse freely, but checkout starts after you sign in or create an account.',
        redirectTo: resolveAuthRedirectTo(pathname),
      });
      return;
    }

    trackAnalyticsEvent('customer_checkout_started', {
      fulfillment_type: fulfillmentType,
      items_count: items.length,
      mixed_basket: isMixedBasket,
      payment_method: paymentMethod,
      restaurant_count: restaurantSummaries.length,
      restaurant_id: primaryRestaurantId,
      tip_amount: safeTipAmount,
      has_delivery_location: Boolean(deliveryLocation),
    });

    if (scheduleMode === 'later' && !selectedSlotIso) {
      setCheckoutError('Pick a delivery time, or switch back to ordering now.');
      return;
    }

    setSubmitting(true);
    try {
      const checkoutPayload = {
        deliveryLocation:
          fulfillmentType === 'delivery' && deliveryLocation
            ? {
                ...deliveryLocation,
                note: deliveryNote.trim() || null,
              }
            : null,
        fulfillmentType,
        items,
        paymentMethod,
        promoCode: promoEligible && appliedPromo?.valid ? appliedPromo.code : promoEligible ? promoCodeInput.trim() || null : null,
        restaurantId: primaryRestaurantId,
        // Omitted for "order now", so an immediate order sends the payload it
        // always sent. The server re-validates this and 412s an invalid slot.
        scheduledFor: scheduleMode === 'later' ? selectedSlotIso : null,
        tipAmount: safeTipAmount,
      };

      const { authorizationUrl, orderId } = await initializeCustomerPayment(checkoutPayload);
      trackAnalyticsEvent('customer_payment_redirect_requested', {
        order_id: orderId,
        payment_method: paymentMethod,
      });
      router.push({
        pathname: '/payment',
        params: {
          authorizationUrl,
          orderId,
        },
      } as never);
    } catch {
      trackAnalyticsEvent('customer_checkout_failed', {
        reason: 'payment_flow_error',
      });
      if (isCheckoutScreenFocusedRef.current) {
        setCheckoutError(CHECKOUT_FAILURE_MESSAGE);
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  if (items.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <Text style={styles.emptyCopy}>Pick a restaurant and add a few dishes to get started.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>Checkout</Text>
            <Text style={styles.title}>{checkoutTitle}</Text>
            <Text style={styles.subtitle}>{checkoutSubtitle}</Text>
            <Text style={styles.heroMeta}>
              {items.length} item{items.length === 1 ? '' : 's'}
              {isMixedBasket ? ` across ${restaurantSummaries.length} restaurants` : ''}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>
                {formatMoney(item.price)} each{isMixedBasket ? ` · ${item.restaurantName}` : ''}
              </Text>
            </View>

            <View style={styles.itemActions}>
              <TouchableOpacity style={styles.quantityButton} onPress={() => updateQuantity(item.id, item.quantity - 1)}>
                <Text style={styles.quantityButtonText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.quantityText}>{item.quantity}</Text>
              <TouchableOpacity style={styles.quantityButton} onPress={() => updateQuantity(item.id, item.quantity + 1)}>
                <Text style={styles.quantityButtonText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeButton} onPress={() => removeItem(item.id)}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            {isMixedBasket ? (
              <View style={styles.mixedBasketCard}>
                <Text style={styles.mixedBasketTitle}>Mixed basket</Text>
                <Text style={styles.mixedBasketCopy}>
                  Orders are prepared separately by restaurant. One payment covers the full basket.
                </Text>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Grouped subtotals</Text>
              {restaurantSummaries.map((summary) => (
                <View key={summary.restaurantId} style={styles.groupCard}>
                  <View style={styles.groupHeader}>
                    <View style={styles.groupHeaderCopy}>
                      <Text style={styles.groupTitle}>{summary.restaurantName}</Text>
                      <Text style={styles.groupMeta}>
                        {summary.totalQuantity} item{summary.totalQuantity === 1 ? '' : 's'} · {summary.items.length} line
                        {summary.items.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Text style={styles.groupSubtotal}>{formatMoney(summary.subtotal)}</Text>
                  </View>
                  <View style={styles.summarySplit}>
                    <Text style={styles.summaryDetailLabel}>Delivery fee</Text>
                    <Text style={styles.summaryDetailValue}>
                      {fulfillmentType === 'delivery' ? formatMoney(summary.deliveryFee) : 'No delivery fee'}
                    </Text>
                  </View>
                  {summary.warning ? (
                    <Text style={styles.groupWarning}>{summary.warning}</Text>
                  ) : (
                    <Text style={styles.groupReady}>Ready for {fulfillmentType}</Text>
                  )}
                </View>
              ))}
              <Text style={styles.groupNote}>
                Restaurant subtotals are itemized here; payment is still captured once for the entire basket.
              </Text>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Fulfillment</Text>
              <View style={styles.fulfillmentToggle}>
                <TouchableOpacity
                  style={[
                    styles.fulfillmentOption,
                    fulfillmentType === 'delivery' ? styles.fulfillmentOptionActive : styles.fulfillmentOptionIdle,
                    !basketSupportsDelivery ? styles.fulfillmentOptionDisabled : null,
                  ]}
                  onPress={() => handleFulfillmentChange('delivery')}
                  disabled={!basketSupportsDelivery}
                >
                  <FontAwesome
                    name="motorcycle"
                    size={15}
                    color={fulfillmentType === 'delivery' ? '#fff' : customerTheme.accentStrong}
                  />
                  <View style={styles.fulfillmentOptionLabel}>
                    <Text
                      style={[
                        styles.fulfillmentOptionText,
                        fulfillmentType === 'delivery' ? styles.fulfillmentOptionTextActive : null,
                      ]}
                    >
                      Delivery
                    </Text>
                    {!basketSupportsDelivery ? <Text style={styles.fulfillmentSoonText}>Mixed basket</Text> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.fulfillmentOption,
                    fulfillmentType === 'pickup' ? styles.fulfillmentOptionActive : styles.fulfillmentOptionIdle,
                    !basketSupportsPickup ? styles.fulfillmentOptionDisabled : null,
                  ]}
                  onPress={() => handleFulfillmentChange('pickup')}
                  disabled={!basketSupportsPickup}
                >
                  <FontAwesome
                    name="shopping-bag"
                    size={15}
                    color={fulfillmentType === 'pickup' ? '#fff' : customerTheme.accentStrong}
                  />
                  <View style={styles.fulfillmentOptionLabel}>
                    <Text
                      style={[
                        styles.fulfillmentOptionText,
                        fulfillmentType === 'pickup' ? styles.fulfillmentOptionTextActive : null,
                      ]}
                    >
                      Pickup
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
              <Text style={styles.fulfillmentHint}>
                {isMixedBasket
                  ? 'Each restaurant is checked on its own rules. Delivery only stays available when every restaurant supports it.'
                  : fulfillmentType === 'delivery'
                    ? 'We will deliver to the pinned map location you choose below.'
                    : 'Skip the map step and collect your order directly from the restaurant.'}
              </Text>
              {checkoutBlockedReason ? <Text style={styles.warningText}>{checkoutBlockedReason}</Text> : null}
            </View>

            {/* No `user ?` gate. Setting a delivery spot is a device-local decision
                (CartContext persists it to AsyncStorage), so hiding this section behind
                sign-in left signed-out visitors unable to see a delivery fee, unable to
                get coverage feedback, and - because a missing address disabled the
                button - unable to press the one control that offered them sign-in. */}
            {fulfillmentType === 'delivery' ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>Delivery location</Text>
                {deliveryLocation ? (
                  <TouchableOpacity style={styles.locationCard} onPress={() => router.push('/delivery-location')} activeOpacity={0.9}>
                    <View style={styles.locationIconWrap}>
                      <FontAwesome name="map-marker" size={20} color="#ef4444" />
                    </View>
                    <View style={styles.locationCopy}>
                      <Text style={styles.locationTitle}>{deliveryLocation.shortAddress ?? 'Pinned delivery spot'}</Text>
                      <Text style={styles.locationAddress}>{deliveryLocation.address}</Text>
                    </View>
                    <Text style={styles.locationAction}>Change</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.locationEmptyCard} onPress={() => router.push('/delivery-location')} activeOpacity={0.9}>
                    <View style={styles.locationEmptyIcon}>
                      <FontAwesome name="crosshairs" size={17} color={customerTheme.accentStrong} />
                    </View>
                    <View style={styles.locationCopy}>
                      <Text style={styles.locationTitle}>Choose where we should deliver</Text>
                      <Text style={styles.locationAddress}>Drop a pin on the map to set your exact delivery spot.</Text>
                    </View>
                  </TouchableOpacity>
                )}

                <TextInput
                  style={styles.noteInput}
                  placeholder="Apartment, suite, or landmark (optional)"
                  placeholderTextColor={customerTheme.textSoft}
                  value={deliveryNote}
                  onChangeText={handleDeliveryNoteChange}
                />
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>Pickup</Text>
                <View style={styles.pickupCard}>
                  <View style={styles.pickupIcon}>
                    <FontAwesome name="shopping-bag" size={17} color={customerTheme.accentStrong} />
                  </View>
                  <View style={styles.locationCopy}>
                    <Text style={styles.locationTitle}>
                      Pickup from {isMixedBasket ? `${restaurantSummaries.length} restaurants` : restaurantSummaries[0]?.restaurantName ?? primaryRestaurantName}
                    </Text>
                    <Text style={styles.locationAddress}>
                      We will keep each order ready for collection once the restaurant marks it prepared.
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Payment</Text>
              <View style={styles.optionGrid}>
                {paymentOptions.map((option) => {
                  const isActive = paymentMethod === option;
                  const supportingCopy = option === 'bank_transfer' ? 'Pay with transfer' : 'Pay with card';

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.optionCard, isActive ? styles.optionCardActive : null]}
                      onPress={() => {
                        setCheckoutError(null);
                        setPaymentMethod(option);
                        trackAnalyticsEvent('customer_checkout_payment_method_changed', {
                          payment_method: option,
                        });
                      }}
                    >
                      <Text style={[styles.optionTitle, isActive ? styles.optionTitleActive : null]}>
                        {formatPaymentMethodLabel(option)}
                      </Text>
                      <Text style={[styles.optionCopy, isActive ? styles.optionCopyActive : null]}>{supportingCopy}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>{fulfillmentType === 'pickup' ? 'Tip restaurant' : 'Tip rider'}</Text>
              <View style={styles.tipRow}>
                {tipOptions.map((option) => {
                  const isActive = tipAmount === option;

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.tipChip, isActive ? styles.tipChipActive : null]}
                      onPress={() => {
                        setCheckoutError(null);
                        setTipAmount(option);
                      }}
                    >
                      <Text style={[styles.tipChipText, isActive ? styles.tipChipTextActive : null]}>
                        {option === 0 ? 'No tip' : formatMoney(option)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {schedulingAvailable ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>When</Text>
                <View style={styles.tipRow}>
                  {(['now', 'later'] as const).map((mode) => {
                    const isActive = scheduleMode === mode;
                    return (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.tipChip, isActive ? styles.tipChipActive : null]}
                        onPress={() => {
                          setCheckoutError(null);
                          setScheduleMode(mode);
                          if (mode === 'now') {
                            setSelectedSlotIso(null);
                          }
                        }}
                      >
                        <Text style={[styles.tipChipText, isActive ? styles.tipChipTextActive : null]}>
                          {mode === 'now' ? 'Order now' : 'Schedule for later'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {scheduleMode === 'later' ? (
                  <View style={styles.scheduleDayList}>
                    {scheduleDays.map((day) => (
                      <View key={day.dayKey} style={styles.scheduleDay}>
                        <Text style={styles.scheduleDayLabel}>{formatScheduleDayLabel(day.dayKey)}</Text>
                        <View style={styles.tipRow}>
                          {day.slots.map((slot) => {
                            const isActive = selectedSlotIso === slot.iso;
                            return (
                              <TouchableOpacity
                                key={slot.iso}
                                style={[styles.tipChip, isActive ? styles.tipChipActive : null]}
                                onPress={() => {
                                  setCheckoutError(null);
                                  setSelectedSlotIso(slot.iso);
                                }}
                              >
                                <Text style={[styles.tipChipText, isActive ? styles.tipChipTextActive : null]}>
                                  {slot.timeLabel}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.summaryCard}>
              {checkoutError ? (
                <View style={styles.checkoutErrorCard}>
                  <Text style={styles.checkoutErrorTitle}>Payment failed</Text>
                  <Text style={styles.checkoutErrorCopy}>{checkoutError}</Text>
                </View>
              ) : null}
              <Text style={styles.sectionLabel}>Summary</Text>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Subtotal</Text>
                <Text style={styles.summaryDetailValue}>{formatMoney(basketSubtotal)}</Text>
              </View>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Delivery fee</Text>
                <Text style={styles.summaryDetailValue}>
                  {fulfillmentType === 'delivery' ? formatMoney(pricingPreview.deliveryFee) : 'No delivery fee'}
                </Text>
              </View>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Tip</Text>
                <Text style={styles.summaryDetailValue}>{formatMoney(pricingPreview.tip)}</Text>
              </View>

              <View style={styles.promoRow}>
                <TextInput
                  style={styles.promoInput}
                  placeholder="Promo code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={promoCodeInput}
                  onChangeText={setPromoCodeInput}
                  editable={!promoChecking && promoEligible}
                />
                <TouchableOpacity
                  style={[
                    styles.promoApplyButton,
                    promoChecking || !promoCodeInput.trim() || !promoEligible ? styles.promoApplyDisabled : null,
                  ]}
                  onPress={handleApplyPromo}
                  disabled={promoChecking || !promoCodeInput.trim() || !promoEligible}
                >
                  <Text style={styles.promoApplyText}>{promoChecking ? '...' : 'Apply'}</Text>
                </TouchableOpacity>
              </View>
              {!promoEligible ? <Text style={styles.promoAuto}>Promo codes are unavailable for mixed baskets.</Text> : null}
              {promoMessage ? <Text style={styles.promoError}>{promoMessage}</Text> : null}
              {autoOffers.length > 0 && !appliedPromo?.valid ? (
                <Text style={styles.promoAuto}>
                  Offer applied automatically: {formatMoney(autoOffers[0].discount)} off
                </Text>
              ) : null}
              {promoDiscount > 0 ? (
                <View style={styles.summarySplit}>
                  <Text style={styles.summaryDetailLabel}>
                    Discount{appliedPromo?.applied?.code ? ` (${appliedPromo.applied.code})` : ''}
                  </Text>
                  <Text style={styles.summaryDiscountValue}>-{formatMoney(promoDiscount)}</Text>
                </View>
              ) : null}

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Order total</Text>
                <Text style={styles.summaryValue}>{formatMoney(effectiveTotal)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.checkoutButton, checkoutDisabled ? styles.checkoutButtonDisabled : null]}
                onPress={handlePlaceOrder}
                disabled={checkoutDisabled}
              >
                {/* Ordered exactly like handlePlaceOrder's guards, so the label always
                    names what the next press will actually do. Sign-in is named last:
                    it is the final step of checkout, not the price of using the screen. */}
                <Text style={styles.checkoutButtonText}>
                  {checkoutBlockedReason
                    ? 'Checkout unavailable'
                    : needsDeliveryLocation
                      ? 'Choose delivery location'
                      : !user
                        ? 'Sign in to place order'
                        : submitting
                          ? 'Opening payment...'
                          : 'Pay and place order'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.paymentHint}>
                A secure in-app payment screen will open. The order goes live after payment confirms.
              </Text>
            </View>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
      {authPromptDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  listContent: {
    padding: 14,
    paddingBottom: 28,
  },
  emptyContainer: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyCopy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  heroCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  heroEyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  heroMeta: {
    color: customerTheme.textSoft,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  title: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 8,
  },
  subtitle: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 5,
  },
  itemCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  itemCopy: {
    marginBottom: 10,
  },
  itemName: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  itemMeta: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  itemActions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  quantityButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  quantityButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  quantityText: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '700',
    marginHorizontal: 12,
  },
  removeButton: {
    marginLeft: 'auto',
  },
  removeButtonText: {
    color: customerTheme.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  footer: {
    paddingTop: 4,
  },
  mixedBasketCard: {
    backgroundColor: '#f8fbff',
    borderColor: '#d6e7ff',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  mixedBasketTitle: {
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  mixedBasketCopy: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  sectionCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  sectionLabel: {
    color: customerTheme.textSoft,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  groupCard: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  groupHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupHeaderCopy: {
    flex: 1,
    paddingRight: 12,
  },
  groupTitle: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  groupMeta: {
    color: customerTheme.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  groupSubtotal: {
    color: customerTheme.accentStrong,
    fontSize: 16,
    fontWeight: '800',
  },
  groupWarning: {
    color: '#8a4f12',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 8,
  },
  groupReady: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 8,
  },
  groupNote: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  fulfillmentToggle: {
    backgroundColor: customerTheme.surfaceStrong,
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 4,
  },
  fulfillmentOption: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fulfillmentOptionActive: {
    backgroundColor: customerTheme.accent,
  },
  fulfillmentOptionIdle: {
    backgroundColor: 'transparent',
  },
  fulfillmentOptionDisabled: {
    opacity: 0.6,
  },
  fulfillmentOptionLabel: {
    alignItems: 'center',
    marginLeft: 8,
  },
  fulfillmentOptionText: {
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  fulfillmentOptionTextActive: {
    color: '#fff',
  },
  fulfillmentSoonText: {
    color: customerTheme.warning,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 1,
  },
  fulfillmentHint: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  warningText: {
    color: '#8a4f12',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 8,
  },
  locationCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 14,
  },
  locationEmptyCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 14,
  },
  locationIconWrap: {
    alignItems: 'center',
    backgroundColor: '#fde7e7',
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    marginRight: 12,
    width: 38,
  },
  locationEmptyIcon: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    marginRight: 12,
    width: 38,
  },
  locationCopy: {
    flex: 1,
  },
  locationTitle: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  locationAddress: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  locationAction: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 10,
  },
  noteInput: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 12,
    borderWidth: 1,
    color: customerTheme.text,
    height: 46,
    paddingHorizontal: 14,
  },
  pickupCard: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceStrong,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 14,
  },
  pickupIcon: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderRadius: 14,
    height: 38,
    justifyContent: 'center',
    marginRight: 12,
    width: 38,
  },
  optionGrid: {
    gap: 10,
  },
  optionCard: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  optionCardActive: {
    backgroundColor: customerTheme.surfaceStrong,
    borderColor: customerTheme.accent,
  },
  optionTitle: {
    color: customerTheme.text,
    fontSize: 14,
    fontWeight: '800',
  },
  optionTitleActive: {
    color: customerTheme.accentStrong,
  },
  optionCopy: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  optionCopyActive: {
    color: customerTheme.textSoft,
  },
  scheduleDayList: {
    gap: 12,
    marginTop: 12,
  },
  scheduleDay: {
    gap: 6,
  },
  scheduleDayLabel: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tipChip: {
    backgroundColor: customerTheme.background,
    borderColor: customerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tipChipActive: {
    backgroundColor: customerTheme.accent,
    borderColor: customerTheme.accent,
  },
  tipChipText: {
    color: customerTheme.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  tipChipTextActive: {
    color: '#fff',
  },
  summaryCard: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  checkoutErrorCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  checkoutErrorTitle: {
    color: '#991b1b',
    fontSize: 13,
    fontWeight: '800',
  },
  checkoutErrorCopy: {
    color: '#7f1d1d',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  summarySplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryDetailLabel: {
    color: customerTheme.textMuted,
    fontSize: 13,
  },
  promoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    marginTop: 4,
  },
  promoInput: {
    backgroundColor: '#fff',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    borderWidth: 1,
    color: customerTheme.text,
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promoApplyButton: {
    backgroundColor: customerTheme.accentStrong,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  promoApplyDisabled: {
    opacity: 0.5,
  },
  promoApplyText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  promoError: {
    color: '#b91c1c',
    fontSize: 12,
    marginBottom: 6,
  },
  promoAuto: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  summaryDiscountValue: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '800',
  },
  summaryDetailValue: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryRow: {
    borderTopColor: customerTheme.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    marginTop: 4,
    paddingTop: 12,
  },
  summaryLabel: {
    color: customerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  summaryValue: {
    color: customerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
  },
  checkoutButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  checkoutButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  checkoutButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  paymentHint: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
});

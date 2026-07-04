import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AuthPromptCard from '../../src/components/AuthPromptCard';
import { useAuth } from '../../src/contexts/AuthContext';
import { useCart } from '../../src/contexts/CartContext';
import type { RestaurantDocument } from '../../src/domain/entities';
import {
  type CheckoutPaymentMethod,
  type FulfillmentType,
  formatPaymentMethodLabel,
} from '../../src/domain/orders';
import {
  initializeCustomerPayment,
} from '../../src/services/customerOrderActions';
import { trackAnalyticsEvent } from '../../../../packages/observability/src/analytics';
import { getPublishedRestaurantDetail } from '../../src/services/publicRestaurantReadModel';
import { customerTheme } from '../../src/theme/palette';
import { promptForAuth } from '../../src/utils/authPrompt';
import { calculateCheckoutTotal } from '../../src/utils/checkoutPricing';

const tipOptions = [0, 100, 150, 200] as const;
const DEFAULT_TIP_AMOUNT = tipOptions[0];
const CHECKOUT_FAILURE_MESSAGE = 'Check network and try again.';
const paymentOptions: CheckoutPaymentMethod[] = ['card', 'bank_transfer'];
const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;
const formatPlainNumber = (amount: number) => Math.round(amount).toLocaleString('en-US');

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
  const [deliveryNote, setDeliveryNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('card');
  const [restaurant, setRestaurant] = useState<RestaurantDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(DEFAULT_TIP_AMOUNT);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const router = useRouter();
  const isMountedRef = useRef(true);
  const isCheckoutScreenFocusedRef = useRef(false);
  const deliveryFee = fulfillmentType === 'delivery' ? restaurant?.deliveryFee ?? 0 : 0;
  const safeTipAmount = tipOptions.includes(tipAmount as (typeof tipOptions)[number]) ? tipAmount : DEFAULT_TIP_AMOUNT;
  const pricingPreview = calculateCheckoutTotal({
    deliveryFee,
    subtotal: total,
    tip: safeTipAmount,
  });
  const minOrder = restaurant?.minOrder ?? 0;
  const belowMinimum = total > 0 && total < minOrder;
  // Delivery is offered only when the restaurant self-provisions it (opt-in).
  // Everyone else is pickup-only with delivery shown as "coming soon".
  const isDeliverySupported = restaurant?.supportsDelivery === true;
  const isPickupSupported = restaurant?.supportsPickup !== false;
  const deliveryComingSoon = Boolean(restaurant) && !isDeliverySupported;
  const isRestaurantPublished = restaurant?.isPublished === true;
  const restaurantUnavailableReason =
    !restaurant
      ? 'This restaurant is no longer available for checkout.'
      : restaurant.isOpen === false
        ? 'This restaurant is currently closed.'
          : !isRestaurantPublished
          ? 'This restaurant is currently unavailable for new orders.'
          : fulfillmentType === 'pickup' && !isPickupSupported
            ? 'Pickup is no longer available for this restaurant.'
            : belowMinimum
              ? `Add ${Math.max(1, Math.ceil(minOrder - total)).toLocaleString('en-US')} more to meet the minimum order.`
              : null;

  useEffect(() => {
    setDeliveryNote(deliveryLocation?.note ?? '');
  }, [deliveryLocation?.note]);

  // If this restaurant does not self-provision delivery, delivery is "coming
  // soon" — quietly move the customer to pickup so checkout stays unblocked.
  useEffect(() => {
    if (deliveryComingSoon && fulfillmentType === 'delivery') {
      setFulfillmentType('pickup');
    }
  }, [deliveryComingSoon, fulfillmentType, setFulfillmentType]);

  useEffect(() => {
    if (!user) {
      setTipAmount(DEFAULT_TIP_AMOUNT);
      setCheckoutError(null);
    }
  }, [user]);

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

  useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null);
      return;
    }

    let active = true;

    const loadRestaurant = async () => {
      try {
        const { restaurant: nextRestaurant } = await getPublishedRestaurantDetail(restaurantId);
        if (!active) {
          return;
        }

        setRestaurant(nextRestaurant as RestaurantDocument | null);
      } catch {
        console.warn('Unable to load checkout restaurant.');
        if (active) {
          setRestaurant(null);
        }
      }
    };

    void loadRestaurant();
    const interval = setInterval(() => {
      void loadRestaurant();
    }, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [restaurantId]);

  const handleFulfillmentChange = (nextType: FulfillmentType) => {
    if (nextType === 'delivery' && !isDeliverySupported) {
      return;
    }

    if (nextType === 'pickup' && !isPickupSupported) {
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
    if (!restaurantId || items.length === 0) {
      return;
    }

    setCheckoutError(null);

    if (!user) {
      promptForAuth({
        title: 'Sign in to place your order',
        message: 'You can browse freely, but checkout starts after you sign in or create an account.',
      });
      return;
    }

    if (fulfillmentType === 'delivery' && !deliveryLocation) {
      router.push('/delivery-location');
      return;
    }

    if (belowMinimum) {
      Alert.alert('Minimum order not reached', `This restaurant requires a minimum subtotal of ${formatPlainNumber(minOrder)}.`);
      return;
    }

    trackAnalyticsEvent('customer_checkout_started', {
      fulfillment_type: fulfillmentType,
      items_count: items.length,
      payment_method: paymentMethod,
      restaurant_id: restaurantId,
      tip_amount: safeTipAmount,
      has_delivery_location: Boolean(deliveryLocation),
    });
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
        restaurantId,
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
            <Text style={styles.title}>{restaurantName}</Text>
            <Text style={styles.subtitle}>Review your order before checkout.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>{formatMoney(item.price)} each</Text>
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
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Fulfillment</Text>
              <View style={styles.fulfillmentToggle}>
                <TouchableOpacity
                  style={[
                    styles.fulfillmentOption,
                    fulfillmentType === 'delivery' ? styles.fulfillmentOptionActive : styles.fulfillmentOptionIdle,
                    !isDeliverySupported ? styles.fulfillmentOptionDisabled : null,
                  ]}
                  onPress={() => handleFulfillmentChange('delivery')}
                  disabled={!isDeliverySupported}
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
                    {deliveryComingSoon ? (
                      <Text style={styles.fulfillmentSoonText}>Coming soon</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.fulfillmentOption,
                    fulfillmentType === 'pickup' ? styles.fulfillmentOptionActive : styles.fulfillmentOptionIdle,
                    !isPickupSupported ? styles.fulfillmentOptionDisabled : null,
                  ]}
                  onPress={() => handleFulfillmentChange('pickup')}
                  disabled={!isPickupSupported}
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
                {deliveryComingSoon
                  ? 'This restaurant is pickup-only for now — delivery is coming soon.'
                  : fulfillmentType === 'delivery'
                    ? 'We will deliver to the pinned map location you choose below.'
                    : 'Skip the map step and collect your order directly from the restaurant.'}
              </Text>
              {restaurantUnavailableReason ? <Text style={styles.warningText}>{restaurantUnavailableReason}</Text> : null}
            </View>

            {user ? (
              fulfillmentType === 'delivery' ? (
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
                        <Text style={styles.locationAddress}>
                          Drop a pin on the map, just like Glovo or Uber Eats.
                        </Text>
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
                      <Text style={styles.locationTitle}>Pickup from {restaurantName}</Text>
                      <Text style={styles.locationAddress}>
                        We will keep this order ready for collection once the restaurant marks it prepared.
                      </Text>
                    </View>
                  </View>
                </View>
              )
            ) : (
              <View style={styles.guestPromptWrapper}>
                <AuthPromptCard
                  title="Sign in to check out"
                  message="Your cart is ready. Sign in or create an account before you place the order."
                />
              </View>
            )}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>Payment</Text>
              <View style={styles.optionGrid}>
                {paymentOptions.map((option) => {
                  const isActive = paymentMethod === option;
                  const supportingCopy =
                    option === 'bank_transfer'
                      ? 'Pay with transfer'
                      : 'Pay with card';

                  return (
                      <TouchableOpacity
                        key={option}
                        style={[
                          styles.optionCard,
                          isActive ? styles.optionCardActive : null,
                        ]}
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
                <Text style={styles.summaryDetailValue}>{formatMoney(total)}</Text>
              </View>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Delivery fee</Text>
                <Text style={styles.summaryDetailValue}>
                  {fulfillmentType === 'delivery' ? formatMoney(pricingPreview.deliveryFee) : 'No delivery fee'}
                </Text>
              </View>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Service fee</Text>
                <Text style={styles.summaryDetailValue}>{formatMoney(pricingPreview.serviceFee)}</Text>
              </View>
              <View style={styles.summarySplit}>
                <Text style={styles.summaryDetailLabel}>Tip</Text>
                <Text style={styles.summaryDetailValue}>{formatMoney(pricingPreview.tip)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Order total</Text>
                <Text style={styles.summaryValue}>{formatMoney(pricingPreview.total)}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.checkoutButton,
                  submitting || Boolean(restaurantUnavailableReason) ? styles.checkoutButtonDisabled : null,
                ]}
                onPress={handlePlaceOrder}
                disabled={submitting || Boolean(restaurantUnavailableReason)}
              >
                <Text style={styles.checkoutButtonText}>
                  {user
                    ? fulfillmentType === 'delivery'
                      ? deliveryLocation
                        ? submitting
                          ? 'Opening payment...'
                          : 'Pay and place order'
                        : 'Choose delivery location'
                      : submitting
                        ? 'Opening payment...'
                        : 'Pay and place order'
                    : 'Sign in to place order'}
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
  guestPromptWrapper: {
    marginBottom: 12,
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

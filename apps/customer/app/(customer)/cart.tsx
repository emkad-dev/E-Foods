import { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
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
  placeCustomerOrder,
  PREPAID_CHECKOUT_DISABLED_MESSAGE,
} from '../../src/services/customerOrderActions';
import { db } from '../../src/services/firebase/config';
import { promptForAuth } from '../../src/utils/authPrompt';
import { calculateCheckoutTotal } from '../../src/utils/checkoutPricing';

const tipOptions = [0, 2, 5, 10] as const;
const paymentOptions: CheckoutPaymentMethod[] = ['card', 'wallet', 'cash'];
const comingSoonPayments: CheckoutPaymentMethod[] = ['card', 'wallet'];

export default function CartScreen() {
  const {
    clearCart,
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
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('cash');
  const [restaurant, setRestaurant] = useState<RestaurantDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tipAmount, setTipAmount] = useState(2);
  const router = useRouter();
  const deliveryFee = fulfillmentType === 'delivery' ? restaurant?.deliveryFee ?? 0 : 0;
  const pricingPreview = calculateCheckoutTotal({
    deliveryFee,
    subtotal: total,
    tip: tipAmount,
  });
  const minOrder = restaurant?.minOrder ?? 0;
  const belowMinimum = total > 0 && total < minOrder;
  const isDeliverySupported = restaurant?.supportsDelivery !== false;
  const isPickupSupported = restaurant?.supportsPickup !== false;
  const isRestaurantPublished = restaurant?.isPublished === true;
  const restaurantUnavailableReason =
    !restaurant
      ? 'Restaurant details are still loading. Wait a moment before checkout.'
      : restaurant.isOpen === false
        ? 'This restaurant is currently closed.'
        : !isRestaurantPublished
          ? 'This restaurant is awaiting admin approval and is not available for new orders.'
          : fulfillmentType === 'delivery' && !isDeliverySupported
            ? 'Delivery is no longer available for this restaurant.'
            : fulfillmentType === 'pickup' && !isPickupSupported
              ? 'Pickup is no longer available for this restaurant.'
              : belowMinimum
                ? `Add $${(minOrder - total).toFixed(2)} more to meet the minimum order.`
                : null;

  useEffect(() => {
    setDeliveryNote(deliveryLocation?.note ?? '');
  }, [deliveryLocation?.note]);

  useEffect(() => {
    if (paymentMethod !== 'cash' && comingSoonPayments.includes(paymentMethod)) {
      setPaymentMethod('cash');
    }
  }, [paymentMethod]);

  useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'restaurants', restaurantId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setRestaurant(null);
          return;
        }

        const restaurantData = snapshot.data() as RestaurantDocument;

        setRestaurant({
          ...restaurantData,
          id: snapshot.id,
        });
      },
      (error) => {
        console.error('Error loading checkout restaurant:', error);
        setRestaurant(null);
      }
    );

    return unsubscribe;
  }, [restaurantId]);

  const handleFulfillmentChange = (nextType: FulfillmentType) => {
    if (nextType === 'delivery' && !isDeliverySupported) {
      return;
    }

    if (nextType === 'pickup' && !isPickupSupported) {
      return;
    }

    setFulfillmentType(nextType);
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
      Alert.alert('Minimum order not reached', `This restaurant requires a minimum subtotal of $${minOrder.toFixed(2)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const { orderId } = await placeCustomerOrder({
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
        tipAmount,
      });

      clearCart();
      router.replace(`/orders/${orderId}`);
    } catch (error: any) {
      Alert.alert('Order failed', error.message ?? 'Something went wrong while placing your order.');
    } finally {
      setSubmitting(false);
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
          <View style={styles.header}>
            <Text style={styles.title}>{restaurantName}</Text>
            <Text style={styles.subtitle}>Review your order before checkout.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>${item.price.toFixed(2)} each</Text>
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
            <View style={styles.fulfillmentSection}>
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
                    size={16}
                    color={fulfillmentType === 'delivery' ? '#fff' : '#8a6442'}
                  />
                  <Text
                    style={[
                      styles.fulfillmentOptionText,
                      fulfillmentType === 'delivery' ? styles.fulfillmentOptionTextActive : null,
                    ]}
                  >
                    Delivery
                  </Text>
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
                  <FontAwesome name="shopping-bag" size={16} color={fulfillmentType === 'pickup' ? '#fff' : '#8a6442'} />
                  <Text
                    style={[
                      styles.fulfillmentOptionText,
                      fulfillmentType === 'pickup' ? styles.fulfillmentOptionTextActive : null,
                    ]}
                  >
                    Pickup
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.fulfillmentHint}>
                {fulfillmentType === 'delivery'
                  ? 'We will deliver to the pinned map location you choose below.'
                  : 'Skip the map step and collect your order directly from the restaurant.'}
              </Text>
              {restaurantUnavailableReason ? <Text style={styles.warningText}>{restaurantUnavailableReason}</Text> : null}
            </View>

            {user ? (
              fulfillmentType === 'delivery' ? (
                <View style={styles.locationSection}>
                  <Text style={styles.sectionLabel}>Delivery location</Text>
                  {deliveryLocation ? (
                    <TouchableOpacity
                      style={styles.locationCard}
                      onPress={() => router.push('/delivery-location')}
                      activeOpacity={0.9}
                    >
                      <View style={styles.locationIconWrap}>
                        <FontAwesome name="map-marker" size={22} color="#ef4444" />
                      </View>
                      <View style={styles.locationCopy}>
                        <Text style={styles.locationTitle}>
                          {deliveryLocation.shortAddress ?? 'Pinned delivery spot'}
                        </Text>
                        <Text style={styles.locationAddress}>{deliveryLocation.address}</Text>
                      </View>
                      <Text style={styles.locationAction}>Change</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.locationEmptyCard}
                      onPress={() => router.push('/delivery-location')}
                      activeOpacity={0.9}
                    >
                      <View style={styles.locationEmptyIcon}>
                        <FontAwesome name="crosshairs" size={18} color="#7a5b23" />
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
                    value={deliveryNote}
                    onChangeText={handleDeliveryNoteChange}
                  />
                </View>
              ) : (
                <View style={styles.pickupCard}>
                  <View style={styles.pickupIcon}>
                    <FontAwesome name="shopping-bag" size={18} color="#7a5b23" />
                  </View>
                  <View style={styles.locationCopy}>
                    <Text style={styles.locationTitle}>Pickup from {restaurantName}</Text>
                    <Text style={styles.locationAddress}>
                      We will keep this order ready for collection once the restaurant marks it prepared.
                    </Text>
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
            <View style={styles.paymentSection}>
              <Text style={styles.sectionLabel}>Payment</Text>
              <View style={styles.optionGrid}>
                {paymentOptions.map((option) => {
                  const isActive = paymentMethod === option;
                  const isDisabled = comingSoonPayments.includes(option);
                  const supportingCopy =
                    option === 'cash'
                      ? fulfillmentType === 'pickup'
                        ? 'Pay at pickup'
                        : 'Pay on delivery'
                      : option === 'wallet'
                        ? 'Coming soon'
                        : 'Coming soon';

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.optionCard,
                        isActive ? styles.optionCardActive : null,
                        isDisabled ? styles.optionCardDisabled : null,
                      ]}
                      onPress={() => {
                        if (isDisabled) {
                          Alert.alert('Coming soon', PREPAID_CHECKOUT_DISABLED_MESSAGE);
                          return;
                        }

                        setPaymentMethod(option);
                      }}
                      disabled={isDisabled}
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
            <View style={styles.tipSection}>
              <Text style={styles.sectionLabel}>Courier tip</Text>
              <View style={styles.tipRow}>
                {tipOptions.map((option) => {
                  const isActive = tipAmount === option;

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.tipChip, isActive ? styles.tipChipActive : null]}
                      onPress={() => setTipAmount(option)}
                    >
                      <Text style={[styles.tipChipText, isActive ? styles.tipChipTextActive : null]}>
                        {option === 0 ? 'No tip' : `$${option}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.summarySplit}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryDetailValue}>${total.toFixed(2)}</Text>
            </View>
            <View style={styles.summarySplit}>
              <Text style={styles.summaryLabel}>Delivery fee</Text>
              <Text style={styles.summaryDetailValue}>
                {fulfillmentType === 'delivery' ? `$${pricingPreview.deliveryFee.toFixed(2)}` : 'Free'}
              </Text>
            </View>
            <View style={styles.summarySplit}>
              <Text style={styles.summaryLabel}>Service fee</Text>
              <Text style={styles.summaryDetailValue}>${pricingPreview.serviceFee.toFixed(2)}</Text>
            </View>
            <View style={styles.summarySplit}>
              <Text style={styles.summaryLabel}>Tip</Text>
              <Text style={styles.summaryDetailValue}>${pricingPreview.tip.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Order total</Text>
              <Text style={styles.summaryValue}>${pricingPreview.total.toFixed(2)}</Text>
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
                      ? (submitting ? 'Placing cash order...' : 'Place cash order')
                      : 'Choose delivery location'
                    : (submitting
                        ? 'Placing pickup order...'
                        : 'Place pickup order')
                  : 'Sign in to place order'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.paymentHint}>
              {`Cash will be collected ${fulfillmentType === 'pickup' ? 'when you collect the order' : 'at drop-off'}. Card and wallet payments are coming soon.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8f8f8',
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    backgroundColor: '#fff',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: '#222',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyCopy: {
    color: '#666',
    fontSize: 16,
    textAlign: 'center',
  },
  header: {
    padding: 16,
  },
  title: {
    color: '#111',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#666',
    fontSize: 15,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  itemCopy: {
    marginBottom: 12,
  },
  itemName: {
    color: '#222',
    fontSize: 16,
    fontWeight: '700',
  },
  itemMeta: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
  itemActions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  quantityButton: {
    alignItems: 'center',
    backgroundColor: '#f5b342',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  quantityButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 14,
  },
  removeButton: {
    marginLeft: 'auto',
  },
  removeButtonText: {
    color: '#c62828',
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  guestPromptWrapper: {
    marginBottom: 16,
  },
  fulfillmentSection: {
    marginBottom: 18,
  },
  locationSection: {
    marginBottom: 16,
  },
  fulfillmentToggle: {
    backgroundColor: '#fff3d9',
    borderRadius: 18,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 4,
  },
  fulfillmentOption: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fulfillmentOptionActive: {
    backgroundColor: '#f5b342',
  },
  fulfillmentOptionIdle: {
    backgroundColor: 'transparent',
  },
  fulfillmentOptionDisabled: {
    opacity: 0.45,
  },
  fulfillmentOptionText: {
    color: '#8a6442',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  fulfillmentOptionTextActive: {
    color: '#fff',
  },
  fulfillmentHint: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  warningText: {
    color: '#b45309',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 8,
  },
  locationCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    flexDirection: 'row',
    marginBottom: 14,
    padding: 16,
  },
  locationEmptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff7e8',
    borderColor: '#f1d59c',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 14,
    padding: 16,
  },
  locationIconWrap: {
    alignItems: 'center',
    backgroundColor: '#fde7e7',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    marginRight: 12,
    width: 42,
  },
  locationEmptyIcon: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    marginRight: 12,
    width: 42,
  },
  locationCopy: {
    flex: 1,
  },
  locationTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  locationAddress: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  locationAction: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
  },
  noteInput: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
    borderRadius: 12,
    borderWidth: 1,
    height: 52,
    paddingHorizontal: 16,
  },
  pickupCard: {
    alignItems: 'center',
    backgroundColor: '#fff8ea',
    borderColor: '#f3d8a5',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 16,
    padding: 16,
  },
  pickupIcon: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    marginRight: 12,
    width: 42,
  },
  paymentSection: {
    marginBottom: 16,
  },
  optionGrid: {
    gap: 10,
  },
  optionCard: {
    backgroundColor: '#fff',
    borderColor: '#e5e7eb',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  optionCardDisabled: {
    opacity: 0.6,
  },
  optionCardActive: {
    backgroundColor: '#fff7e8',
    borderColor: '#f5b342',
  },
  optionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  optionTitleActive: {
    color: '#8a5a12',
  },
  optionCopy: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  optionCopyActive: {
    color: '#8a6442',
  },
  tipSection: {
    marginBottom: 18,
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tipChip: {
    backgroundColor: '#fff',
    borderColor: '#e5e7eb',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tipChipActive: {
    backgroundColor: '#f5b342',
    borderColor: '#f5b342',
  },
  tipChipText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  tipChipTextActive: {
    color: '#fff',
  },
  summarySplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryDetailValue: {
    color: '#4b5563',
    fontSize: 15,
    fontWeight: '600',
  },
  summaryRow: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: 6,
    paddingTop: 14,
  },
  summaryLabel: {
    color: '#333',
    fontSize: 16,
  },
  summaryValue: {
    color: '#111',
    fontSize: 20,
    fontWeight: '700',
  },
  checkoutButton: {
    alignItems: 'center',
    backgroundColor: '#f5b342',
    borderRadius: 12,
    paddingVertical: 16,
  },
  checkoutButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  checkoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  paymentHint: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});

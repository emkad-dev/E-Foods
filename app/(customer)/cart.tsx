import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../src/contexts/AuthContext';
import { useCart } from '../../src/contexts/CartContext';
import { db } from '../../src/services/firebase/config';

export default function CartScreen() {
  const { clearCart, items, removeItem, restaurantId, restaurantName, total, updateQuantity } = useCart();
  const { user } = useAuth();
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handlePlaceOrder = async () => {
    if (!user || !restaurantId || items.length === 0) {
      Alert.alert('Cart is empty', 'Add a few items before placing an order.');
      return;
    }

    if (!deliveryAddress.trim()) {
      Alert.alert('Address required', 'Please enter a delivery address before placing your order.');
      return;
    }

    setSubmitting(true);
    try {
      const orderRef = await addDoc(collection(db, 'orders'), {
        createdAt: serverTimestamp(),
        customerId: user.uid,
        deliveryAddress: deliveryAddress.trim(),
        items,
        restaurantId,
        restaurantName,
        status: 'pending',
        total,
      });

      clearCart();
      router.replace(`/orders/${orderRef.id}`);
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
            <TextInput
              style={styles.addressInput}
              placeholder="Delivery address"
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
            />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Order total</Text>
              <Text style={styles.summaryValue}>${total.toFixed(2)}</Text>
            </View>
            <TouchableOpacity style={styles.checkoutButton} onPress={handlePlaceOrder} disabled={submitting}>
              <Text style={styles.checkoutButtonText}>{submitting ? 'Placing order...' : 'Place order'}</Text>
            </TouchableOpacity>
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
  addressInput: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
    borderRadius: 12,
    borderWidth: 1,
    height: 52,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
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
  checkoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

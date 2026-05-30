import { FontAwesome } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../../src/contexts/CartContext';
import { fallbackAddressFromCoords, formatDeliveryLocation } from '../../src/utils/deliveryLocation';

export default function DeliveryLocationScreen() {
  const insets = useSafeAreaInsets();
  const { deliveryLocation, setDeliveryLocation } = useCart();
  const [address, setAddress] = useState(deliveryLocation?.address ?? '');
  const [label, setLabel] = useState(deliveryLocation?.label ?? deliveryLocation?.shortAddress ?? '');
  const [note, setNote] = useState(deliveryLocation?.note ?? '');
  const [latitude, setLatitude] = useState<number | null>(deliveryLocation?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(deliveryLocation?.longitude ?? null);
  const [coordinateSource, setCoordinateSource] = useState(deliveryLocation ? 'Saved coordinates' : 'Manual address');
  const [locating, setLocating] = useState(false);

  const handleUseCurrentLocation = async () => {
    setLocating(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location off', 'Enter your address manually or allow location access.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      });

      const nextLatitude = position.coords.latitude;
      const nextLongitude = position.coords.longitude;
      setLatitude(nextLatitude);
      setLongitude(nextLongitude);
      setCoordinateSource('Current location');

      const geocoded = await Location.reverseGeocodeAsync({
        latitude: nextLatitude,
        longitude: nextLongitude,
      }).catch(() => []);
      const formatted = formatDeliveryLocation(geocoded[0] ?? null);

      if (!address.trim()) {
        setAddress(formatted.address || fallbackAddressFromCoords(nextLatitude, nextLongitude));
      }

      if (!label.trim()) {
        setLabel(formatted.shortAddress);
      }
    } catch (error) {
      console.error('Failed to use current delivery location:', error);
      Alert.alert('Location unavailable', 'Enter your address manually for now.');
    } finally {
      setLocating(false);
    }
  };

  const handleSave = () => {
    const trimmedAddress = address.trim();
    const trimmedLabel = label.trim();

    if (!trimmedAddress) {
      Alert.alert('Address needed', 'Enter your delivery address.');
      return;
    }

    setDeliveryLocation({
      address: trimmedAddress,
      label: trimmedLabel || null,
      latitude,
      longitude,
      note: note.trim() || null,
      shortAddress: trimmedLabel || trimmedAddress,
      coordinateSource,
    });

    router.replace('/cart');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={18} color="#07140c" />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Delivery address</Text>
          <Text style={styles.subtitle}>Manual entry</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            multiline
            onChangeText={setAddress}
            placeholder="Street, house number, area"
            placeholderTextColor="#8b9690"
            style={[styles.input, styles.addressInput]}
            textAlignVertical="top"
            value={address}
          />

          <Text style={styles.label}>Label</Text>
          <TextInput
            onChangeText={setLabel}
            placeholder="Home, office, hostel"
            placeholderTextColor="#8b9690"
            style={styles.input}
            value={label}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="Gate color, landmark, or delivery note"
            placeholderTextColor="#8b9690"
            style={[styles.input, styles.noteInput]}
            textAlignVertical="top"
            value={note}
          />

          <TouchableOpacity
            activeOpacity={0.85}
            disabled={locating}
            onPress={handleUseCurrentLocation}
            style={styles.locationButton}
          >
            {locating ? (
              <ActivityIndicator color="#07140c" />
            ) : (
              <FontAwesome name="location-arrow" size={16} color="#07140c" />
            )}
            <Text style={styles.locationButtonText}>
              {locating ? 'Getting location' : 'Use current location'}
            </Text>
          </TouchableOpacity>

          <View style={styles.coordinatePill}>
            <FontAwesome name="map-marker" size={14} color="#069b3f" />
            <Text style={styles.coordinateText}>{coordinateSource}</Text>
          </View>
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Save address</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#f0f2f1',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    height: 42,
    justifyContent: 'center',
    marginRight: 12,
    width: 42,
  },
  title: {
    color: '#07140c',
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    color: '#66736d',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  content: {
    padding: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4df',
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
  },
  label: {
    color: '#07140c',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#f6f8f7',
    borderColor: '#dbe4df',
    borderRadius: 18,
    borderWidth: 1,
    color: '#07140c',
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addressInput: {
    minHeight: 96,
  },
  noteInput: {
    minHeight: 82,
  },
  locationButton: {
    alignItems: 'center',
    backgroundColor: '#cff5dd',
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  locationButtonText: {
    color: '#07140c',
    fontSize: 15,
    fontWeight: '900',
    marginLeft: 8,
  },
  coordinatePill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#eefaf2',
    borderRadius: 999,
    flexDirection: 'row',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  coordinateText: {
    color: '#25613a',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#06b84f',
    borderRadius: 20,
    marginTop: 18,
    paddingVertical: 17,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { submitPartnerApplication } from '../../src/services/partnerApplications';
import { buildPartnerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { supabase } from '../../src/services/supabase/config';
import { partnerTheme } from '../../src/theme/palette';
import {
  PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MS,
  resolvePartnerRestaurantCompletionState,
} from '../../src/contexts/partnerAuthFlow';

const cuisineOptions = ['Nigerian', 'Fast Food', 'Pizza', 'Grills', 'Seafood', 'Healthy', 'Desserts'] as const;
const deliveryTimeOptions = ['15-25 min', '25-35 min', '35-45 min', '45-60 min'] as const;
type RequiredFieldKey = 'restaurantName' | 'phoneNumber' | 'address' | 'latitude' | 'longitude' | 'deliveryRadiusKm';

export default function CompleteRestaurantDetailsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signOut, user } = useAuth();
  const [restaurantName, setRestaurantName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [cuisine, setCuisine] = useState<(typeof cuisineOptions)[number]>('Nigerian');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [deliveryTime, setDeliveryTime] = useState<(typeof deliveryTimeOptions)[number]>('25-35 min');
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState('12');
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [handoffStartedAt, setHandoffStartedAt] = useState<number | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredFieldKey, boolean>>>({});
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contactName = useMemo(
    () => user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Partner',
    [user?.displayName, user?.email]
  );
  const completionUserRole = user?.role === 'restaurant' ? 'restaurant' : 'customer';

  useEffect(() => {
    if (handoffTimerRef.current) {
      clearTimeout(handoffTimerRef.current);
      handoffTimerRef.current = null;
    }

    if (!handoffStartedAt) {
      return;
    }

    const completionState = resolvePartnerRestaurantCompletionState({
      startedAt: handoffStartedAt,
      userRole: completionUserRole,
    });

    if (completionState.kind === 'ready') {
      setHandoffStartedAt(null);
      setHandoffError(null);
      router.replace('/(partner)' as never);
      return;
    }

    if (completionState.kind === 'timed-out') {
      setHandoffStartedAt(null);
      setHandoffError(completionState.message);
      Alert.alert('Restaurant access still syncing', completionState.message);
      return;
    }

    const elapsedMs = Date.now() - handoffStartedAt;
    const remainingMs = Math.max(250, PARTNER_RESTAURANT_COMPLETION_TIMEOUT_MS - elapsedMs);

    handoffTimerRef.current = setTimeout(() => {
      const nextState = resolvePartnerRestaurantCompletionState({
        startedAt: handoffStartedAt,
        userRole: completionUserRole,
        now: Date.now(),
      });

      if (nextState.kind === 'ready') {
        setHandoffStartedAt(null);
        setHandoffError(null);
        router.replace('/(partner)' as never);
        return;
      }

      if (nextState.kind === 'timed-out') {
        setHandoffStartedAt(null);
        setHandoffError(nextState.message);
        Alert.alert('Restaurant access still syncing', nextState.message);
      }
    }, remainingMs);

    return () => {
      if (handoffTimerRef.current) {
        clearTimeout(handoffTimerRef.current);
        handoffTimerRef.current = null;
      }
    };
  }, [completionUserRole, handoffStartedAt, router]);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error || handoffError) {
      clearError();
      setHandoffError(null);
    }

    setter(value);
  };

  const clearFieldError = (field: RequiredFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleRequiredFieldChange = (field: RequiredFieldKey, setter: (value: string) => void) => (value: string) => {
    clearFieldError(field);
    handleFieldChange(setter)(value);
  };

  const handlePickLogo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Logo access blocked', 'Allow photo access to upload a logo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.82,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setLogoImage(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (loading || submitting) {
      return;
    }

    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const parsedLatitude = hasLatitude ? Number.parseFloat(latitude) : null;
    const parsedLongitude = hasLongitude ? Number.parseFloat(longitude) : null;

    if (!restaurantName.trim() || !phoneNumber.trim() || !address.trim()) {
      Alert.alert('Missing details', 'Complete the restaurant name, phone number, and address before continuing.');
      return;
    }

    if (!hasLatitude || !hasLongitude) {
      Alert.alert('Location required', 'Add both latitude and longitude before submitting the restaurant application.');
      return;
    }

    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      Alert.alert('Invalid location', 'Use valid numeric coordinates for the restaurant location.');
      return;
    }

    const parsedDeliveryRadiusKm = Number.parseFloat(deliveryRadiusKm);
    if (!Number.isFinite(parsedDeliveryRadiusKm) || parsedDeliveryRadiusKm <= 0) {
      Alert.alert('Invalid delivery distance', 'Enter a delivery distance above zero in kilometers.');
      return;
    }

    const nextFieldErrors: Partial<Record<RequiredFieldKey, boolean>> = {};

    if (!restaurantName.trim()) {
      nextFieldErrors.restaurantName = true;
    }

    if (!phoneNumber.trim()) {
      nextFieldErrors.phoneNumber = true;
    }

    if (!address.trim()) {
      nextFieldErrors.address = true;
    }

    if (!hasLatitude || !hasLongitude || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      nextFieldErrors.latitude = true;
      nextFieldErrors.longitude = true;
    }

    if (!Number.isFinite(parsedDeliveryRadiusKm) || parsedDeliveryRadiusKm <= 0) {
      nextFieldErrors.deliveryRadiusKm = true;
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      Alert.alert('Missing details', 'Complete the highlighted fields before continuing.');
      return;
    }

    setSubmitting(true);
    setHandoffError(null);
    setFieldErrors({});

    try {
      const logoUpload = logoImage
        ? await uploadRestaurantAsset({
            kind: 'logos',
            ownerId: user?.uid ?? '',
            uri: logoImage,
          })
        : null;

      await submitPartnerApplication({
        address: address.trim(),
        contactName,
        cuisine,
        deliveryTime: deliveryTime?.trim() || undefined,
        deliveryRadiusKm: parsedDeliveryRadiusKm,
        description: description.trim() || undefined,
        latitude: parsedLatitude,
        logoImage: logoUpload,
        longitude: parsedLongitude,
        phoneNumber: phoneNumber.trim(),
        restaurantName: restaurantName.trim(),
        policyAcceptance: buildPartnerPolicyAcceptance('partner_signup'),
      });

      setHandoffStartedAt(Date.now());
      await supabase.auth.refreshSession().catch(() => undefined);
    } catch (nextError: any) {
      Alert.alert('Unable to save details', nextError.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>Complete your restaurant details</Text>
        <Text style={styles.copy}>
          Add the restaurant profile that appears in the partner dashboard. Once you save, we’ll open your restaurant dashboard right away.
        </Text>
      </View>

      <View style={styles.card}>
        {handoffError || error ? <Text style={styles.errorText}>{handoffError ?? error}</Text> : null}

        <View style={styles.identityRow}>
          <View style={styles.identityBubble}>
            <Text style={styles.identityBubbleText}>{contactName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{contactName}</Text>
            <Text style={styles.identityEmail}>{user?.email ?? 'Signed in'}</Text>
          </View>
        </View>

        <TextInput
          style={[styles.input, fieldErrors.restaurantName ? styles.inputError : null]}
          placeholder="Restaurant name"
          placeholderTextColor="#8e8e8e"
          value={restaurantName}
          onChangeText={handleRequiredFieldChange('restaurantName', setRestaurantName)}
          editable={!loading && !submitting && !handoffStartedAt}
        />
        <TextInput
          style={[styles.input, fieldErrors.phoneNumber ? styles.inputError : null]}
          placeholder="Phone number"
          placeholderTextColor="#8e8e8e"
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={handleRequiredFieldChange('phoneNumber', setPhoneNumber)}
          editable={!loading && !submitting && !handoffStartedAt}
        />

        <View style={styles.logoRow}>
          <View style={styles.logoPreview}>
            {logoImage ? <Image source={{ uri: logoImage }} style={styles.logoImage} /> : <Text style={styles.logoPreviewText}>Logo</Text>}
          </View>
          <View style={styles.logoActions}>
            <TouchableOpacity style={styles.logoButton} onPress={handlePickLogo} disabled={loading || submitting || Boolean(handoffStartedAt)}>
              <Text style={styles.logoButtonText}>{logoImage ? 'Change logo' : 'Upload logo'}</Text>
            </TouchableOpacity>
            {logoImage ? (
              <TouchableOpacity onPress={() => setLogoImage(null)} disabled={loading || submitting || Boolean(handoffStartedAt)}>
                <Text style={styles.removeLogoText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Cuisine focus</Text>
        <View style={styles.optionRow}>
          {cuisineOptions.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.chip, cuisine === option ? styles.chipActive : null]}
              onPress={() => setCuisine(option)}
              disabled={loading || submitting || Boolean(handoffStartedAt)}
            >
              <Text style={[styles.chipText, cuisine === option ? styles.chipTextActive : null]}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={[styles.input, styles.textArea, fieldErrors.address ? styles.inputError : null]}
          placeholder="Restaurant address"
          placeholderTextColor="#8e8e8e"
          multiline
          value={address}
          onChangeText={handleRequiredFieldChange('address', setAddress)}
          editable={!loading && !submitting && !handoffStartedAt}
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Short description (optional)"
          placeholderTextColor="#8e8e8e"
          multiline
          value={description}
          onChangeText={handleFieldChange(setDescription)}
          editable={!loading && !submitting && !handoffStartedAt}
        />

        <Text style={styles.sectionLabel}>Typical delivery time</Text>
        <View style={styles.optionRow}>
          {deliveryTimeOptions.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.chip, deliveryTime === option ? styles.chipActive : null]}
              onPress={() => setDeliveryTime(option)}
              disabled={loading || submitting || Boolean(handoffStartedAt)}
            >
              <Text style={[styles.chipText, deliveryTime === option ? styles.chipTextActive : null]}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.coordinatesRow}>
          <TextInput
            style={[styles.input, styles.coordinateInput, fieldErrors.latitude ? styles.inputError : null]}
            placeholder="Latitude (required)"
            placeholderTextColor="#8e8e8e"
            keyboardType="decimal-pad"
            value={latitude}
            onChangeText={handleRequiredFieldChange('latitude', setLatitude)}
            editable={!loading && !submitting && !handoffStartedAt}
          />
          <TextInput
            style={[styles.input, styles.coordinateInput, fieldErrors.longitude ? styles.inputError : null]}
            placeholder="Longitude (required)"
            placeholderTextColor="#8e8e8e"
            keyboardType="decimal-pad"
            value={longitude}
            onChangeText={handleRequiredFieldChange('longitude', setLongitude)}
            editable={!loading && !submitting && !handoffStartedAt}
          />
        </View>

        <TextInput
          style={[styles.input, fieldErrors.deliveryRadiusKm ? styles.inputError : null]}
          placeholder="Delivery radius in km"
          placeholderTextColor="#8e8e8e"
          keyboardType="decimal-pad"
          value={deliveryRadiusKm}
          onChangeText={handleRequiredFieldChange('deliveryRadiusKm', setDeliveryRadiusKm)}
          editable={!loading && !submitting && !handoffStartedAt}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={loading || submitting || Boolean(handoffStartedAt)}>
          <Text style={styles.primaryButtonText}>
            {handoffStartedAt ? 'Opening dashboard...' : loading || submitting ? 'Saving details...' : 'Save and open dashboard'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.handoffNote}>
          After saving, we’ll wait for your restaurant access to finish syncing before opening the dashboard.
        </Text>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()} disabled={loading || submitting || Boolean(handoffStartedAt)}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderColor: partnerTheme.hero,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fffdf8',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#e7dbc7',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: partnerTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  identityRow: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 14,
    padding: 14,
  },
  identityBubble: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 999,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  identityBubbleText: {
    color: partnerTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
  },
  identityCopy: {
    flex: 1,
    marginLeft: 12,
  },
  identityName: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  identityEmail: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  inputError: {
    backgroundColor: '#fff6f6',
    borderColor: partnerTheme.danger,
  },
  textArea: {
    minHeight: 90,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 16,
  },
  logoPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 84,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 84,
  },
  logoPreviewText: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  logoImage: {
    height: '100%',
    width: '100%',
  },
  logoActions: {
    flex: 1,
    marginLeft: 16,
  },
  logoButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentSoft,
    borderRadius: 16,
    paddingVertical: 12,
  },
  logoButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  removeLogoText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  sectionLabel: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  chip: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: partnerTheme.accentSoft,
    borderColor: partnerTheme.accent,
  },
  chipText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: partnerTheme.accentStrong,
  },
  coordinatesRow: {
    flexDirection: 'row',
    gap: 12,
  },
  coordinateInput: {
    flex: 1,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  handoffNote: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    textAlign: 'center',
  },
});

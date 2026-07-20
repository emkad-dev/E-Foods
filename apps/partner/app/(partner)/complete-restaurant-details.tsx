import { useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { submitPartnerApplication } from '../../src/services/partnerApplications';
import { uploadRestaurantAsset } from '../../src/services/restaurantAssetUpload';
import { partnerTheme } from '../../src/theme/palette';

const cuisineOptions = ['Nigerian', 'Fast Food', 'Pizza', 'Grills', 'Seafood', 'Healthy', 'Desserts'] as const;
const deliveryTimeOptions = ['15-25 min', '25-35 min', '35-45 min', '45-60 min'] as const;

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
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const contactName = useMemo(
    () => user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Partner',
    [user?.displayName, user?.email]
  );

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
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
    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const parsedLatitude = hasLatitude ? Number.parseFloat(latitude) : null;
    const parsedLongitude = hasLongitude ? Number.parseFloat(longitude) : null;

    if (!restaurantName.trim() || !phoneNumber.trim() || !address.trim()) {
      Alert.alert('Missing details', 'Complete the restaurant name, phone number, and address before continuing.');
      return;
    }

    if (hasLatitude !== hasLongitude) {
      Alert.alert('Incomplete coordinates', 'Provide both latitude and longitude together, or leave both empty for now.');
      return;
    }

    if ((hasLatitude && !Number.isFinite(parsedLatitude)) || (hasLongitude && !Number.isFinite(parsedLongitude))) {
      Alert.alert('Invalid location', 'Use valid numeric coordinates for the restaurant location.');
      return;
    }

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
        description: description.trim() || undefined,
        latitude: hasLatitude ? parsedLatitude : null,
        logoImage: logoUpload,
        longitude: hasLongitude ? parsedLongitude : null,
        phoneNumber: phoneNumber.trim(),
        restaurantName: restaurantName.trim(),
      });

      Alert.alert('Restaurant details saved', 'Your partner account is ready.');
      router.replace('/(partner)' as never);
    } catch (nextError: any) {
      Alert.alert('Unable to save details', nextError.message ?? 'Please try again.');
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
          Add the restaurant profile that appears in the partner dashboard. You can update these details later.
        </Text>
      </View>

      <View style={styles.card}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

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
          style={styles.input}
          placeholder="Restaurant name"
          placeholderTextColor="#8e8e8e"
          value={restaurantName}
          onChangeText={handleFieldChange(setRestaurantName)}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone number"
          placeholderTextColor="#8e8e8e"
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={handleFieldChange(setPhoneNumber)}
          editable={!loading}
        />

        <View style={styles.logoRow}>
          <View style={styles.logoPreview}>
            {logoImage ? <Image source={{ uri: logoImage }} style={styles.logoImage} /> : <Text style={styles.logoPreviewText}>Logo</Text>}
          </View>
          <View style={styles.logoActions}>
            <TouchableOpacity style={styles.logoButton} onPress={handlePickLogo} disabled={loading}>
              <Text style={styles.logoButtonText}>{logoImage ? 'Change logo' : 'Upload logo'}</Text>
            </TouchableOpacity>
            {logoImage ? (
              <TouchableOpacity onPress={() => setLogoImage(null)} disabled={loading}>
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
              disabled={loading}
            >
              <Text style={[styles.chipText, cuisine === option ? styles.chipTextActive : null]}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Restaurant address"
          placeholderTextColor="#8e8e8e"
          multiline
          value={address}
          onChangeText={handleFieldChange(setAddress)}
          editable={!loading}
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Short description (optional)"
          placeholderTextColor="#8e8e8e"
          multiline
          value={description}
          onChangeText={handleFieldChange(setDescription)}
          editable={!loading}
        />

        <Text style={styles.sectionLabel}>Typical delivery time</Text>
        <View style={styles.optionRow}>
          {deliveryTimeOptions.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.chip, deliveryTime === option ? styles.chipActive : null]}
              onPress={() => setDeliveryTime(option)}
              disabled={loading}
            >
              <Text style={[styles.chipText, deliveryTime === option ? styles.chipTextActive : null]}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.coordinatesRow}>
          <TextInput
            style={[styles.input, styles.coordinateInput]}
            placeholder="Latitude (optional)"
            placeholderTextColor="#8e8e8e"
            keyboardType="decimal-pad"
            value={latitude}
            onChangeText={handleFieldChange(setLatitude)}
            editable={!loading}
          />
          <TextInput
            style={[styles.input, styles.coordinateInput]}
            placeholder="Longitude (optional)"
            placeholderTextColor="#8e8e8e"
            keyboardType="decimal-pad"
            value={longitude}
            onChangeText={handleFieldChange(setLongitude)}
            editable={!loading}
          />
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Saving details...' : 'Save restaurant details'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()} disabled={loading}>
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
});

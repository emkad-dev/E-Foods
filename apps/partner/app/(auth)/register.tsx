import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Image,
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
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { buildPartnerPolicyAcceptance } from '../../src/services/policyAcceptance';
import { partnerTheme } from '../../src/theme/palette';

const cuisineOptions = ['Nigerian', 'Fast Food', 'Pizza', 'Grills', 'Seafood', 'Healthy', 'Desserts'] as const;
const deliveryTimeOptions = ['15-25 min', '25-35 min', '35-45 min', '45-60 min'] as const;

export default function PartnerRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signUp } = useAuth();
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [cuisine, setCuisine] = useState<(typeof cuisineOptions)[number]>('Nigerian');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [deliveryTime, setDeliveryTime] = useState<(typeof deliveryTimeOptions)[number]>('25-35 min');
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const hasRequiredDetails = useMemo(
    () => Boolean(contactName.trim() && email.trim() && password.trim() && phoneE164 && restaurantName.trim() && address.trim()),
    [address, contactName, email, password, phoneE164, restaurantName]
  );
  const canSubmit = hasRequiredDetails && acceptedPolicies;

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
  };

  const handleRegister = async () => {
    const hasLatitude = latitude.trim().length > 0;
    const hasLongitude = longitude.trim().length > 0;
    const parsedLatitude = hasLatitude ? Number.parseFloat(latitude) : null;
    const parsedLongitude = hasLongitude ? Number.parseFloat(longitude) : null;

    if (!hasRequiredDetails) {
      Alert.alert('Missing details', 'Complete the restaurant and contact details before submitting your partner application.');
      return;
    }

    if (!acceptedPolicies) {
      Alert.alert('Terms required', 'Accept the Terms and Privacy Policy before submitting your partner application.');
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
      const result = await signUp(email.trim(), password, {
        address: address.trim(),
        contactName: contactName.trim(),
        cuisine,
        deliveryTime,
        description: description.trim() || undefined,
        latitude: hasLatitude ? parsedLatitude : null,
        logoImage,
        longitude: hasLongitude ? parsedLongitude : null,
        phoneNumber: phoneE164 ?? '',
        policyAcceptance: buildPartnerPolicyAcceptance('partner_signup'),
        restaurantName: restaurantName.trim(),
      });

      Alert.alert(
        'Application submitted',
        result.verificationEmailSent
          ? 'Your restaurant is live. Check your inbox and confirm your email before trying to sign in.'
          : 'Your restaurant is live, but email verification could not be confirmed from the app. Check your inbox and sign in once it is verified.'
      );
      router.replace('/(auth)/login');
    } catch (nextError: any) {
      Alert.alert('Application failed', nextError.message ?? 'Unable to submit your partner application right now.');
    }
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

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>FEASTY Partner</Text>
          <Text style={styles.title}>Apply as a restaurant partner</Text>
          <Text style={styles.copy}>
            Share your restaurant details, contact number, cuisine, and base location. Your partner dashboard goes live as soon as the application is submitted and email is verified.
          </Text>
        </View>

        <View style={styles.card}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Contact name"
            placeholderTextColor="#8e8e8e"
            value={contactName}
            onChangeText={handleFieldChange(setContactName)}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#8e8e8e"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={handleFieldChange(setEmail)}
            editable={!loading}
          />
          <AuthPasswordField
            placeholder="Password"
            value={password}
            onChangeText={handleFieldChange(setPassword)}
            editable={!loading}
            showHint
          />
          <View style={styles.phoneField}>
            <PhoneInput
              theme={partnerTheme}
              editable={!loading}
              onChange={({ e164 }) => {
                if (error) {
                  clearError();
                }
                setPhoneE164(e164);
              }}
            />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Restaurant name"
            placeholderTextColor="#8e8e8e"
            value={restaurantName}
            onChangeText={handleFieldChange(setRestaurantName)}
            editable={!loading}
          />

          <View style={styles.logoRow}>
            <View style={styles.logoPreview}>
              {logoImage ? (
                <Image source={{ uri: logoImage }} style={styles.logoImage} />
              ) : (
                <Text style={styles.logoPreviewText}>Logo</Text>
              )}
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

          <View style={styles.coordinateRow}>
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

          <Text style={styles.helperText}>
            If you include coordinates, the platform can use them later for better delivery assignment and restaurant discovery accuracy.
          </Text>

          <TouchableOpacity
            style={styles.policyRow}
            onPress={() => setAcceptedPolicies((current) => !current)}
            activeOpacity={0.82}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptedPolicies ? styles.checkboxActive : null]}>
              {acceptedPolicies ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.policyText}>
              I agree to the <Link href="/(auth)/terms" style={styles.policyLink}>Terms</Link> and{' '}
              <Link href="/(auth)/privacy" style={styles.policyLink}>Privacy Policy</Link>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit ? styles.primaryButtonDisabled : null]}
            onPress={handleRegister}
            disabled={loading || !canSubmit}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? 'Submitting application...' : 'Submit partner application'}
            </Text>
          </TouchableOpacity>

          <Link href="/(auth)/login" style={styles.link}>
            Back to partner sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
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
    marginBottom: 8,
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
  phoneField: {
    marginTop: 14,
  },
  textArea: {
    minHeight: 96,
    paddingTop: 16,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  logoActions: {
    flex: 1,
  },
  logoButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  logoButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  logoImage: {
    height: '100%',
    width: '100%',
  },
  logoPreview: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 76,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 76,
  },
  logoPreviewText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  removeLogoText: {
    color: partnerTheme.danger,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 10,
    textAlign: 'center',
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
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  chipText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  coordinateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  coordinateInput: {
    flex: 1,
  },
  helperText: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 14,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: 7,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxActive: {
    backgroundColor: partnerTheme.accent,
    borderColor: partnerTheme.accent,
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  policyLink: {
    color: partnerTheme.accentStrong,
    fontWeight: '800',
  },
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  policyText: {
    color: partnerTheme.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: partnerTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
});

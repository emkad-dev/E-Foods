import { useMemo, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import {
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
import { useAuth } from '../../src/contexts/AuthContext';
import { dispatchTheme } from '../../src/theme/palette';

const regionOptions = ['Yaba', 'Lekki', 'Victoria Island', 'Ikoyi', 'Surulere', 'Mainland', 'Lagos Island'] as const;
const vehicleOptions = ['Bike', 'Scooter', 'Car', 'Van'] as const;

export default function DispatchRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [region, setRegion] = useState<(typeof regionOptions)[number]>('Yaba');
  const [vehicleType, setVehicleType] = useState<(typeof vehicleOptions)[number]>('Bike');
  const [currentAddress, setCurrentAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const canSubmit = useMemo(
    () =>
      Boolean(
        displayName.trim() &&
          email.trim() &&
          password.trim() &&
          phoneNumber.trim() &&
          latitude.trim() &&
          longitude.trim()
      ),
    [displayName, email, password, phoneNumber, latitude, longitude]
  );

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
  };

  const handleRegister = async () => {
    const parsedLatitude = Number.parseFloat(latitude);
    const parsedLongitude = Number.parseFloat(longitude);

    if (!canSubmit) {
      Alert.alert('Missing details', 'Complete every rider detail before submitting your dispatch application.');
      return;
    }

    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      Alert.alert('Invalid location', 'Use valid numeric coordinates for the rider location.');
      return;
    }

    try {
      await signUp(email.trim(), password, {
        currentAddress: currentAddress.trim() || undefined,
        displayName: displayName.trim(),
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        phoneNumber: phoneNumber.trim(),
        region,
        vehicleType,
      });

      Alert.alert(
        'Application submitted',
        'Your dispatch rider details are now waiting for admin approval. Sign in after the team approves this account.'
      );
      router.replace('/(auth)/login');
    } catch (nextError: any) {
      Alert.alert('Application failed', nextError.message ?? 'Unable to submit your rider application right now.');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>E-Fooders</Text>
          <Text style={styles.title}>Apply as a dispatch rider</Text>
          <Text style={styles.copy}>
            Share the rider details ops needs: name, phone, region, vehicle, and your current base location. The admin team approves each rider before they can dispatch orders.
          </Text>
        </View>

        <View style={styles.card}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor="#8e8e8e"
            value={displayName}
            onChangeText={handleFieldChange(setDisplayName)}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#8e8e8e"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={handleFieldChange(setEmail)}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#8e8e8e"
            secureTextEntry
            value={password}
            onChangeText={handleFieldChange(setPassword)}
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

          <Text style={styles.sectionLabel}>Dispatch region</Text>
          <View style={styles.optionRow}>
            {regionOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, region === option ? styles.chipActive : null]}
                onPress={() => setRegion(option)}
                disabled={loading}
              >
                <Text style={[styles.chipText, region === option ? styles.chipTextActive : null]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Vehicle type</Text>
          <View style={styles.optionRow}>
            {vehicleOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, vehicleType === option ? styles.chipActive : null]}
                onPress={() => setVehicleType(option)}
                disabled={loading}
              >
                <Text style={[styles.chipText, vehicleType === option ? styles.chipTextActive : null]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Current location / landmark"
            placeholderTextColor="#8e8e8e"
            value={currentAddress}
            onChangeText={handleFieldChange(setCurrentAddress)}
            editable={!loading}
          />

          <View style={styles.coordinateRow}>
            <TextInput
              style={[styles.input, styles.coordinateInput]}
              placeholder="Latitude"
              placeholderTextColor="#8e8e8e"
              keyboardType="decimal-pad"
              value={latitude}
              onChangeText={handleFieldChange(setLatitude)}
              editable={!loading}
            />
            <TextInput
              style={[styles.input, styles.coordinateInput]}
              placeholder="Longitude"
              placeholderTextColor="#8e8e8e"
              keyboardType="decimal-pad"
              value={longitude}
              onChangeText={handleFieldChange(setLongitude)}
              editable={!loading}
            />
          </View>

          <Text style={styles.helperText}>
            Admin approval is required before this rider appears on the dispatch board. These coordinates will later help ops pick the closest rider to a delivery.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit ? styles.primaryButtonDisabled : null]}
            onPress={handleRegister}
            disabled={loading || !canSubmit}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? 'Submitting application...' : 'Submit rider application'}
            </Text>
          </TouchableOpacity>

          <Link href="/(auth)/login" style={styles.link}>
            Back to dispatch sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderColor: dispatchTheme.heroSecondary,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.cream,
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#d6dfeb',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    color: dispatchTheme.textSoft,
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
  chip: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: dispatchTheme.accent,
    borderColor: dispatchTheme.accent,
  },
  chipText: {
    color: dispatchTheme.textMuted,
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
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
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
    color: dispatchTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
});

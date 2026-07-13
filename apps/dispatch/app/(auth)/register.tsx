import { useEffect, useMemo, useState } from 'react';
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
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import { useAuth } from '../../src/contexts/AuthContext';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import { buildDispatchPolicyAcceptance } from '../../src/services/policyAcceptance';
import { dispatchTheme } from '../../src/theme/palette';

const vehicleOptions = ['Bike', 'Scooter', 'Car', 'Van'] as const;

export default function DispatchRegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [region, setRegion] = useState<(typeof nigeriaStateOptions)[number]>('Lagos');
  const lgaOptions = useMemo(() => getLgaOptionsForState(region), [region]);
  const [lga, setLga] = useState('');
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);
  const [vehicleType, setVehicleType] = useState<(typeof vehicleOptions)[number]>('Bike');
  const [currentAddress, setCurrentAddress] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  const canSubmit = useMemo(
    () =>
      Boolean(
        displayName.trim() &&
          email.trim() &&
          password.trim() &&
          phoneE164 &&
          lga.trim() &&
          acceptedPolicies
      ),
    [acceptedPolicies, displayName, email, password, phoneE164, lga]
  );

  useEffect(() => {
    if (lgaOptions.length === 0) {
      setLga('');
      return;
    }

    setLga((currentLga) => (lgaOptions.includes(currentLga) ? currentLga : lgaOptions[0]));
  }, [lgaOptions]);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
  };

  const handleRegister = async () => {
    if (!canSubmit) {
      Alert.alert(
        'Missing details',
        acceptedPolicies
          ? 'Complete every rider detail before submitting your dispatch application.'
          : 'Accept the Terms and Privacy Policy before submitting your dispatch application.'
      );
      return;
    }

    try {
      const result = await signUp(email.trim(), password, {
        currentAddress: currentAddress.trim() || undefined,
        displayName: displayName.trim(),
        lga,
        phoneNumber: phoneE164 ?? '',
        policyAcceptance: buildDispatchPolicyAcceptance('dispatch_signup'),
        region,
        vehicleType,
      });

      Alert.alert(
        'Application submitted',
        result.verificationEmailSent
          ? 'Your rider account is live. Check your inbox and confirm your email before trying to sign in.'
          : 'Your rider account is live, but email verification could not be confirmed from the app. Check your inbox and sign in once it is verified.'
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
          <Text style={styles.eyebrow}>FEASTY Dispatch</Text>
          <Text style={styles.title}>Apply as a dispatch rider</Text>
          <Text style={styles.copy}>
            Share the rider details ops needs: name, phone, state, LGA, vehicle, and your current base location. Riders become live as soon as the application is submitted and email is verified.
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
          <AuthPasswordField
            placeholder="Password"
            value={password}
            onChangeText={handleFieldChange(setPassword)}
            editable={!loading}
            showHint
          />
          <View style={styles.phoneField}>
            <PhoneInput
              theme={dispatchTheme}
              editable={!loading}
              onChange={({ e164 }) => {
                if (error) {
                  clearError();
                }
                setPhoneE164(e164);
              }}
            />
          </View>

          <Text style={styles.sectionLabel}>Dispatch state</Text>
          <CompactOptionPicker
            label="Dispatch state"
            selectedValue={region}
            options={nigeriaStateOptions}
            isOpen={openPicker === 'state'}
            onToggle={() => setOpenPicker((current) => (current === 'state' ? null : 'state'))}
            onSelect={(value) => {
              setRegion(value as (typeof nigeriaStateOptions)[number]);
              setOpenPicker(null);
            }}
            disabled={loading}
          />

          <Text style={styles.sectionLabel}>Local government area</Text>
          <CompactOptionPicker
            label="Local government area"
            selectedValue={lga}
            options={lgaOptions}
            isOpen={openPicker === 'lga'}
            onToggle={() => setOpenPicker((current) => (current === 'lga' ? null : 'lga'))}
            onSelect={(value) => {
              setLga(value);
              setOpenPicker(null);
            }}
            disabled={loading}
          />

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
            placeholder="Current landmark or pickup base"
            placeholderTextColor="#8e8e8e"
            value={currentAddress}
            onChangeText={handleFieldChange(setCurrentAddress)}
            editable={!loading}
          />

          <Text style={styles.helperText}>
            Your rider profile goes live after signup. The selected state and LGA become the rider base, and we use that base for location fallback until live tracking is added.
          </Text>

          <TouchableOpacity
            style={styles.policyRow}
            onPress={() => setAcceptedPolicies((current) => !current)}
            activeOpacity={0.82}
            disabled={loading}
          >
            <View style={[styles.checkbox, acceptedPolicies ? styles.checkboxActive : null]}>
              {acceptedPolicies ? <View style={styles.checkboxDot} /> : null}
            </View>
            <Text style={styles.policyText}>
              I agree to the <Link href="./terms" style={styles.policyLink}>Terms</Link> and{' '}
              <Link href="./privacy" style={styles.policyLink}>Privacy Policy</Link>.
            </Text>
          </TouchableOpacity>

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
  phoneField: {
    marginTop: 14,
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
  helperText: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 14,
  },
  policyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 16,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginRight: 12,
    width: 22,
  },
  checkboxActive: {
    backgroundColor: dispatchTheme.accent,
    borderColor: dispatchTheme.accent,
  },
  checkboxDot: {
    backgroundColor: '#ffffff',
    borderRadius: 3,
    height: 8,
    width: 8,
  },
  policyText: {
    color: dispatchTheme.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  policyLink: {
    color: dispatchTheme.accentStrong,
    fontWeight: '800',
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

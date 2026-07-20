import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import { submitDispatchApplication } from '../../src/services/dispatchApplications';
import { buildDispatchPolicyAcceptance } from '../../src/services/policyAcceptance';
import { dispatchTheme } from '../../src/theme/palette';

const vehicleOptions = ['Bike', 'Scooter', 'Car', 'Van'] as const;

export default function CompleteRiderDetailsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clearError, error, loading, signOut, user } = useAuth();
  const [region, setRegion] = useState<(typeof nigeriaStateOptions)[number]>('Lagos');
  const [lga, setLga] = useState('');
  const [vehicleType, setVehicleType] = useState<(typeof vehicleOptions)[number]>('Bike');
  const [currentAddress, setCurrentAddress] = useState('');
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);

  const lgaOptions = useMemo(() => getLgaOptionsForState(region), [region]);
  const contactName = useMemo(
    () => user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Rider',
    [user?.displayName, user?.email]
  );
  const contactPhone = useMemo(() => user?.phoneNumber?.trim() || 'Saved on signup', [user?.phoneNumber]);

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

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert('Sign in again', 'Please sign in again to finish your rider setup.');
      return;
    }

    const riderPhone = user.phoneNumber?.trim() ?? '';

    if (!riderPhone) {
      Alert.alert('Missing phone number', 'Sign out and sign in again so we can restore your rider profile details.');
      return;
    }

    if (!currentAddress.trim() || !lga.trim()) {
      Alert.alert('Missing details', 'Choose your state and LGA, then add your current base or pickup address.');
      return;
    }

    try {
      await submitDispatchApplication({
        currentAddress: currentAddress.trim() || undefined,
        displayName: contactName,
        lga: lga.trim(),
        phoneNumber: riderPhone,
        policyAcceptance: buildDispatchPolicyAcceptance('dispatch_signup'),
        region,
        vehicleType,
      });

      Alert.alert('Rider details saved', 'Your dispatch account is ready.');
      router.replace('/(dispatch)' as never);
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
        <Text style={styles.eyebrow}>FEASTY Dispatch</Text>
        <Text style={styles.title}>Complete your rider details</Text>
        <Text style={styles.copy}>
          Finish the routing details that ops uses to activate your dispatch profile and assign the right coverage
          area.
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
            <Text style={styles.identityEmail}>{contactPhone}</Text>
          </View>
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
          style={[styles.input, styles.textArea]}
          placeholder="Current base, landmark, or pickup address"
          placeholderTextColor="#8e8e8e"
          multiline
          value={currentAddress}
          onChangeText={handleFieldChange(setCurrentAddress)}
          editable={!loading}
        />

        <Text style={styles.helperText}>
          We use this location to anchor your dispatch coverage until a live location session is active.
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Saving details...' : 'Save rider details'}</Text>
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
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  content: {
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
    marginBottom: 10,
  },
  identityRow: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 14,
    padding: 14,
  },
  identityBubble: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accentSoft,
    borderRadius: 999,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  identityBubbleText: {
    color: dispatchTheme.accentStrong,
    fontSize: 18,
    fontWeight: '800',
  },
  identityCopy: {
    flex: 1,
    marginLeft: 12,
  },
  identityName: {
    color: dispatchTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  identityEmail: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  sectionLabel: {
    color: dispatchTheme.textSoft,
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
  textArea: {
    minHeight: 90,
    paddingTop: 14,
    textAlignVertical: 'top',
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
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
});

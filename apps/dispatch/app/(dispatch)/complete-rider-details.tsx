import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import {
  DISPATCH_APPLICATION_PENDING_MESSAGE,
  DISPATCH_APPLICATION_REJECTED_FALLBACK,
} from '../../src/contexts/dispatchAuthFlow';
import { submitDispatchApplication } from '../../src/services/dispatchApplications';
import { buildDispatchPolicyAcceptance } from '../../src/services/policyAcceptance';
import { dispatchTheme } from '../../src/theme/palette';

const vehicleOptions = ['Bike', 'Scooter', 'Car', 'Van'] as const;

type CapturedDocument = {
  base64: string;
  mimeType: string;
  uri: string;
};

export default function CompleteRiderDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { clearError, error, loading, signOut, user } = useAuth();
  const [region, setRegion] = useState<(typeof nigeriaStateOptions)[number]>('Lagos');
  const [lga, setLga] = useState('');
  const [vehicleType, setVehicleType] = useState<(typeof vehicleOptions)[number]>('Bike');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlateNumber, setVehiclePlateNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [licenceFront, setLicenceFront] = useState<CapturedDocument | null>(null);
  const [licenceBack, setLicenceBack] = useState<CapturedDocument | null>(null);
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<'pending' | 'rejected' | 'approved' | null>(null);
  const [submissionSubmittedAt, setSubmissionSubmittedAt] = useState<string | null>(null);

  const lgaOptions = useMemo(() => getLgaOptionsForState(region), [region]);
  const contactName = useMemo(
    () => user?.displayName?.trim() || user?.email?.split('@')[0]?.trim() || 'Rider',
    [user?.displayName, user?.email]
  );
  const contactPhone = useMemo(() => user?.phoneNumber?.trim() || 'Saved on signup', [user?.phoneNumber]);
  const currentApplicationStatus =
    submissionStatus ?? (user?.dispatchApplicationStatus === 'pending' || user?.dispatchApplicationStatus === 'rejected'
      ? user.dispatchApplicationStatus
      : null);
  const rejectionReason = user?.dispatchApplicationRejectionReason ?? null;

  useEffect(() => {
    if (lgaOptions.length === 0) {
      setLga('');
      return;
    }

    setLga((currentLga) => (lgaOptions.includes(currentLga) ? currentLga : lgaOptions[0]));
  }, [lgaOptions]);

  useEffect(() => {
    if (user?.dispatchApplicationStatus === 'pending' || user?.dispatchApplicationStatus === 'rejected') {
      setSubmissionStatus(user.dispatchApplicationStatus);
      setSubmissionSubmittedAt(user.dispatchApplicationReviewedAt ?? null);
    }
  }, [user?.dispatchApplicationReviewedAt, user?.dispatchApplicationStatus]);

  const handleFieldChange = (setter: (value: string) => void) => (value: string) => {
    if (error) {
      clearError();
    }

    setter(value);
  };

  const handlePickDocument = useCallback(async (setter: (document: CapturedDocument | null) => void) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access blocked', 'Allow photo access to capture your licence documents.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      base64: true,
      mediaTypes: ['images'],
      quality: 0.72,
    });

    if (result.canceled || !result.assets[0]?.base64 || !result.assets[0]?.uri) {
      return;
    }

    setter({
      base64: result.assets[0].base64,
      mimeType: result.assets[0].mimeType ?? 'image/jpeg',
      uri: result.assets[0].uri,
    });
  }, []);

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert('Profile unavailable', 'Sign in again before submitting your rider application.');
      return;
    }

    if (!lga.trim() || !vehicleMake.trim() || !vehicleModel.trim() || !vehiclePlateNumber.trim() || !licenseNumber.trim()) {
      Alert.alert('Missing details', 'Fill in your dispatch area and vehicle details before submitting.');
      return;
    }

    if (!currentAddress.trim()) {
      Alert.alert('Missing base address', 'Add your current base or pickup address before submitting.');
      return;
    }

    if (!licenceFront || !licenceBack) {
      Alert.alert('Missing documents', 'Upload both sides of your licence before submitting.');
      return;
    }

    try {
      const result = await submitDispatchApplication({
        currentAddress: currentAddress.trim(),
        displayName: contactName,
        licenceBackBase64: licenceBack.base64,
        licenceBackMimeType: licenceBack.mimeType,
        licenceFrontBase64: licenceFront.base64,
        licenceFrontMimeType: licenceFront.mimeType,
        licenseNumber: licenseNumber.trim(),
        lga: lga.trim(),
        phoneNumber: contactPhone,
        policyAcceptance: buildDispatchPolicyAcceptance('dispatch_signup'),
        region,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehiclePlateNumber: vehiclePlateNumber.trim(),
        vehicleType,
      });

      setSubmissionStatus(result.status);
      setSubmissionSubmittedAt(result.submittedAt);
      Alert.alert('Application submitted', 'Your courier details are under review.');
    } catch (nextError: any) {
      Alert.alert('Unable to submit', nextError.message ?? 'Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      Alert.alert('Sign out failed', nextError.message ?? 'Unable to sign out right now.');
    }
  };

  const renderStatusBanner = () => {
    if (!currentApplicationStatus) {
      return null;
    }

    const isRejected = currentApplicationStatus === 'rejected';

    return (
      <View style={[styles.statusBanner, isRejected ? styles.statusBannerRejected : styles.statusBannerPending]}>
        <Text style={[styles.statusBannerTitle, isRejected ? styles.statusBannerTitleRejected : null]}>
          {isRejected ? 'Application needs updates' : 'Application under review'}
        </Text>
        <Text style={styles.statusBannerCopy}>
          {isRejected ? rejectionReason ?? DISPATCH_APPLICATION_REJECTED_FALLBACK : DISPATCH_APPLICATION_PENDING_MESSAGE}
        </Text>
        {submissionSubmittedAt ? (
          <Text style={styles.statusBannerMeta}>Submitted {formatDateTime(submissionSubmittedAt)}</Text>
        ) : null}
      </View>
    );
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
          Add the vehicle, licence, and base details ops needs before your courier account is verified.
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

        {renderStatusBanner()}

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

        <Text style={styles.sectionLabel}>Vehicle details</Text>
        <TextInput
          style={styles.input}
          placeholder="Vehicle make"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={vehicleMake}
          onChangeText={handleFieldChange(setVehicleMake)}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Vehicle model"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={vehicleModel}
          onChangeText={handleFieldChange(setVehicleModel)}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Plate number"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={vehiclePlateNumber}
          onChangeText={handleFieldChange(setVehiclePlateNumber)}
          editable={!loading}
          autoCapitalize="characters"
        />
        <TextInput
          style={styles.input}
          placeholder="Licence number"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          value={licenseNumber}
          onChangeText={handleFieldChange(setLicenseNumber)}
          editable={!loading}
          autoCapitalize="characters"
        />

        <Text style={styles.sectionLabel}>Licence documents</Text>
        <TouchableOpacity style={styles.documentButton} onPress={() => void handlePickDocument(setLicenceFront)}>
          <Text style={styles.documentButtonText}>{licenceFront ? 'Replace front image' : 'Capture front image'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.documentButton} onPress={() => void handlePickDocument(setLicenceBack)}>
          <Text style={styles.documentButtonText}>{licenceBack ? 'Replace back image' : 'Capture back image'}</Text>
        </TouchableOpacity>
        <Text style={styles.documentNote}>Images are stored privately and never exposed as public URLs.</Text>

        <Text style={styles.sectionLabel}>Base address</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Your current base, landmark, or pickup address"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          multiline
          value={currentAddress}
          onChangeText={handleFieldChange(setCurrentAddress)}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Submitting...' : 'Submit for review'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()} disabled={loading}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const INPUT_PLACEHOLDER_COLOR = '#6f7f79';

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));

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
  statusBanner: {
    borderRadius: 18,
    marginBottom: 8,
    padding: 14,
  },
  statusBannerPending: {
    backgroundColor: '#eefaf0',
    borderColor: '#cae9d0',
    borderWidth: 1,
  },
  statusBannerRejected: {
    backgroundColor: '#fff2f2',
    borderColor: '#f3cccc',
    borderWidth: 1,
  },
  statusBannerTitle: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  statusBannerTitleRejected: {
    color: dispatchTheme.danger,
  },
  statusBannerCopy: {
    color: dispatchTheme.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  statusBannerMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
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
    marginTop: 12,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  textArea: {
    minHeight: 92,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  documentButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 13,
  },
  documentButtonText: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  documentNote: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import { useAuth } from '../../src/contexts/AuthContext';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import {
  type DispatchRiderDraft,
  updateDispatchRider,
} from '../../src/services/dispatchRiderActions';
import { dispatchTheme } from '../../src/theme/palette';

const settingsGroups = [
  {
    title: 'Dispatch center',
    items: ['National dispatch control room', 'Coverage: Nigeria state and LGA rider regions'],
  },
  {
    title: 'Rules in force',
    items: ['Auto-assign riders under 2.5 km', 'Escalate pickups delayed beyond 8 mins', 'Rebalance zones every 15 mins'],
  },
  {
    title: 'Next build targets',
    items: ['Live map tracking', 'Assignment overrides', 'Courier incident logging'],
  },
];

const statusOptions = ['Available', 'Delivering', 'Pickup delayed', 'Offline'];
const createDefaultDraft = (): DispatchRiderDraft => ({
  acceptanceRate: 85,
  activeLoad: 0,
  completedTrips: 0,
  lga: '',
  name: '',
  status: 'Available',
  vehicleType: 'Bike',
  zone: '',
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { deleteAccount, loading: authLoading, signOut, user } = useAuth();
  const { error, riders } = useDispatchRiders();
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DispatchRiderDraft>(createDefaultDraft);
  const [saving, setSaving] = useState(false);
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);
  const lgaOptions = useMemo(() => getLgaOptionsForState(draft.zone), [draft.zone]);
  const currentRider = useMemo(
    () => (user ? riders.find((rider) => rider.id === user.uid) ?? null : null),
    [riders, user]
  );

  const mapProvider = useMemo(
    () => (Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined),
    []
  );
  const mapRegion = useMemo(() => {
    if (riders.length === 0) {
      return {
        latitude: 9.0765,
        longitude: 7.3986,
        latitudeDelta: 0.22,
        longitudeDelta: 0.22,
      };
    }

    const latitudes = riders.map((rider) => rider.latitude);
    const longitudes = riders.map((rider) => rider.longitude);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);

    return {
      latitude: (minLatitude + maxLatitude) / 2,
      longitude: (minLongitude + maxLongitude) / 2,
      latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.8, 0.08),
      longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.8, 0.08),
    };
  }, [riders]);

  const populateDraftFromRider = useCallback(
    (riderId: string) => {
      const rider = riders.find((candidate) => candidate.id === riderId);

      if (!rider) {
        return;
      }

      setSelectedRiderId(rider.id);
      setDraft({
        acceptanceRate: 85,
        activeLoad: rider.activeLoadCount,
        completedTrips: rider.completedTripsCount,
        lga: rider.lga ?? '',
        name: rider.name,
        zone: rider.region ?? rider.zone,
        status: rider.status,
        vehicleType: rider.vehicleType,
      });
    },
    [riders]
  );

  const resetForm = () => {
    if (currentRider) {
      populateDraftFromRider(currentRider.id);
      return;
    }

    setSelectedRiderId(null);
    setDraft(createDefaultDraft());
  };

  const updateDraft = <K extends keyof DispatchRiderDraft>(key: K, value: DispatchRiderDraft[K]) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value,
    }));
  };

  useEffect(() => {
    if (lgaOptions.length === 0) {
      return;
    }

    setDraft((currentDraft) => ({
      ...currentDraft,
      lga: lgaOptions.includes(currentDraft.lga) ? currentDraft.lga : lgaOptions[0],
    }));
  }, [lgaOptions]);

  const handleSaveRider = async () => {
    if (!user?.uid || !currentRider) {
      Alert.alert('Profile unavailable', 'Your rider profile has to be provisioned by admin approval before you can update it.');
      return;
    }

    if (!draft.name.trim() || !draft.zone.trim() || !draft.lga.trim()) {
      Alert.alert('Missing details', 'Select your dispatch state and LGA before saving.');
      return;
    }

    setSaving(true);

    try {
      await updateDispatchRider(user.uid, {
        ...draft,
        lga: draft.lga.trim(),
        name: draft.name.trim(),
        zone: draft.zone.trim(),
      });

      resetForm();
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Could not save this rider profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      Alert.alert('Sign out failed', nextError.message ?? 'Could not sign out right now.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete rider account',
      'Dispatch accounts with active assignments cannot remove themselves. When delivery work or roster ownership still exists, admin offboarding is required instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (nextError: any) {
              Alert.alert('Delete blocked', nextError.message ?? 'Unable to delete this account right now.');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (currentRider && selectedRiderId !== currentRider.id) {
      populateDraftFromRider(currentRider.id);
    }
  }, [currentRider, populateDraftFromRider, selectedRiderId]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Fooders</Text>
        <Text style={styles.title}>My rider status</Text>
        <Text style={styles.copy}>
          Keep your live rider status and dispatch base current here. Team visibility stays below, but provisioning and offboarding remain admin-controlled.
        </Text>
      </View>

      <View style={styles.groupCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.groupTitle}>My rider profile</Text>
            <Text style={styles.groupSubtitle}>
              Admin approval creates rider records. From here you can keep your own live dispatch status and service area current.
            </Text>
          </View>
          <TouchableOpacity style={styles.secondaryAction} onPress={resetForm}>
            <Text style={styles.secondaryActionText}>Reset</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!currentRider ? (
          <Text style={styles.helperText}>
            Your rider record is not ready yet. Wait for admin approval before trying to update live dispatch status.
          </Text>
        ) : null}

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Rider name</Text>
          <View style={styles.readOnlyInput}>
            <Text style={styles.readOnlyValue}>{currentRider?.name ?? 'Pending admin setup'}</Text>
            <Text style={styles.readOnlyHint}>Admin-managed identity field</Text>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Dispatch state</Text>
          <CompactOptionPicker
            label="Dispatch state"
            selectedValue={draft.zone}
            options={nigeriaStateOptions}
            isOpen={openPicker === 'state'}
            onToggle={() => setOpenPicker((current) => (current === 'state' ? null : 'state'))}
            onSelect={(value) => {
              updateDraft('zone', value);
              setOpenPicker(null);
            }}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Local government area</Text>
          <CompactOptionPicker
            label="Local government area"
            selectedValue={draft.lga}
            options={lgaOptions}
            isOpen={openPicker === 'lga'}
            onToggle={() => setOpenPicker((current) => (current === 'lga' ? null : 'lga'))}
            onSelect={(value) => {
              updateDraft('lga', value);
              setOpenPicker(null);
            }}
          />
        </View>

        <View style={styles.inlineGroup}>
          <View style={styles.inlineField}>
            <Text style={styles.fieldLabel}>Trips today</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyValue}>{currentRider?.completedTrips ?? '0'}</Text>
              <Text style={styles.readOnlyHint}>Dispatch-managed metric</Text>
            </View>
          </View>
          <View style={styles.inlineField}>
            <Text style={styles.fieldLabel}>Active load</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyValue}>{currentRider?.activeLoad ?? '0 orders'}</Text>
              <Text style={styles.readOnlyHint}>Dispatch-managed metric</Text>
            </View>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Acceptance rate</Text>
          <View style={styles.readOnlyInput}>
            <Text style={styles.readOnlyValue}>85%</Text>
            <Text style={styles.readOnlyHint}>Fixed dispatch baseline</Text>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.chipRow}>
            {statusOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, draft.status === option ? styles.chipActive : null]}
                onPress={() => updateDraft('status', option)}
              >
                <Text style={[styles.chipText, draft.status === option ? styles.chipTextActive : null]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Vehicle</Text>
          <View style={styles.readOnlyInput}>
            <Text style={styles.readOnlyValue}>{currentRider?.vehicleType ?? 'Pending admin setup'}</Text>
            <Text style={styles.readOnlyHint}>Vehicle class is set during approval</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryAction} onPress={handleSaveRider} disabled={saving || !currentRider}>
          <Text style={styles.primaryActionText}>{saving ? 'Saving rider...' : 'Update my rider profile'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.groupCard}>
        <Text style={styles.groupTitle}>Live rider map</Text>
        <Text style={styles.groupSubtitle}>
          Exact rider coordinates are used when available. Otherwise, we place riders on their selected LGA so the map still stays useful.
        </Text>
        <View style={styles.mapCard}>
          <MapView provider={mapProvider} style={styles.map} initialRegion={mapRegion}>
            {riders.map((rider) => (
              <Marker
                key={rider.id}
                coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
                title={rider.name}
                description={`${rider.zone} - ${rider.hasPreciseLocation ? 'Live coordinate' : 'LGA-based pin'}`}
              />
            ))}
          </MapView>
        </View>
        <View style={styles.mapLegendRow}>
          <View style={styles.mapLegendChip}>
            <Text style={styles.mapLegendText}>
              {riders.filter((rider) => rider.hasPreciseLocation).length} live pins
            </Text>
          </View>
          <View style={styles.mapLegendChip}>
            <Text style={styles.mapLegendText}>
              {riders.filter((rider) => !rider.hasPreciseLocation).length} LGA pins
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.groupCard}>
        <Text style={styles.groupTitle}>Live rider records</Text>
        <Text style={styles.groupSubtitle}>Roster view only. Rider provisioning and other rider records are admin-managed.</Text>
        {riders.length === 0 ? (
          <Text style={styles.emptyText}>No rider profiles yet.</Text>
        ) : (
          riders.map((rider) => (
            <View
              key={rider.id}
              style={[styles.riderCard, selectedRiderId === rider.id ? styles.riderCardActive : null]}
            >
              <View>
                <Text style={styles.riderName}>{rider.name}</Text>
                <Text style={styles.riderMeta}>{`${rider.zone} - ${rider.status} - ${rider.vehicleType}`}</Text>
              </View>
              <Text style={styles.riderLoad}>{rider.activeLoad}</Text>
            </View>
          ))
        )}
      </View>

      {settingsGroups.map((group) => (
        <View key={group.title} style={styles.groupCard}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          {group.items.map((item) => (
            <Text key={item} style={styles.groupItem}>
              {item}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.groupCard}>
        <Text style={styles.groupTitle}>Session</Text>
        <Text style={styles.groupSubtitle}>
          Sign out when you are done on this device. Delete is only for rider accounts that are no longer tied to live assignments.
        </Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={authLoading}>
          <Text style={styles.signOutButtonText}>Sign out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount} disabled={authLoading}>
          <Text style={styles.deleteButtonText}>Delete account</Text>
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
    padding: 18,
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderRadius: 26,
    padding: 22,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.cream,
    fontSize: 28,
    fontWeight: '800',
  },
  copy: {
    color: '#d6dfeb',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  groupCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  groupTitle: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  groupSubtitle: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  groupItem: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  sectionHeader: {
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  sectionHeaderCopy: {
    width: '100%',
  },
  secondaryAction: {
    alignSelf: 'flex-start',
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: 999,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryActionText: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 10,
  },
  formGroup: {
    marginTop: 10,
  },
  fieldLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  readOnlyInput: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  readOnlyValue: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '800',
  },
  readOnlyHint: {
    color: dispatchTheme.textSoft,
    fontSize: 12,
    marginTop: 4,
  },
  inlineGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  inlineField: {
    width: '48%',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: 999,
    marginBottom: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: dispatchTheme.accent,
  },
  chipText: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: 16,
    marginTop: 18,
    paddingVertical: 15,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  helperText: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  mapCard: {
    borderColor: dispatchTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  map: {
    height: 220,
    width: '100%',
  },
  mapLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  mapLegendChip: {
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: 999,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapLegendText: {
    color: dispatchTheme.accentStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  riderCard: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.cream,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 14,
  },
  riderCardActive: {
    backgroundColor: dispatchTheme.accentSoft,
  },
  riderName: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  riderMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  riderLoad: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.text,
    borderRadius: 16,
    marginTop: 6,
    paddingVertical: 15,
  },
  signOutButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: dispatchTheme.danger,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 15,
  },
  deleteButtonText: {
    color: dispatchTheme.danger,
    fontSize: 15,
    fontWeight: '800',
  },
});

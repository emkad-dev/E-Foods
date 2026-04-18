import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import {
  createDispatchRider,
  type DispatchRiderDraft,
  updateDispatchRider,
} from '../../src/services/dispatchRiderActions';
import { dispatchTheme } from '../../src/theme/palette';

const settingsGroups = [
  {
    title: 'Dispatch center',
    items: ['Victoria Island control room', 'Coverage: Lagos Island, Lekki, Yaba, Mainland'],
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
const vehicleOptions = ['Bike', 'Car', 'Van'];

const createDefaultDraft = (): DispatchRiderDraft => ({
  acceptanceRate: 85,
  activeLoad: 0,
  completedTrips: 0,
  name: '',
  status: 'Available',
  vehicleType: 'Bike',
  zone: '',
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { error, riders } = useDispatchRiders();
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DispatchRiderDraft>(createDefaultDraft);
  const [saving, setSaving] = useState(false);

  const selectedRider = useMemo(
    () => riders.find((rider) => rider.id === selectedRiderId) ?? null,
    [riders, selectedRiderId]
  );
  const mapProvider = useMemo(
    () => (Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined),
    []
  );
  const mapRegion = useMemo(() => {
    if (riders.length === 0) {
      return {
        latitude: 6.5244,
        longitude: 3.3792,
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

  const populateDraftFromRider = (riderId: string) => {
    const rider = riders.find((candidate) => candidate.id === riderId);

    if (!rider) {
      return;
    }

    setSelectedRiderId(rider.id);
    setDraft({
      acceptanceRate: 85,
      activeLoad: rider.activeLoadCount,
      completedTrips: rider.completedTripsCount,
      name: rider.name,
      status: rider.status,
      vehicleType: rider.vehicleType,
      zone: rider.zone,
    });
  };

  const resetForm = () => {
    setSelectedRiderId(null);
    setDraft(createDefaultDraft());
  };

  const updateDraft = <K extends keyof DispatchRiderDraft>(key: K, value: DispatchRiderDraft[K]) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [key]: value,
    }));
  };

  const handleSaveRider = async () => {
    if (!draft.name.trim() || !draft.zone.trim()) {
      Alert.alert('Missing details', 'Enter the rider name and zone before saving.');
      return;
    }

    setSaving(true);

    try {
      if (selectedRiderId) {
        await updateDispatchRider(selectedRiderId, {
          ...draft,
          name: draft.name.trim(),
          zone: draft.zone.trim(),
        });
      } else {
        await createDispatchRider({
          ...draft,
          name: draft.name.trim(),
          zone: draft.zone.trim(),
        });
      }

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>E-Fooders</Text>
        <Text style={styles.title}>Operations center Alpha</Text>
        <Text style={styles.copy}>
          This is where dispatch settings, handoff policies, and team controls live for the people moving orders every day.
        </Text>
      </View>

      <View style={styles.groupCard}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.groupTitle}>Rider management</Text>
            <Text style={styles.groupSubtitle}>Create and edit live `dispatchProfiles` records from inside dispatch.</Text>
          </View>
          <TouchableOpacity style={styles.secondaryAction} onPress={resetForm}>
            <Text style={styles.secondaryActionText}>New rider</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Rider name</Text>
          <TextInput
            style={styles.input}
            placeholder="Sadiq A."
            value={draft.name}
            onChangeText={(value) => updateDraft('name', value)}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Zone</Text>
          <TextInput
            style={styles.input}
            placeholder="Lekki East"
            value={draft.zone}
            onChangeText={(value) => updateDraft('zone', value)}
          />
        </View>

        <View style={styles.inlineGroup}>
          <View style={styles.inlineField}>
            <Text style={styles.fieldLabel}>Trips today</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(draft.completedTrips)}
              onChangeText={(value) => updateDraft('completedTrips', Number.parseInt(value || '0', 10) || 0)}
            />
          </View>
          <View style={styles.inlineField}>
            <Text style={styles.fieldLabel}>Active load</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(draft.activeLoad)}
              onChangeText={(value) => updateDraft('activeLoad', Number.parseInt(value || '0', 10) || 0)}
            />
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
          <View style={styles.chipRow}>
            {vehicleOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, draft.vehicleType === option ? styles.chipActive : null]}
                onPress={() => updateDraft('vehicleType', option)}
              >
                <Text style={[styles.chipText, draft.vehicleType === option ? styles.chipTextActive : null]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.primaryAction} onPress={handleSaveRider} disabled={saving}>
          <Text style={styles.primaryActionText}>
            {saving ? 'Saving rider...' : selectedRider ? 'Update rider' : 'Create rider'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.groupCard}>
        <Text style={styles.groupTitle}>Live rider map</Text>
        <Text style={styles.groupSubtitle}>
          Exact rider coordinates are used when available. Otherwise, we place riders on their current zone so the map still stays useful.
        </Text>
        <View style={styles.mapCard}>
          <MapView provider={mapProvider} style={styles.map} initialRegion={mapRegion}>
            {riders.map((rider) => (
              <Marker
                key={rider.id}
                coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
                title={rider.name}
                description={`${rider.zone} - ${rider.hasPreciseLocation ? 'Live coordinate' : 'Zone-based pin'}`}
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
              {riders.filter((rider) => !rider.hasPreciseLocation).length} zone pins
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.groupCard}>
        <Text style={styles.groupTitle}>Live rider records</Text>
        <Text style={styles.groupSubtitle}>Tap any rider to load their profile into the editor above.</Text>
        {riders.length === 0 ? (
          <Text style={styles.emptyText}>No rider profiles yet.</Text>
        ) : (
          riders.map((rider) => (
            <TouchableOpacity
              key={rider.id}
              style={[styles.riderCard, selectedRiderId === rider.id ? styles.riderCardActive : null]}
              onPress={() => populateDraftFromRider(rider.id)}
            >
              <View>
                <Text style={styles.riderName}>{rider.name}</Text>
                <Text style={styles.riderMeta}>{`${rider.zone} - ${rider.status} - ${rider.vehicleType}`}</Text>
              </View>
              <Text style={styles.riderLoad}>{rider.activeLoad}</Text>
            </TouchableOpacity>
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
        <Text style={styles.groupSubtitle}>Sign out of the dispatch board on this device.</Text>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutButtonText}>Sign out</Text>
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
    color: '#f7ead8',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  groupCard: {
    backgroundColor: dispatchTheme.surface,
    borderRadius: 22,
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
});

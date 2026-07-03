import { FontAwesome } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import DispatchLiveMap from '../../src/components/DispatchLiveMap';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import { useAuth } from '../../src/contexts/AuthContext';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import { useWeeklyEarnings } from '../../src/hooks/useWeeklyEarnings';
import {
  type DispatchRiderDraft,
  updateDispatchRider,
} from '../../src/services/dispatchRiderActions';
import { OpenStreetMapLocationService } from '../../src/services/osmLocation';
import { dispatchTheme } from '../../src/theme/palette';

type ProfileSection =
  | 'profile'
  | 'availableSessions'
  | 'mySessions'
  | 'inbox'
  | 'recentDeliveries'
  | 'weeklyEarnings'
  | 'payments'
  | 'activity'
  | 'rewards'
  | 'session';

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

const menuItems: { icon: keyof typeof FontAwesome.glyphMap; key: ProfileSection; label: string }[] = [
  { icon: 'user-o', key: 'profile', label: 'My profile' },
  { icon: 'calendar-check-o', key: 'availableSessions', label: 'Available sessions' },
  { icon: 'calendar-o', key: 'mySessions', label: 'My sessions' },
  { icon: 'bell-o', key: 'inbox', label: 'Inbox' },
  { icon: 'history', key: 'recentDeliveries', label: 'Recent deliveries' },
  { icon: 'line-chart', key: 'weeklyEarnings', label: 'Weekly earnings' },
  { icon: 'credit-card', key: 'payments', label: 'Payments' },
  { icon: 'bar-chart', key: 'activity', label: 'Activity Insights' },
  { icon: 'gift', key: 'rewards', label: 'Rewards' },
  { icon: 'sign-out', key: 'session', label: 'Session' },
];

const formatMoney = (amount: number) => `₦${amount.toFixed(2)}`;

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Time pending';
  }

  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { deleteAccount, loading: authLoading, signOut, user } = useAuth();
  const { error, riders } = useDispatchRiders();
  const { error: earningsError, loading: earningsLoading, refresh: refreshEarnings, refreshing, report } = useWeeklyEarnings();
  const [selectedSection, setSelectedSection] = useState<ProfileSection>('profile');
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DispatchRiderDraft>(createDefaultDraft);
  const [saving, setSaving] = useState(false);
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);
  const lgaOptions = useMemo(() => getLgaOptionsForState(draft.zone), [draft.zone]);
  const currentRider = useMemo(
    () => (user ? riders.find((rider) => rider.id === user.uid) ?? null : null),
    [riders, user]
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

    const riderCoords = riders.map((rider) => ({
      latitude: rider.latitude,
      longitude: rider.longitude,
    }));

    return OpenStreetMapLocationService.calculateMapRegionBounds(riderCoords, 0.12) || {
      latitude: 9.0765,
      longitude: 7.3986,
      latitudeDelta: 0.22,
      longitudeDelta: 0.22,
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
        status: rider.status,
        vehicleType: rider.vehicleType,
        zone: rider.region ?? rider.zone,
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

  useEffect(() => {
    if (currentRider && selectedRiderId !== currentRider.id) {
      populateDraftFromRider(currentRider.id);
    }
  }, [currentRider, populateDraftFromRider, selectedRiderId]);

  const handleSaveRider = async () => {
    if (!user?.uid) {
      Alert.alert('Profile unavailable', 'Sign in again before updating your rider profile.');
      return;
    }

    if (!draft.name.trim() || !draft.zone.trim() || !draft.lga.trim()) {
      Alert.alert('Missing details', 'Select your dispatch state and LGA.');
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
    Alert.alert('Delete rider account', 'Admin offboarding is required while assignments exist.', [
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
    ]);
  };

  const renderHeader = () => (
    <View style={styles.identityCard}>
      <View>
        <Text style={styles.nameText}>{currentRider?.name ?? user?.displayName ?? 'Feaster'}</Text>
        <Text style={styles.statusText}>{currentRider?.status ?? 'Ready to go live'}</Text>
      </View>
      <View style={styles.pointsPill}>
        <FontAwesome name="trophy" size={12} color={dispatchTheme.text} />
        <Text style={styles.pointsText}>{currentRider?.completedTripsCount ?? 0}</Text>
      </View>
    </View>
  );

  const renderMenu = () => (
    <View style={styles.menuCard}>
      {menuItems.map((item) => {
        const isActive = selectedSection === item.key;

        return (
          <TouchableOpacity
            key={item.key}
            activeOpacity={0.85}
            onPress={() => setSelectedSection(item.key)}
            style={[styles.menuItem, isActive ? styles.menuItemActive : null]}
          >
            <FontAwesome name={item.icon} size={15} color={isActive ? '#07140c' : dispatchTheme.textMuted} />
            <Text style={[styles.menuItemText, isActive ? styles.menuItemTextActive : null]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderProfileEditor = () => (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle}>My profile</Text>
        <TouchableOpacity style={styles.smallAction} onPress={resetForm}>
          <Text style={styles.smallActionText}>Reset</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!currentRider ? <Text style={styles.emptyText}>Rider record will be created on the first save.</Text> : null}

      <FieldLabel label="Rider name" />
      <ReadOnlyValue hint="Admin-managed" value={currentRider?.name ?? 'Pending'} />

      <FieldLabel label="Dispatch state" />
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

      <FieldLabel label="Local government area" />
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

      <FieldLabel label="Status" />
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

      <TouchableOpacity style={styles.primaryAction} onPress={handleSaveRider} disabled={saving || !currentRider}>
        <Text style={styles.primaryActionText}>{saving ? 'Saving...' : 'Update profile'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderWeeklyEarnings = () => (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <TouchableOpacity style={styles.backIcon} onPress={() => setSelectedSection('profile')}>
          <FontAwesome name="arrow-left" size={14} color={dispatchTheme.text} />
        </TouchableOpacity>
        <Text style={styles.detailTitle}>Weekly earnings</Text>
      </View>
      {earningsLoading ? (
        <ActivityIndicator color={dispatchTheme.accent} />
      ) : (
        <>
          <View style={styles.earningsHero}>
            <Text style={styles.balanceLabel}>This week</Text>
            <Text style={styles.balanceValue}>{formatMoney(report?.total ?? 0)}</Text>
            <Text style={styles.resetText}>Resets Monday 00:00</Text>
          </View>
          {earningsError ? <Text style={styles.errorText}>{earningsError}</Text> : null}
          <View style={styles.metricRow}>
            <Metric label="Delivered orders" value={String(report?.deliveredOrders ?? 0)} />
            <Metric label="Average" value={formatMoney(report?.averagePerDelivery ?? 0)} />
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={refreshEarnings} disabled={refreshing}>
            <Text style={styles.secondaryButtonText}>{refreshing ? 'Refreshing...' : 'Refresh'}</Text>
          </TouchableOpacity>
          <Text style={styles.sectionLabel}>Track record</Text>
          {report?.records.length ? (
            report.records.map((record) => (
              <View key={record.orderId} style={styles.transactionRow}>
                <View>
                  <Text style={styles.transactionTitle}>Order #{record.orderId.slice(-6)}</Text>
                  <Text style={styles.transactionMeta}>
                    {formatDateTime(record.deliveredAt)} · {record.restaurantName ?? 'Restaurant'}
                  </Text>
                  <Text style={styles.transactionMeta}>{record.address ?? 'Area pending'}</Text>
                </View>
                <Text style={styles.transactionAmount}>{formatMoney(record.amount)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No earnings this week.</Text>
          )}
        </>
      )}
    </View>
  );

  const renderActivity = () => (
    <View style={styles.detailCard}>
      <Text style={styles.detailTitle}>Activity Insights</Text>
      <View style={styles.mapCard}>
        <DispatchLiveMap
          riders={riders.map((rider) => ({
            id: rider.id,
            latitude: rider.latitude,
            longitude: rider.longitude,
            name: rider.name,
            zone: rider.zone,
            hasPreciseLocation: rider.hasPreciseLocation,
          }))}
          region={mapRegion}
        />
      </View>
      <View style={styles.metricRow}>
        <Metric label="Live pins" value={String(riders.filter((rider) => rider.hasPreciseLocation).length)} />
        <Metric label="LGA pins" value={String(riders.filter((rider) => !rider.hasPreciseLocation).length)} />
      </View>
    </View>
  );

  const renderSession = () => (
    <View style={styles.detailCard}>
      <Text style={styles.detailTitle}>Session</Text>
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={authLoading}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount} disabled={authLoading}>
        <Text style={styles.deleteButtonText}>Delete account</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPlaceholder = (title: string, copy: string) => (
    <View style={styles.detailCard}>
      <Text style={styles.detailTitle}>{title}</Text>
      <Text style={styles.emptyText}>{copy}</Text>
    </View>
  );

  const renderDetail = () => {
    switch (selectedSection) {
      case 'profile':
        return renderProfileEditor();
      case 'weeklyEarnings':
        return renderWeeklyEarnings();
      case 'activity':
        return renderActivity();
      case 'session':
        return renderSession();
      case 'recentDeliveries':
        return renderPlaceholder('Recent deliveries', 'Completed deliveries appear in the deliveries tab.');
      case 'availableSessions':
        return renderPlaceholder('Available sessions', 'Sessions are not open yet.');
      case 'mySessions':
        return renderPlaceholder('My sessions', 'No active session schedule.');
      case 'inbox':
        return renderPlaceholder('Inbox', 'No new dispatch messages.');
      case 'payments':
        return renderPlaceholder('Payments', 'Payout setup comes later.');
      case 'rewards':
        return renderPlaceholder('Rewards', 'No rewards yet.');
      default:
        return null;
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      {renderHeader()}
      {renderMenu()}
      {renderDetail()}
    </ScrollView>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function ReadOnlyValue({ hint, value }: { hint: string; value: string | number }) {
  return (
    <View style={styles.readOnlyInput}>
      <Text style={styles.readOnlyValue}>{value}</Text>
      <Text style={styles.readOnlyHint}>{hint}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
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
  identityCard: {
    alignItems: 'flex-start',
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 18,
  },
  nameText: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  statusText: {
    color: dispatchTheme.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  pointsPill: {
    alignItems: 'center',
    backgroundColor: '#13f28a',
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pointsText: {
    color: dispatchTheme.text,
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 5,
  },
  menuCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 14,
    overflow: 'hidden',
  },
  menuItem: {
    alignItems: 'center',
    borderBottomColor: dispatchTheme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  menuItemActive: {
    backgroundColor: '#13f28a',
  },
  menuItemText: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 12,
  },
  menuItemTextActive: {
    color: '#07140c',
  },
  detailCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  detailTitle: {
    color: dispatchTheme.text,
    fontSize: 20,
    fontWeight: '900',
  },
  backIcon: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    marginRight: 10,
    width: 34,
  },
  smallAction: {
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: 999,
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallActionText: {
    color: dispatchTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  fieldLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  readOnlyInput: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 14,
  },
  readOnlyValue: {
    color: dispatchTheme.text,
    fontSize: 17,
    fontWeight: '900',
  },
  readOnlyHint: {
    color: dispatchTheme.textSoft,
    fontSize: 12,
    marginTop: 4,
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
    fontWeight: '800',
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
    fontWeight: '900',
  },
  earningsHero: {
    alignItems: 'center',
    backgroundColor: '#f1f5f2',
    borderRadius: 22,
    padding: 18,
  },
  balanceLabel: {
    backgroundColor: '#13f28a',
    borderRadius: 999,
    color: '#07140c',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  balanceValue: {
    color: dispatchTheme.text,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 10,
  },
  resetText: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  metricCard: {
    backgroundColor: dispatchTheme.cream,
    borderRadius: 16,
    flex: 1,
    padding: 14,
  },
  metricValue: {
    color: dispatchTheme.text,
    fontSize: 18,
    fontWeight: '900',
  },
  metricLabel: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: 14,
    marginTop: 12,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: dispatchTheme.accentStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  sectionLabel: {
    color: dispatchTheme.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 18,
  },
  transactionRow: {
    alignItems: 'center',
    backgroundColor: '#f1f5f2',
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 12,
  },
  transactionTitle: {
    color: dispatchTheme.text,
    fontSize: 14,
    fontWeight: '900',
  },
  transactionMeta: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  transactionAmount: {
    color: dispatchTheme.accentStrong,
    fontSize: 14,
    fontWeight: '900',
  },
  mapCard: {
    borderColor: dispatchTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    overflow: 'hidden',
  },
  map: {
    height: 220,
    width: '100%',
  },
  emptyText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: dispatchTheme.danger,
    fontSize: 13,
    lineHeight: 19,
    marginVertical: 8,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.text,
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 15,
  },
  signOutButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
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
    fontWeight: '900',
  },
});

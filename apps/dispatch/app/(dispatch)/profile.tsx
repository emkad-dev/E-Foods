import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Imported by module path, not from the '@feasty/design-system' barrel, on
// purpose: the barrel re-exports useFeastyFonts, which pulls expo-font and six
// @expo-google-fonts faces into the bundle. This app has not adopted the design
// system and does not declare those dependencies, so it takes the one primitive
// it needs. Customer and partner, which already load the fonts, import it by
// package name.
import { useConfirm } from '../../../../packages/design-system/src/primitives/ConfirmDialog';
import { useNotice } from '../../../../packages/design-system/src/primitives/Notice';
import {
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_TITLE,
  accountDeletionErrorMessage,
  accountDeletionParagraphs,
} from '../../../../packages/domain/src/accountDeletion';
import CompactOptionPicker from '../../src/components/CompactOptionPicker';
import { getLgaOptionsForState, nigeriaStateOptions } from '../../src/constants/nigeriaLocations';
import { useAuth } from '../../src/contexts/AuthContext';
import { useDispatchRiders } from '../../src/hooks/useDispatchRiders';
import { useWeeklyEarnings } from '../../src/hooks/useWeeklyEarnings';
import {
  type DispatchRiderDraft,
  updateDispatchRider,
} from '../../src/services/dispatchRiderActions';
import { dispatchTheme } from '../../src/theme/palette';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import { SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

/**
 * The empty draft, used before a rider record has loaded.
 *
 * `acceptanceRate` and `completedTrips` are inert here: the server keeps
 * `existingRider?.acceptanceRate` and `existingRider?.completedTrips` on every
 * save, so neither field this object carries can ever reach the database. They
 * are present because DispatchRiderDraft requires them.
 */
const createDefaultDraft = (): DispatchRiderDraft => ({
  acceptanceRate: 85,
  completedTrips: 0,
  lga: '',
  name: '',
  status: 'Available',
  vehicleType: 'Bike',
  zone: '',
});

/*
  There is no ProfileSection type and no menuItems array any more.

  Both were navigation, and this screen has nothing left to navigate. Eleven
  destinations behind a menu was a reasonable shape; three is not -- it made a
  rider tap twice to reach the thing they open this screen for, and tap again
  to get back. The menu was the last piece of the eleven-section design still
  standing after the other ten were found to be placeholders or fiction.

  One scroll instead, in the order a rider cares about: what I earned, who I am
  and where I work, and how to leave. Destructive last, which is where the
  customer app puts it too.
*/

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
  const { confirm, confirmDialog } = useConfirm();
  // Saving and signing out reported failure through `Alert`, an empty function
  // under react-native-web. Floating rather than inline: the Save button is one
  // row inside a scrolling section, so an inline notice can sit off-screen.
  // The offset clears the 70px tab bar defined in ./_layout.tsx.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: insets.bottom + 86,
  });
  // Separate from `error` above, which belongs to useDispatchRiders and renders
  // inside the profile editor; this one sits beside the delete button.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { error: earningsError, loading: earningsLoading, refresh: refreshEarnings, refreshing, report } = useWeeklyEarnings();
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DispatchRiderDraft>(createDefaultDraft);
  const [saving, setSaving] = useState(false);
  const [openPicker, setOpenPicker] = useState<'state' | 'lga' | null>(null);
  const lgaOptions = useMemo(() => getLgaOptionsForState(draft.zone), [draft.zone]);
  const currentRider = useMemo(
    () => (user ? riders.find((rider) => rider.id === user.uid) ?? null : null),
    [riders, user]
  );

  const populateDraftFromRider = useCallback(
    (riderId: string) => {
      const rider = riders.find((candidate) => candidate.id === riderId);

      if (!rider) {
        return;
      }

      setSelectedRiderId(rider.id);
      setDraft({
        // Was the literal 85, beside the rider's REAL parsed rate sitting
        // unused on the same object. Neither value reaches the database --
        // dispatch.ts keeps `existingRider?.acceptanceRate` on every save --
        // but a draft seeded from a rider should carry that rider's numbers.
        acceptanceRate: rider.acceptanceRateValue,
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
      showNotice({
        tone: 'error',
        title: 'Profile unavailable',
        message: 'Sign in again before updating your rider profile.',
      });
      return;
    }

    if (!draft.name.trim() || !draft.zone.trim() || !draft.lga.trim()) {
      showNotice({
        tone: 'error',
        title: 'Missing details',
        message: 'Select your dispatch state and LGA.',
      });
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
      // The only thing a successful save used to do was clear the form, which
      // reads the same as a form that reset itself for some other reason. The
      // success notice self-dismisses, so it confirms without demanding an OK.
      showNotice({ tone: 'success', title: 'Rider profile saved' });
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Save failed',
        message: nextError.message ?? 'Could not save this rider profile.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      // A failed sign-out leaves the rider looking at their own profile after
      // pressing Sign out, which reads as a frozen button unless it says why.
      showNotice({
        tone: 'error',
        title: 'Sign out failed',
        message: nextError.message ?? 'Could not sign out right now.',
      });
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);

    try {
      await confirm({
        title: ACCOUNT_DELETION_TITLE,
        paragraphs: accountDeletionParagraphs('dispatch'),
        confirmLabel: ACCOUNT_DELETION_CONFIRM_LABEL,
        cancelLabel: ACCOUNT_DELETION_CANCEL_LABEL,
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a second tap cannot fire a second delete.
        onConfirm: deleteAccount,
      });
    } catch (nextError) {
      // The backend's 412 ("Dispatch accounts with active delivery work...") is
      // the whole point of this path, so it is shown in the screen. Alert is a
      // no-op under react-native-web, and this app is one web export away from
      // inheriting that bug.
      setDeleteError(accountDeletionErrorMessage(nextError));
    }
  };

  const renderHeader = () => (
    <View style={styles.identityCard}>
      <View>
        <Text style={styles.nameText}>{currentRider?.name ?? user?.displayName ?? 'Feaster'}</Text>
        <Text style={styles.statusText}>{currentRider?.status ?? 'Ready to go live'}</Text>
      </View>
      {/* The trophy pill used to sit here showing `completedTripsCount`. That
          column is written as 0 when a rider is approved, carried forward
          verbatim on every save, and incremented NOWHERE -- no handler and no
          trigger in supabase/migrations touches it. A rider on their five
          hundredth delivery was shown a trophy reading 0. A congratulation
          that never moves is worse than no congratulation. */}
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

      {/* A status picker used to sit here -- Available / Delivering / Pickup
          delayed / Offline. The server throws the choice away:
          `status: existingRider?.status ?? draft.status` in
          _shared/domains/dispatch.ts keeps the EXISTING value for any rider who
          already has a record, which is every rider who can reach this screen.
          `vehicleType` is discarded on the same line. The screen then showed
          "Rider profile saved". A control that silently does nothing and
          reports success is worse than no control: a rider marking themselves
          Offline believed they had stopped receiving work. Status is owned by
          the dispatch system and shown read-only in the header above. */}
      <TouchableOpacity style={styles.primaryAction} onPress={handleSaveRider} disabled={saving || !currentRider}>
        <Text style={styles.primaryActionText}>{saving ? 'Saving...' : 'Update profile'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderWeeklyEarnings = () => (
    <View style={styles.detailCard}>
      <Text style={styles.detailTitle}>Weekly earnings</Text>
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
          {/* A "Payout snapshot" card used to sit here. Nothing in this
              repository ever writes the CourierPayout table -- its only writer,
              `upsertCourierPayout`, has exactly one reference in the codebase,
              which is its own declaration -- so the read always fell through to
              the fallback: ledgerTotal = the week's total, status "pending",
              paidAt null. It printed the SAME money as the hero figure above
              it, under a second heading, captioned as a payout ledger that does
              not exist. Two numbers that are one number is how a rider comes to
              believe they are owed twice. */}
        </>
      )}
    </View>
  );

  /*
    `renderShiftSlots` used to be here.

    The CourierShiftSlot rows are a real table read, but their CONTENT is a
    literal: admin.ts writes exactly three slots at hours 8/12/16 with
    `forecastDemand` taken from the array [2, 3, 4], once, when a rider's
    application is approved, and nothing ever updates them. The screen told the
    rider these were "seeded from the operations forecast" and showed when "the
    courier network expects to be busiest". There is no forecast.

    It was also unusable: `dispatchUpsertShiftSlots` is fully implemented on the
    server and called from no app code, so a rider could not claim or change a
    slot. And `formatShiftWindow` printed hour:minute with no date, so a rider
    approved months ago still read "08:00 - 12:00 - planned" as though it were
    coming up.

    The table, the RPC and the hook all remain. When slots are really published
    and really claimable, this section comes back with a date on it.
  */

  /*
    `renderActivity` used to be here -- a live map of the fleet plus "Live pins"
    and "LGA pins".

    It was the wrong scope: `dispatchGetRiders` returns EVERY DispatchRiderRecord
    unfiltered, so both figures counted the whole fleet while sitting on one
    rider's own profile. The split was degenerate too -- `hasPreciseLocation` is
    true whenever lat/lng are non-null, and approval always writes them
    (defaulting to a national centroid), so "LGA pins" was ~always 0 and "Live
    pins" was just the rider count.

    SEPARATELY, AND NOT FIXED BY THIS DELETION: that RPC still hands every
    dispatch user every other rider's name and live coordinates. Removing the
    screen removes the display, not the exposure. Raised with the owner.
  */

  const renderSession = () => (
    <View style={styles.detailCard}>
      <Text style={styles.detailTitle}>Session</Text>
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={authLoading}>
        <Text style={styles.signOutButtonText}>Sign out</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount} disabled={authLoading}>
        <Text style={styles.deleteButtonText}>Delete account</Text>
      </TouchableOpacity>
      {deleteError ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
          {deleteError}
        </Text>
      ) : null}
    </View>
  );

  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView that would anchor it to
    // the bottom of the CONTENT and let it scroll away.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
        {renderHeader()}
        {/* Earnings first. It is the reason a rider opens this screen, and it
            used to be two taps away behind a menu. */}
        {renderWeeklyEarnings()}
        {renderProfileEditor()}
        {renderSession()}
        {confirmDialog}
      </ScrollView>
      {notice}
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ReadOnlyValue({ hint, value }: { hint: string; value: string | number }) {
  return (
    <View style={styles.readOnlyInput}>
      <Text style={styles.readOnlyValue}>{value}</Text>
      <Text style={styles.readOnlyHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  scroll: {
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
    borderRadius: radius['2xl'],
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
  detailCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius['2xl'],
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
  // The arrow out of Weekly earnings and Shift slots was drawn as a 34x34
  // box around a 14pt glyph -- 10pt short of the floor on both axes, and the
  // smallest thing a rider is asked to hit anywhere in this app. The box goes
  // to 44 and the three negative offsets give the extra 5pt back to the
  // layout, so the header row stays 34 tall and the title beside it starts at
  // the same x. The glyph is drawn where it always was; only the reachable
  // area moved, outward into the card's own 18pt padding, where nothing else
  // is.
  smallAction: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: radius.pill,
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
    borderRadius: radius.lg,
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
  primaryAction: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    marginTop: 18,
    paddingVertical: 15,
  },
  primaryActionText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '900',
  },
  earningsHero: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: radius['2xl'],
    padding: 18,
  },
  balanceLabel: {
    backgroundColor: dispatchTheme.highlight,
    borderRadius: radius.pill,
    color: dispatchTheme.textOnHighlight,
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
    borderRadius: radius.lg,
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
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    backgroundColor: dispatchTheme.accentTint,
    borderRadius: radius.lg,
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
    backgroundColor: dispatchTheme.surfaceMuted,
    borderRadius: radius.lg,
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
  emptyText: {
    color: dispatchTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: dispatchTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginVertical: 8,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.text,
    borderRadius: radius.lg,
    marginTop: 10,
    paddingVertical: 15,
  },
  signOutButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '900',
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: dispatchTheme.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 15,
  },
  deleteButtonText: {
    color: dispatchTheme.dangerText,
    fontSize: 15,
    fontWeight: '900',
  },
});

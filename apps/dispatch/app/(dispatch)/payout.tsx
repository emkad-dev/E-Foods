import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import { BusyLabel } from '../../../../packages/design-system/src/primitives/BusyLabel';
import { toUserMessage } from '../../../../packages/observability/src/userMessage';
// The partner app's bank list, shared by path rather than copied: the codes are
// never trusted (riderSubmitPayoutBank resolves the account with Paystack
// server-side before storing anything), so one list to maintain is enough.
import {
  filterNigeriaBanks,
  isPlausibleNubanAccountNumber,
  type NigeriaBank,
} from '../../../partner/src/domain/nigeriaBanks';
import {
  getRiderPayoutProfile,
  submitRiderPayoutBank,
  type RiderPayoutProfile,
} from '../../src/services/riderPayouts';
import { dispatchTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

const formatMoney = (amount: number) => `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const formatDate = (value: string | null) => {
  if (!value) {
    return '';
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
        new Date(parsed)
      )
    : '';
};

/** A hold still in force: a future timestamp, or an open-ended ('infinity') one. */
const describeActiveHold = (holdUntil: string | null, holdReason: string | null) => {
  if (!holdUntil) {
    return null;
  }
  const parsed = Date.parse(holdUntil);
  if (Number.isFinite(parsed) && parsed <= Date.now()) {
    return null;
  }
  if (holdReason === 'bank_details_changed' && Number.isFinite(parsed)) {
    return `Payouts are paused until ${formatDate(holdUntil)} because your bank details changed. This protects you if someone else changed them.`;
  }
  return 'Payouts are paused because a transfer to this account failed. Re-submit the same account to confirm it, or add a different one.';
};

export default function RiderPayoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<RiderPayoutProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bank, setBank] = useState<NigeriaBank | null>(null);
  const [bankQuery, setBankQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const banks = useMemo(() => filterNigeriaBanks(bankQuery), [bankQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setProfile(await getRiderPayoutProfile());
    } catch (error) {
      setLoadError(toUserMessage(error, 'Could not load your payout details. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = Boolean(bank) && isPlausibleNubanAccountNumber(accountNumber) && !submitting;

  const handleSubmit = async () => {
    if (!bank || !canSubmit) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const result = await submitRiderPayoutBank({
        accountNumber: accountNumber.trim(),
        bankCode: bank.code,
        bankName: bank.name,
      });
      setProfile((current) => (current ? { ...current, recipient: result.recipient } : current));
      setAccountNumber('');
      setSubmitSuccess(`Verified: ${result.recipient.accountName}, ${result.recipient.accountNumberMasked}.`);
    } catch (error) {
      setSubmitError(toUserMessage(error, 'We could not verify that bank account. Check the details and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const recipient = profile?.recipient ?? null;
  const holdMessage = recipient ? describeActiveHold(recipient.holdUntil, recipient.holdReason) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET, paddingBottom: insets.bottom + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity accessibilityRole="button" style={styles.backRow} onPress={() => router.back()}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Payout bank account</Text>

      {loading ? (
        <ActivityIndicator color={dispatchTheme.accent} style={styles.loader} />
      ) : loadError ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void load()}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : profile && !profile.isPlatformRider ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paid by your restaurant</Text>
          <Text style={styles.copy}>
            You deliver for a restaurant&apos;s own fleet, so the restaurant pays you directly. FEASTY payouts are only for
            FEASTY platform riders.
          </Text>
        </View>
      ) : profile ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How payouts work</Text>
            <Text style={styles.copy}>
              Payouts are automatic. Once your bank account is verified, your delivery earnings are sent to it - you do
              not need to request them. A payout is sent once your unpaid balance reaches{' '}
              {formatMoney(profile.minimumPayout)}.
            </Text>
            <View style={styles.totalsRow}>
              <Total label="Unpaid" value={formatMoney(profile.totals.pending)} />
              <Total label="On the way" value={formatMoney(profile.totals.processing)} />
              <Total label="Paid" value={formatMoney(profile.totals.paid)} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current account</Text>
            {recipient ? (
              <>
                <Text style={styles.accountName}>{recipient.accountName}</Text>
                <Text style={styles.copy}>
                  {recipient.bankName ?? recipient.bankCode} · {recipient.accountNumberMasked}
                </Text>
                <Text style={styles.metaText}>
                  {recipient.verifiedAt ? `Verified ${formatDate(recipient.verifiedAt)}` : 'Not verified yet'}
                </Text>
                {holdMessage ? <Text style={styles.warningText}>{holdMessage}</Text> : null}
              </>
            ) : (
              <Text style={styles.copy}>No payout account yet. Add one below so your earnings can be paid.</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{recipient ? 'Change account' : 'Add account'}</Text>
            {recipient ? (
              <Text style={styles.metaText}>
                Changing to a different account pauses payouts for 24 hours, as a safety check.
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Bank</Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.input}
              onPress={() => setPickerOpen((open) => !open)}
            >
              <Text style={bank ? styles.inputText : styles.placeholderText}>{bank?.name ?? 'Choose your bank'}</Text>
            </TouchableOpacity>
            {pickerOpen ? (
              <View style={styles.picker}>
                <TextInput
                  accessibilityLabel="Search banks"
                  autoCorrect={false}
                  onChangeText={setBankQuery}
                  placeholder="Search banks"
                  placeholderTextColor={dispatchTheme.textMuted}
                  style={styles.input}
                  value={bankQuery}
                />
                {banks.map((option) => (
                  <TouchableOpacity
                    key={option.code}
                    style={styles.pickerRow}
                    onPress={() => {
                      setBank(option);
                      setPickerOpen(false);
                      setBankQuery('');
                    }}
                  >
                    <Text style={styles.inputText}>{option.name}</Text>
                  </TouchableOpacity>
                ))}
                {banks.length === 0 ? <Text style={styles.metaText}>No bank matches that search.</Text> : null}
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Account number</Text>
            <TextInput
              accessibilityLabel="Account number"
              keyboardType="number-pad"
              maxLength={10}
              onChangeText={(value) => setAccountNumber(value.replace(/\D/g, ''))}
              placeholder="10-digit NUBAN"
              placeholderTextColor={dispatchTheme.textMuted}
              style={styles.input}
              value={accountNumber}
            />
            <Text style={styles.metaText}>The account must be in your name. We check it with your bank before saving.</Text>

            {submitError ? (
              <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
                {submitError}
              </Text>
            ) : null}
            {submitSuccess ? <Text style={styles.successText}>{submitSuccess}</Text> : null}

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, !canSubmit ? styles.buttonDisabled : null]}
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              <BusyLabel busy={submitting} label="Verify and save" busyLabel="Verifying..." textStyle={styles.primaryButtonText} />
            </TouchableOpacity>
          </View>

          {profile.payouts.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent payouts</Text>
              {profile.payouts.map((payout) => (
                <View key={payout.id} style={styles.payoutRow}>
                  <Text style={styles.inputText}>{formatMoney(payout.amount)}</Text>
                  <Text style={styles.metaText}>
                    {payout.status} · {formatDate(payout.paidAt ?? payout.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.metaText}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: dispatchTheme.background, flex: 1 },
  content: { padding: 18 },
  backRow: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: MIN_TAP_TARGET },
  backText: { color: dispatchTheme.accentStrong, fontSize: 15, fontWeight: '800' },
  title: { color: dispatchTheme.text, fontSize: SCREEN_TITLE_SIZE, fontWeight: SCREEN_TITLE_WEIGHT, marginBottom: 6 },
  loader: { marginTop: 32 },
  card: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  cardTitle: { color: dispatchTheme.text, fontSize: 17, fontWeight: '900', marginBottom: 8 },
  copy: { color: dispatchTheme.textMuted, fontSize: 14, lineHeight: 21 },
  accountName: { color: dispatchTheme.text, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  metaText: { color: dispatchTheme.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  warningText: { color: dispatchTheme.warningText, fontSize: 13, lineHeight: 19, marginTop: 10 },
  errorText: { color: dispatchTheme.dangerText, fontSize: 14, lineHeight: 20, marginTop: 10 },
  successText: { color: dispatchTheme.success, fontSize: 14, lineHeight: 20, marginTop: 10 },
  totalsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  total: { flex: 1 },
  totalValue: { color: dispatchTheme.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  fieldLabel: { color: dispatchTheme.text, fontSize: 13, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: dispatchTheme.surfaceMuted,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 14,
  },
  inputText: { color: dispatchTheme.text, fontSize: 15 },
  placeholderText: { color: dispatchTheme.textMuted, fontSize: 15 },
  picker: { gap: 4, marginTop: 8 },
  pickerRow: { justifyContent: 'center', minHeight: MIN_TAP_TARGET, paddingHorizontal: 6 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: MIN_TAP_TARGET,
  },
  primaryButtonText: { color: dispatchTheme.textOnAccent, fontSize: 15, fontWeight: '900' },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: {
    alignItems: 'center',
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
  },
  secondaryButtonText: { color: dispatchTheme.text, fontSize: 15, fontWeight: '800' },
  payoutRow: { borderTopColor: dispatchTheme.border, borderTopWidth: 1, paddingVertical: 10 },
});

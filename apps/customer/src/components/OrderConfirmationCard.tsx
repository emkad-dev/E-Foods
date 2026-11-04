import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BusyLabel, MIN_TAP_TARGET, radius } from '@feasty/design-system';
import {
  CONFIRM_LABELS,
  MAX_PROBLEM_LENGTH,
  formatAutoCloseNotice,
  getConfirmationPhase,
  validateProblemMessage,
  type ConfirmationOrderFields,
} from '../domain/orderConfirmation';
import { confirmCustomerOrderReceived, reportCustomerOrderProblem } from '../services/customerOrderActions';
import { customerTheme } from '../theme/palette';
import { toUserMessage } from '../../../../packages/observability/src/userMessage';

type OrderConfirmationCardProps = {
  order: ConfirmationOrderFields & { fulfillmentType?: 'delivery' | 'pickup' | null; id: string };
  /** Pulls the fresh order snapshot after an action lands. */
  onChanged: () => void | Promise<void>;
};

/**
 * Closes the loop after the restaurant marks an order delivered or collected.
 * Renders nothing for orders outside the flow, so the order screen can mount it
 * unconditionally.
 *
 * Inline form and notices, never `Alert` or a native prompt: both are silent on
 * the web build.
 */
export default function OrderConfirmationCard({ order, onChanged }: OrderConfirmationCardProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What this device has just been told by the server. Layered over the order
  // prop so the card moves on the moment the call succeeds, instead of waiting
  // for the reload (which can lag, or fail, when the live channel is down).
  const [patch, setPatch] = useState<Partial<ConfirmationOrderFields>>({});

  const phase = getConfirmationPhase({ ...order, ...patch });
  if (phase === 'none') {
    return null;
  }

  const isPickup = order.fulfillmentType === 'pickup';
  const busy = confirming || sending;
  const closesNotice = formatAutoCloseNotice(order.customerConfirmDueAt);

  const openSupport = () => router.push('/support' as never);

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      const result = await confirmCustomerOrderReceived(order.id);
      setPatch((current) => ({
        ...current,
        customerConfirmationSource: result.customerConfirmationSource ?? 'customer',
        customerConfirmedAt: result.customerConfirmedAt ?? new Date().toISOString(),
      }));
      setFormOpen(false);
      void onChanged();
    } catch (nextError) {
      setError(toUserMessage(nextError, 'We could not confirm this order right now.'));
    } finally {
      setConfirming(false);
    }
  };

  const handleSendReport = async () => {
    if (busy) {
      return;
    }
    const checked = validateProblemMessage(draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setSending(true);
    try {
      const result = await reportCustomerOrderProblem(order.id, checked.message);
      setPatch((current) => ({
        ...current,
        customerIssueReportedAt: result.customerIssueReportedAt,
      }));
      setFormOpen(false);
      setDraft('');
      void onChanged();
    } catch (nextError) {
      setError(toUserMessage(nextError, 'We could not send your report right now.'));
    } finally {
      setSending(false);
    }
  };

  if (phase === 'confirmed') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Thanks, order closed</Text>
      </View>
    );
  }

  if (phase === 'auto_closed') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Closed automatically</Text>
        <Text style={styles.copy}>Problem? Contact support.</Text>
        <TouchableOpacity accessibilityRole="link" style={styles.linkButton} onPress={openSupport}>
          <Text style={styles.linkText}>Contact support</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const reported = phase === 'reported';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{reported ? "We're looking into this" : 'Is your order complete?'}</Text>
      <Text style={styles.copy}>
        {reported
          ? "We've passed your report to FEASTY support. If it turns out fine, you can still close this order."
          : isPickup
            ? 'The restaurant marked this order as collected.'
            : 'The restaurant marked this order as delivered.'}
      </Text>
      {/* No deadline once reported: reporting stops the auto-close timer. */}
      {!reported && closesNotice ? <Text style={styles.deadline}>{closesNotice}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.primaryButton, busy ? styles.buttonDisabled : null]}
        disabled={busy}
        onPress={handleConfirm}
      >
        <BusyLabel
          busy={confirming}
          label={CONFIRM_LABELS[isPickup ? 'pickup' : 'delivery']}
          busyLabel="Confirming..."
          textStyle={styles.primaryButtonText}
        />
      </TouchableOpacity>

      {reported ? (
        <TouchableOpacity accessibilityRole="link" style={styles.linkButton} onPress={openSupport}>
          <Text style={styles.linkText}>Contact support</Text>
        </TouchableOpacity>
      ) : formOpen ? (
        <View style={styles.form}>
          <Text style={styles.formLabel}>What went wrong?</Text>
          <TextInput
            accessibilityLabel="Describe the problem"
            editable={!sending}
            maxLength={MAX_PROBLEM_LENGTH}
            multiline
            onChangeText={setDraft}
            placeholder="Tell us what happened"
            placeholderTextColor={customerTheme.textSoft}
            style={styles.input}
            textAlignVertical="top"
            value={draft}
          />
          <Text style={styles.counter}>
            {draft.length}/{MAX_PROBLEM_LENGTH}
          </Text>
          <View style={styles.formActions}>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.secondaryButton, styles.formAction, busy ? styles.buttonDisabled : null]}
              disabled={busy}
              onPress={() => {
                setFormOpen(false);
                setError(null);
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.primaryButton,
                styles.formAction,
                !draft.trim() || busy ? styles.buttonDisabled : null,
              ]}
              disabled={!draft.trim() || busy}
              onPress={handleSendReport}
            >
              <BusyLabel busy={sending} label="Send report" busyLabel="Sending..." textStyle={styles.primaryButtonText} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.secondaryButton, busy ? styles.buttonDisabled : null]}
          disabled={busy}
          onPress={() => {
            setError(null);
            setFormOpen(true);
          }}
        >
          <Text style={styles.secondaryButtonText}>Report a problem</Text>
        </TouchableOpacity>
      )}

      {error ? (
        <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: customerTheme.accentTint,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  title: {
    color: customerTheme.text,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  deadline: {
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accentStrong,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: customerTheme.textOnBrand,
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  linkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    minHeight: MIN_TAP_TARGET,
  },
  linkText: {
    color: customerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  form: {
    marginTop: 12,
  },
  formLabel: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 14,
    marginTop: 8,
    minHeight: 96,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  counter: {
    color: customerTheme.textMuted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'right',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
  },
  formAction: {
    flex: 1,
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
});

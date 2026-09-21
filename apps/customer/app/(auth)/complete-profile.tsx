import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { PhoneInput } from '../../../../packages/auth/src/components/PhoneInput';
import { screenColumn } from '../../src/components/ScreenColumn';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  describePhoneForConfirmation,
  type PhoneConfirmation,
} from '../../src/domain/authFormValidation';
import { customerTheme } from '../../src/theme/palette';

/**
 * The last thing standing between a new customer and the app: the number
 * riders and support dial. Email sign-ups now arrive with one already (it is
 * carried from the sign-up form into the profile row), so in practice this
 * screen is the catch-all for an account whose profile row has no usable
 * number -- one created before that carry-through existed, or one whose
 * stored number would not normalise.
 *
 * FORMAT-CHECKED AND READ BACK, NOT SMS-VERIFIED, and deliberately so.
 *
 * This screen used to demand a 6-digit code over SMS/WhatsApp through
 * auth-gateway -> Termii. That path is complete and still wired up on the
 * server, but Termii sender approval is pending, so it has never worked: at
 * the time of writing `phone_otps` has ZERO rows in production and no account
 * has a `phoneVerifiedAt`. Putting anyone in front of it would have meant the
 * only way into the app for them was a code that cannot be sent.
 *
 * So this matches what the rest of the codebase already does: partner and
 * dispatch registration both collect a phone with this same `PhoneInput`, and
 * the customer profile editor saves the field with no code at all -- which is
 * also why this screen was never a verification boundary in the first place.
 * `validatePhoneNumber`'s own docstring records the same decision.
 *
 * What replaces the code is a cross-check: the number is read back in both the
 * form its owner recognises and the form that will be stored, and it takes a
 * deliberate "yes, that's my number" to save. Nothing proves the line belongs
 * to them; this only catches the transposed digit, which is the failure that
 * actually happens -- and it catches it now rather than when a rider is
 * outside with the food.
 *
 * TO RESTORE SMS VERIFICATION once Termii approves the sender: swap
 * `PhoneInput` back for `PhoneVerification` from the same package, pass it
 * `requestPhoneCode`/`verifyPhoneCode` from src/services/phoneVerification.ts,
 * and drop `updatePhoneNumber` from `handleSave` -- the gateway writes the
 * number and the `phoneVerifiedAt` timestamp itself on a successful verify.
 * Nothing server-side needs changing; it is this file only.
 */
export default function CompleteProfileScreen() {
  const { error, loading, policyAccepted, updatePhoneNumber, user } = useAuth();
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The cross-check step. With no SMS round-trip, reading the number back is
  // the only thing standing between a transposed digit and a rider who cannot
  // reach anybody — so it is a step of its own, not a line of small print
  // under a button people are already pressing.
  const [confirming, setConfirming] = useState<PhoneConfirmation | null>(null);

  // One error surface, same as every other auth screen: the context's error
  // and this screen's own share a slot. `Alert` is an empty function on the
  // web build, so a message that does not render here does not exist.
  const displayError = saveError ?? error;

  const handleContinue = () => {
    if (!phoneE164) {
      // PhoneInput shows its own message for a malformed number; this covers
      // pressing the button with the field still empty.
      setSaveError('Add the phone number you want riders and support to use.');
      return;
    }

    const confirmation = describePhoneForConfirmation(phoneE164);

    if (!confirmation) {
      setSaveError('Add the phone number you want riders and support to use.');
      return;
    }

    setSaveError(null);
    setConfirming(confirmation);
  };

  const handleSave = async () => {
    if (!phoneE164) {
      setSaveError('Add the phone number you want riders and support to use.');
      return;
    }

    setSaveError(null);
    setSaving(true);

    try {
      // The E.164 form, never the typed spacing -- the rule the profile editor
      // and the sign-up form both follow.
      await updatePhoneNumber(phoneE164);
    } catch {
      // `updatePhoneNumber` put the message in the context's `error`, which
      // the slot above renders. Back to the field, not stuck on a confirmation
      // for a number that did not save -- the guard would only send them here
      // again anyway.
      setSaving(false);
      setConfirming(null);
      return;
    }

    setSaving(false);
    // Leaving this screen IS the confirmation. A banner would be unmounted by
    // the next line, and the `Alert` that used to sit here rendered nothing at
    // all on app.feasty.com.ng.
    router.replace((policyAccepted ? '/home' : '/accept-policy') as never);
  };

  const busy = saving || loading;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, screenColumn.reading]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>FEASTY Customer</Text>
          <Text style={styles.title}>
            {confirming ? 'Is this your number?' : 'Add your phone number'}
          </Text>
          <Text style={styles.copy}>
            {confirming
              ? 'Check every digit. This is the number the rider calls when they reach you, and we do not send a code to confirm it.'
              : 'We use this for order updates and rider contact. It is the number we give the rider bringing your food.'}
          </Text>

          {displayError ? (
            <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
              {displayError}
            </Text>
          ) : null}

          {confirming ? (
            <>
              <View style={styles.confirmBlock}>
                <Text style={styles.confirmNumber}>{confirming.readable}</Text>
                <Text style={styles.confirmE164}>Saved as {confirming.e164}</Text>
              </View>

              <TouchableOpacity
                style={[styles.saveButton, busy ? styles.saveButtonDisabled : null]}
                onPress={handleSave}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.saveButtonText}>
                  {saving ? 'Saving...' : "Yes, that's my number"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setSaveError(null);
                  setConfirming(null);
                }}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Change it</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.verifyBlock}>
                <PhoneInput
                  theme={customerTheme}
                  editable={!busy}
                  // `phoneE164` first: this component is unmounted while the
                  // confirmation is up, so coming back from "Change it" -- or
                  // from a save that failed -- would otherwise hand back an
                  // empty field and make them type the number again.
                  initialValue={
                    phoneE164 ?? (typeof user?.phoneNumber === 'string' ? user.phoneNumber : undefined)
                  }
                  onChange={({ e164 }) => {
                    setSaveError(null);
                    setPhoneE164(e164);
                  }}
                />
              </View>

              <TouchableOpacity
                style={[styles.saveButton, busy ? styles.saveButtonDisabled : null]}
                onPress={handleContinue}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.saveButtonText}>Continue</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: 20,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    color: customerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: customerTheme.dangerText,
    fontSize: 13,
    marginTop: 12,
  },
  verifyBlock: {
    marginTop: 16,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 16,
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: customerTheme.link,
    fontSize: 15,
    fontWeight: '700',
  },
  confirmBlock: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  confirmNumber: {
    color: customerTheme.text,
    // Big and loosely tracked on purpose: this line exists to be proofread
    // digit by digit, not skimmed.
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  confirmE164: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginTop: 6,
  },
});

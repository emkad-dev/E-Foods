/**
 * "Joining a restaurant?" -- the code-first join screen, reached from the
 * LOGIN page by somebody who may have no FEASTY account at all.
 *
 * WHAT THIS REPLACED, because the shape of this screen is a direct answer to
 * it. An invitee used to have to: register (proving their mailbox with an
 * email OTP), land in the restaurant-onboarding wizard -- business KYC, payout
 * account, admin approval, none of which applies to a line cook -- spot a
 * secondary link at the bottom, and only then type their code. Two proofs of
 * the same mailbox to join one store, with a wizard in between that was never
 * addressed to them.
 *
 * And it excluded people outright. The first real address we invited was a
 * Google account with no password, so "sign in" was not merely inconvenient
 * for that person, it was impossible: there was nothing to type.
 *
 * SO THE CODE COMES FIRST AND THE SERVER PICKS THE ROUTE. Step one asks for an
 * email and a code, and nothing else. `staffInviteResolve` answers `password`,
 * `google` or `create`, and step two is whichever of those it said.
 *
 * THE SCREEN MUST NOT GUESS. Every failure -- unknown address, no invite,
 * expired, wrong code, five attempts spent -- comes back as one identical 400,
 * because an endpoint that distinguished them would tell an unauthenticated
 * caller which addresses have live invites. So the rejection is rendered
 * verbatim and nothing here tries to be more helpful about which case it was.
 *
 * WHY IT LIVES IN `(auth)` AND WHAT THAT COSTS. It belongs beside login
 * because its audience is signed out. But this group's layout redirects any
 * signed-in user straight out of it, and the `password` and `create` branches
 * sign the person in THEMSELVES and still have work to do afterwards. That is
 * what `staffJoinHandoff` is for: the screen holds the group open across its
 * own sign-in and releases it when the flow is finished or has failed. See
 * src/state/staffJoinHandoff.ts.
 */
import { useEffect, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useNotice } from '@feasty/design-system';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  STAFF_INVITE_CODE_LENGTH,
  STAFF_JOIN_MIN_PASSWORD_LENGTH,
  STAFF_JOIN_UNKNOWN_BRANCH_MESSAGE,
  describeStaffJoinBranch,
  normaliseStaffInviteCode,
  normaliseStaffJoinDisplayName,
  resolveStaffJoinStep,
  validateStaffInviteCode,
  validateStaffJoinEmail,
  validateStaffJoinNewPassword,
  validateStaffJoinSignInPassword,
  type StaffJoinStep,
} from '../../src/domain/staffInvites';
import {
  createStaffInviteAccount,
  redeemStaffInvite,
  resolveStaffInvite,
} from '../../src/services/partnerStaff';
import { supabase } from '../../src/services/supabase/config';
import {
  awaitGoogleStaffJoin,
  holdAuthGroupForStaffJoin,
  releaseStaffJoin,
} from '../../src/state/staffJoinHandoff';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

/**
 * The two ways this flow can stop half-finished, each of which leaves the
 * person in a genuinely different position and must not be described by one
 * generic "something went wrong".
 *
 * `signed-in-not-joined`: the sign-in worked, the redeem did not. They have a
 * working login and no restaurant. The repair is to enter the code again, on
 * the authenticated screen.
 *
 * `account-created-not-signed-in`: the account exists AND is already attached
 * to the restaurant -- `staffInviteCreateAccount` does both -- and only the
 * sign-in that followed failed. The repair is to sign in normally. Getting
 * this message wrong is expensive: somebody who thinks the whole thing failed
 * will try again and be told the address already has an account, which reads
 * like a dead end.
 */
type StalledJoin = {
  kind: 'signed-in-not-joined' | 'account-created-not-signed-in';
  message: string;
};

type ResolvedInvite = {
  branch: string;
  /** The server's normalised address, not the one that was typed. */
  email: string;
  restaurantName: string;
};

export default function StaffJoinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  // Inline: this is one card the person is already looking at, with no list to
  // scroll a floating notice away from. `Alert` is not an option at all -- it
  // is an empty function on react-native-web, and partner ships to
  // partner.feasty.com.ng.
  const { notice, showNotice } = useNotice({ placement: 'inline' });

  const [step, setStep] = useState<StaffJoinStep>('identify');
  const [resolved, setResolved] = useState<ResolvedInvite | null>(null);
  const [stalled, setStalled] = useState<StalledJoin | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');

  /**
   * Release the hold if this screen goes away for any reason at all -- a back
   * gesture, a deep link, a hot reload. A hold that outlives its screen would
   * leave a signed-in partner parked in the auth group with no way out, which
   * is a worse failure than any this flow is trying to prevent.
   */
  useEffect(() => releaseStaffJoin, []);

  const branchCopy = describeStaffJoinBranch({
    branch: resolved?.branch,
    restaurantName: resolved?.restaurantName,
  });
  const restaurantName = resolved?.restaurantName?.trim() || 'this restaurant';

  const handleResolve = async () => {
    if (busy) {
      return;
    }

    const nextEmailError = validateStaffJoinEmail(email);
    const nextCodeError = validateStaffInviteCode(code);

    setEmailError(nextEmailError);
    setCodeError(nextCodeError);

    if (nextEmailError || nextCodeError) {
      return;
    }

    setBusy(true);

    try {
      const result = await resolveStaffInvite(email, code);
      const nextStep = resolveStaffJoinStep(result.branch);

      if (!nextStep) {
        // A branch this build does not know. Every default would be a lie --
        // asking a Google user for a password, or offering to create a second
        // account for an address that has one -- so say so instead.
        showNotice({ tone: 'error', title: 'We cannot finish here', message: STAFF_JOIN_UNKNOWN_BRANCH_MESSAGE });
        return;
      }

      setResolved({ branch: result.branch, email: result.email, restaurantName: result.restaurantName });
      setStep(nextStep);
    } catch (error: any) {
      // VERBATIM. See the header: the server returns one message for wrong,
      // expired, unknown and exhausted, and any attempt to be more specific
      // here re-creates the oracle it was written to avoid.
      showNotice({
        tone: 'error',
        title: 'That did not work',
        message: error?.message ?? 'Unable to check that code right now.',
      });
    } finally {
      setBusy(false);
    }
  };

  /** `password` branch: sign in with the account they already have, then redeem. */
  const handleSignInAndJoin = async () => {
    if (busy || !resolved) {
      return;
    }

    const nextPasswordError = validateStaffJoinSignInPassword(password);
    setPasswordError(nextPasswordError);

    if (nextPasswordError) {
      return;
    }

    setBusy(true);
    // Before `signIn`, not after: the layout re-renders the moment a session
    // exists, and by then it is too late to ask it to stay.
    holdAuthGroupForStaffJoin();

    try {
      await signIn(resolved.email, password);
    } catch (error: any) {
      // Still signed out, so nothing is holding the group open for -- and the
      // notice below survives because the screen does.
      releaseStaffJoin();
      setBusy(false);
      showNotice({
        tone: 'error',
        title: 'We could not sign you in',
        message: error?.message ?? 'Check the password and try again.',
      });
      return;
    }

    try {
      await redeemStaffInvite(code);
      // The role changed server-side, so this session's cached profile still
      // says `customer` and the partner layout would bounce them into the
      // applicant wizard. Awaited BEFORE the success card appears, so its
      // button cannot be pressed while that is still true.
      await supabase.auth.refreshSession().catch(() => undefined);
      setStep('joined');
    } catch (error: any) {
      // Signed in, not joined. The hold STAYS: releasing it hands the layout a
      // signed-in user and it redirects, destroying the only explanation this
      // person is going to get.
      setStalled({
        kind: 'signed-in-not-joined',
        message: error?.message ?? 'Unable to use that code right now.',
      });
    } finally {
      setBusy(false);
    }
  };

  /** `create` branch: make the account (already attached server-side), then sign in. */
  const handleCreateAndJoin = async () => {
    if (busy || !resolved) {
      return;
    }

    const nextPasswordError = validateStaffJoinNewPassword(password);
    setPasswordError(nextPasswordError);

    if (nextPasswordError) {
      return;
    }

    setBusy(true);

    try {
      await createStaffInviteAccount({
        code,
        displayName: normaliseStaffJoinDisplayName(displayName),
        email: resolved.email,
        password,
      });
    } catch (error: any) {
      setBusy(false);
      // Includes the 409 for an address that turns out to already have an
      // account. Deliberately NOT retried as a sign-in: that endpoint refuses
      // rather than updates precisely so it cannot be used to take an account
      // over, and a client that quietly worked around the refusal would be
      // undoing that. Step one re-resolves and the server picks again.
      showNotice({
        tone: 'error',
        title: 'We could not create your account',
        message: error?.message ?? 'Unable to create your account right now.',
      });
      return;
    }

    holdAuthGroupForStaffJoin();

    try {
      // No redeem on this branch: `staffInviteCreateAccount` already claimed
      // the invite and attached the restaurant. Redeeming again would be a
      // second claim on a code that is now `accepted`, i.e. a guaranteed
      // failure reported to somebody who has in fact succeeded.
      await signIn(resolved.email, password);
      setStep('joined');
    } catch (error: any) {
      releaseStaffJoin();
      setStalled({
        kind: 'account-created-not-signed-in',
        message: error?.message ?? 'Unable to sign in right now.',
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * `google` branch. This screen does not own a Google button and must not
   * grow one: sign-in is the auth context's job and the login screen's
   * surface. All this does is record that a redemption is still owed and put
   * the person in front of it.
   */
  const handleGoToGoogle = () => {
    awaitGoogleStaffJoin();
    router.replace('/(auth)/login' as never);
  };

  const handleOpenDashboard = () => {
    releaseStaffJoin();
    // The layout's own signed-in redirect would also fire once the hold is
    // released. Navigating explicitly as well costs nothing (both land on the
    // same route) and means the button is never dependent on a redirect that
    // happens to be rendered somewhere else.
    router.replace('/(partner)' as never);
  };

  const handleFinishOnJoinScreen = () => {
    releaseStaffJoin();
    router.replace('/(partner)/join-restaurant' as never);
  };

  const handleStartOver = () => {
    // The email and code are kept: the overwhelmingly likely reason to come
    // back is that the address was wrong, and a correct code costs nothing to
    // re-resolve -- only a WRONG one spends one of the five attempts.
    setStep('identify');
    setResolved(null);
    setPassword('');
    setPasswordError(null);
    setDisplayName('');
  };

  const renderBusyLabel = (label: string) =>
    busy ? (
      <ActivityIndicator color={partnerTheme.textOnBrand} size="small" />
    ) : (
      <Text style={styles.primaryButtonText}>{label}</Text>
    );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>
          {step === 'joined' ? 'You are in' : stalled ? 'Nearly there' : 'Join a restaurant'}
        </Text>
        <Text style={styles.copy}>
          {step === 'identify'
            ? `Enter the email your invite was sent to and the ${STAFF_INVITE_CODE_LENGTH}-digit code from it. We will work out the rest.`
            : step === 'joined'
              ? `Your account now has access to ${restaurantName}.`
              : `Joining ${restaurantName}.`}
        </Text>
      </View>

      {stalled ? (
        <View style={styles.card}>
          {/* The server's sentence, then what it means for this person, then
              the one control that repairs it. Kept as screen state rather than
              a notice: a notice dies with the screen, and this is the only
              explanation they get for being signed in without a store. */}
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
            {stalled.message}
          </Text>
          {stalled.kind === 'signed-in-not-joined' ? (
            <>
              <Text style={styles.cardLine}>
                You are signed in, but the code did not go through, so you are not on {restaurantName}&rsquo;s team
                yet. Your login works either way.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={handleFinishOnJoinScreen}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Enter the code again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.cardLine}>
                Your account was created and {restaurantName} was added to it &mdash; only signing you in failed. Sign
                in with the password you just chose; do not create another account.
              </Text>
              <Link href="/(auth)/login" asChild>
                <Pressable accessibilityRole="button" style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Go to sign in</Text>
                </Pressable>
              </Link>
            </>
          )}
        </View>
      ) : step === 'identify' ? (
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput
            accessibilityLabel="The email address your invite was sent to"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!busy}
            inputMode="email"
            keyboardType="email-address"
            onChangeText={(next) => {
              setEmail(next);
              if (emailError) {
                setEmailError(null);
              }
            }}
            placeholder="you@example.com"
            placeholderTextColor={partnerTheme.textSoft}
            style={[styles.input, emailError ? styles.inputError : null]}
            value={email}
          />
          {emailError ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldError}>
              {emailError}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>Invite code</Text>
          <TextInput
            accessibilityLabel="Invite code"
            autoComplete="one-time-code"
            autoCorrect={false}
            editable={!busy}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={STAFF_INVITE_CODE_LENGTH}
            onChangeText={(next) => {
              // Normalised on every keystroke. The code is read off one screen
              // and typed into another, or pasted out of an email with a
              // trailing newline; a field that silently refuses those looks
              // broken, and there are only five attempts before it dies.
              setCode(normaliseStaffInviteCode(next));
              if (codeError) {
                setCodeError(null);
              }
            }}
            onSubmitEditing={() => void handleResolve()}
            placeholder="000000"
            placeholderTextColor={partnerTheme.textSoft}
            returnKeyType="done"
            style={[styles.codeInput, codeError ? styles.inputError : null]}
            textContentType="oneTimeCode"
            value={code}
          />
          {codeError ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldError}>
              {codeError}
            </Text>
          ) : null}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => void handleResolve()}
            style={[styles.primaryButton, busy ? styles.controlDisabled : null]}
          >
            {renderBusyLabel('Continue')}
          </TouchableOpacity>

          {notice}

          <Text style={styles.hint}>
            The code has to match the address it was emailed to. No code? Ask the restaurant to send one &mdash; a new
            code replaces the old.
          </Text>
        </View>
      ) : step === 'joined' ? (
        <View style={styles.card}>
          <Text accessibilityLiveRegion="polite" role="status" style={styles.cardLine}>
            You can take orders, update the menu and change the store settings. What you cannot do is see or change
            anyone else&rsquo;s login &mdash; and nobody at {restaurantName} can see yours.
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={handleOpenDashboard} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open the dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          {/* One card for all three branches: the copy is the branch. */}
          <Text style={styles.branchTitle}>{branchCopy?.title ?? `Joining ${restaurantName}`}</Text>
          {(branchCopy?.body ?? []).map((line) => (
            <Text key={line} style={styles.cardLine}>
              {line}
            </Text>
          ))}
          {resolved?.email ? (
            <Text style={styles.cardLine}>
              Address: <Text style={styles.cardLineStrong}>{resolved.email}</Text>
            </Text>
          ) : null}

          {step === 'google' ? (
            <TouchableOpacity accessibilityRole="button" onPress={handleGoToGoogle} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{branchCopy?.action ?? 'Go to sign in'}</Text>
            </TouchableOpacity>
          ) : (
            <>
              {step === 'create' ? (
                <>
                  <Text style={styles.fieldLabel}>Your name (optional)</Text>
                  <TextInput
                    accessibilityLabel="Your name, optional"
                    autoCapitalize="words"
                    autoComplete="name"
                    editable={!busy}
                    maxLength={80}
                    onChangeText={setDisplayName}
                    placeholder="What your team calls you"
                    placeholderTextColor={partnerTheme.textSoft}
                    style={styles.input}
                    value={displayName}
                  />
                </>
              ) : null}

              <Text style={styles.fieldLabel}>{step === 'create' ? 'Choose a password' : 'Password'}</Text>
              {/* The same field as the login screen, so the visibility toggle
                  behaves identically in both places. */}
              <AuthPasswordField
                editable={!busy}
                onChangeText={(next) => {
                  setPassword(next);
                  if (passwordError) {
                    setPasswordError(null);
                  }
                }}
                placeholder={step === 'create' ? 'New password' : 'Your FEASTY password'}
                value={password}
              />
              {step === 'create' ? (
                <Text style={styles.hint}>At least {STAFF_JOIN_MIN_PASSWORD_LENGTH} characters.</Text>
              ) : null}
              {passwordError ? (
                <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldError}>
                  {passwordError}
                </Text>
              ) : null}

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => void (step === 'create' ? handleCreateAndJoin() : handleSignInAndJoin())}
                style={[styles.primaryButton, busy ? styles.controlDisabled : null]}
              >
                {renderBusyLabel(branchCopy?.action ?? 'Continue')}
              </TouchableOpacity>
            </>
          )}

          {notice}

          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy}
            onPress={handleStartOver}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Use a different email or code</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* `asChild` so the link is a real box. A bare <Link> renders as Text,
          which react-native-web gives `display: inline` -- and CSS ignores
          min-height on an inline box, so the obvious fix does nothing. */}
      {step === 'joined' || stalled ? null : (
        <Link href="/(auth)/login" asChild>
          <Pressable accessibilityRole="button" style={styles.linkPressable}>
            <Text style={styles.linkSecondary}>Back to sign in</Text>
          </Pressable>
        </Link>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    maxWidth: 560,
    paddingHorizontal: 20,
    width: '100%',
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: radius['2xl'],
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: partnerTheme.textOnHero,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  copy: {
    color: partnerTheme.textOnHeroMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  branchTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },
  cardLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  cardLineStrong: {
    color: partnerTheme.text,
    fontWeight: '800',
  },
  fieldLabel: {
    color: partnerTheme.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 14,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    marginTop: 8,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  codeInput: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 8,
    marginTop: 8,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    textAlign: 'center',
  },
  // `dangerText`, not `danger`: the red in this palette is a FILL and fails AA
  // as ink on every light surface in the app.
  inputError: {
    borderColor: partnerTheme.dangerText,
  },
  fieldError: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: 10,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.xl,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '900',
  },
  controlDisabled: {
    opacity: 0.5,
  },
  hint: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '900',
  },
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
  },
  linkSecondary: {
    color: partnerTheme.textMuted,
    textAlign: 'center',
  },
});

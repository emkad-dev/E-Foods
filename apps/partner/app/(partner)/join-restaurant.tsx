/**
 * "I was invited": the code-entry screen for a staff member joining a
 * restaurant somebody else owns.
 *
 * WHY THIS ROUTE EXISTS SEPARATELY FROM THE APPLICANT FLOW. A signed-in user
 * without the `restaurant` role is, as far as `resolvePartnerLandingRoute`
 * was ever concerned, an applicant: they get sent to
 * `complete-restaurant-details` (or `application-under-review` if they have a
 * submission in flight). An invited staff member is neither. They are not
 * applying to own a restaurant -- there is no business to verify, no KYC
 * document, no payout account, and nothing for an admin to approve. Sending
 * them down that wizard would have them create a SECOND restaurant record to
 * get into the one they were invited to.
 *
 * So this is a third destination for a non-restaurant user, and `_layout.tsx`
 * treats it as one: the `user.role !== 'restaurant'` branch stops redirecting
 * once the pathname is already this route. Nothing about where a genuine
 * applicant LANDS changed -- a fresh signup still arrives at
 * `complete-restaurant-details`, because an invite is the rarer case and the
 * app cannot know which kind of person just signed up. What changed is that
 * the applicant screen now carries a link here, so the invitee gets out of the
 * wizard in one tap instead of having to become an applicant first.
 *
 * It is registered with `href: null` rather than being hidden behind the role
 * check, so an already-approved partner who follows this URL gets the screen
 * and then the server's 409 ("this account already works for another
 * restaurant") -- an explanation rather than a 404. The `Back` button below
 * exists for exactly that visitor.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useNotice } from '@feasty/design-system';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  STAFF_INVITE_CODE_LENGTH,
  normaliseStaffInviteCode,
  validateStaffInviteCode,
} from '../../src/domain/staffInvites';
import { redeemStaffInvite } from '../../src/services/partnerStaff';
import { supabase } from '../../src/services/supabase/config';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

export default function JoinRestaurantScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user } = useAuth();
  // Inline: this screen is one card with one field, so the notice sits where
  // the person is already looking and there is no list to scroll it away from.
  const { notice, showNotice } = useNotice({ placement: 'inline' });

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  /**
   * The restaurant they just joined, once they have.
   *
   * State rather than a notice-and-navigate, because a notice lives in the
   * screen that raised it: replacing the route in the same tick destroys the
   * only sentence naming the restaurant this person now works for. Redeeming
   * happens once in an employment, so it is worth a screen of its own rather
   * than a message that flashes past on the way to a dashboard.
   */
  const [joinedRestaurant, setJoinedRestaurant] = useState<string | null>(null);

  const handleRedeem = async () => {
    if (redeeming) {
      return;
    }

    const validationError = validateStaffInviteCode(code);

    if (validationError) {
      setCodeError(validationError);
      return;
    }

    setCodeError(null);
    setRedeeming(true);

    try {
      const joined = await redeemStaffInvite(code);

      // The role change happened server-side (`syncUserRoleState`), so this
      // session's cached profile still says `customer` and the layout would
      // bounce them straight back to the applicant wizard. Refreshing the
      // session re-fires the auth listener, which re-reads the user document
      // and picks up the new role -- the same move the onboarding submit
      // makes after its own server-side status change.
      //
      // Awaited BEFORE the success state is shown, so the "Open the
      // dashboard" button below cannot be pressed while the layout would
      // still redirect the presser back into the applicant wizard.
      await supabase.auth.refreshSession().catch(() => undefined);
      setJoinedRestaurant(joined.restaurantName);
    } catch (nextError: any) {
      // Rendered VERBATIM. The server deliberately returns one message for
      // wrong, expired and out-of-attempts, because distinguishing them tells
      // an attacker which addresses have live invites -- so this screen must
      // not try to guess which case it was and say something more specific.
      showNotice({
        tone: 'error',
        title: 'That did not work',
        message: nextError?.message ?? 'Unable to check that code right now.',
      });
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + SCREEN_TOP_INSET, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>{joinedRestaurant ? 'You are in' : 'Join a restaurant'}</Text>
        <Text style={styles.copy}>
          {joinedRestaurant
            ? `Your account now has access to ${joinedRestaurant}.`
            : `Enter the ${STAFF_INVITE_CODE_LENGTH}-digit code the restaurant emailed you. This links the account you are signed in to now - it does not create a new one.`}
        </Text>
      </View>

      {joinedRestaurant ? (
        <View style={styles.card}>
          <Text accessibilityLiveRegion="polite" role="status" style={styles.cardLine}>
            You can take orders, update the menu and change the store settings. What you cannot do is see or change
            anyone else&rsquo;s login - and nobody at {joinedRestaurant} can see yours.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.replace('/(partner)/' as never)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open the dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          {/* The single most common failure on this screen is invisible from
              here: the code was sent to one address and the person signed up
              with another. Naming the address they are signed in as is the only
              way they can spot it, because the server's rejection deliberately
              will not say so. */}
          {user?.email ? (
            <Text style={styles.cardLine}>
              Signed in as <Text style={styles.cardLineStrong}>{user.email}</Text>. The code only works if that is the
              address the invite was sent to.
            </Text>
          ) : null}

          <TextInput
            accessibilityLabel="Invite code"
            autoComplete="one-time-code"
            autoCorrect={false}
            autoFocus
            editable={!redeeming}
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={STAFF_INVITE_CODE_LENGTH}
            onChangeText={(next) => {
              // Normalised on every keystroke. The code is read off one screen
              // and typed into another, or pasted out of an email with a
              // trailing newline; a field that silently refuses those looks
              // broken, and there are only five attempts before the invite dies.
              setCode(normaliseStaffInviteCode(next));
              if (codeError) {
                setCodeError(null);
              }
            }}
            onSubmitEditing={() => void handleRedeem()}
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
            accessibilityState={{ busy: redeeming, disabled: redeeming }}
            disabled={redeeming}
            onPress={() => void handleRedeem()}
            style={[styles.primaryButton, redeeming ? styles.controlDisabled : null]}
          >
            {redeeming ? (
              <ActivityIndicator color={partnerTheme.textOnBrand} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Join the restaurant</Text>
            )}
          </TouchableOpacity>

          {notice}

          <Text style={styles.hint}>
            No code? Ask the restaurant to send one to this address. Codes expire, and a new one replaces the old.
          </Text>
        </View>
      )}

      {/* The exits, and they are suppressed once the code has been redeemed:
          "I am setting up my own restaurant instead" would walk a person who
          just joined a team into an application wizard, and on this branch
          the layout no longer guards it. */}
      {joinedRestaurant ? null : user?.role === 'restaurant' ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.replace('/(partner)/complete-restaurant-details' as never)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>I am setting up my own restaurant instead</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => void signOut()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
        </>
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
  cardLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  cardLineStrong: {
    color: partnerTheme.text,
    fontWeight: '800',
  },
  codeInput: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    justifyContent: 'center',
    letterSpacing: 8,
    marginTop: 16,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 12,
    textAlign: 'center',
  },
  // `dangerText`, not `danger`: the red in this palette is a FILL and fails
  // AA as ink on every light surface in the app.
  inputError: {
    borderColor: partnerTheme.dangerText,
  },
  fieldError: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
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
    marginTop: 14,
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
});

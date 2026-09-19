/**
 * Team: the people who can act for this restaurant, and the invites out to
 * people who cannot yet.
 *
 * WHY THIS SCREEN EXISTS. One login used to be shared by the owner, the
 * manager and the kitchen, so every audited action resolved to a single uid
 * and a departing employee kept working credentials. Each person now holds
 * their own account.
 *
 * WHY THE OWNER NEVER SEES A CODE, which is the constraint every decision on
 * this screen bends around: the owner does not create the account and never
 * learns the password, because an action logged against a staff member is
 * only evidence if the owner could not have taken it. `partnerInviteStaff`
 * returns no code, and there is deliberately no resend-and-show, no copy
 * button and no reveal here. The code goes to the invitee's mailbox and
 * nowhere else.
 *
 * Reached from the Store tab, not the tab bar: staff change a handful of
 * times a year and the four tabs are spent (see STORE_SUB_ROUTES in
 * _layout.tsx).
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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useConfirm, useNotice } from '@feasty/design-system';
import { Skeleton, SkeletonListRow, SkeletonScreen } from '../../src/components/Skeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import {
  INVITE_SENT_TITLE,
  describeStaffInvite,
  formatInviteExpiry,
  inviteSentMessage,
  staffMemberName,
  staffRemovalConfirm,
  validateStaffInviteEmail,
  type StaffInvite,
  type StaffMember,
} from '../../src/domain/staffInvites';
import { usePartnerStaff } from '../../src/hooks/usePartnerStaff';
import { inviteStaffMember, revokeStaffAccess, revokeStaffInvite } from '../../src/services/partnerStaff';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

const WIDE_BREAKPOINT = 1024;

export default function PartnerStaffScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { user } = useAuth();
  const { error, invites, loaded, loading, refresh, staff } = usePartnerStaff();
  const { confirm, confirmDialog } = useConfirm();
  // Floating, not inline: every action on this screen fires from a row in a
  // list that can be scrolled well past the form at the top, so an inline
  // notice would answer somewhere the owner is not looking. The offset clears
  // the tab bar on narrow layouts; the wide layout uses a sidebar and has none.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= WIDE_BREAKPOINT ? insets.bottom + 16 : insets.bottom + 86,
  });

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // Keyed by the id of whatever is being acted on, so one pending revoke
  // disables its own row rather than the whole list.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleBack = () => {
    // Deep-linked or reloaded on the web build there is no history to pop, and
    // `router.back()` on an empty stack leaves the partner on a screen with no
    // way out. Same shape as the ratings and account screens.
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/profile' as never);
  };

  const sendInvite = async (address: string) => {
    const sent = await inviteStaffMember(address);
    showNotice({
      tone: 'success',
      title: INVITE_SENT_TITLE,
      // Says what has NOT happened as well as what has. An owner who believes
      // an account now exists waits for a person who was never told to sign up.
      message: inviteSentMessage(sent.email ?? address),
      // Sticky. This is a three-step instruction the owner may need to relay
      // over the phone, and the default four seconds is not long enough to
      // read it, let alone repeat it.
      durationMs: null,
    });
    await refresh();
  };

  const handleInvite = async () => {
    if (inviting) {
      return;
    }

    const validationError = validateStaffInviteEmail({
      email,
      ownerEmail: user?.email ?? null,
      staff,
    });

    if (validationError) {
      setEmailError(validationError);
      return;
    }

    setEmailError(null);
    setInviting(true);

    try {
      await sendInvite(email);
      setEmail('');
    } catch (nextError: any) {
      // The server's own sentences are the good ones here -- the 412 names the
      // store setup that is missing. Rendered through the notice rather than
      // `Alert`, which is an empty function on partner.feasty.com.ng.
      showNotice({
        tone: 'error',
        title: 'Invite not sent',
        message: nextError?.message ?? 'Unable to send that invite right now.',
      });
    } finally {
      setInviting(false);
    }
  };

  const handleInviteAgain = async (invite: StaffInvite) => {
    setPendingId(invite.id);

    try {
      await sendInvite(invite.email);
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Invite not sent',
        message: nextError?.message ?? 'Unable to send a new code right now.',
      });
    } finally {
      setPendingId(null);
    }
  };

  /**
   * NO CONFIRMATION, deliberately. Cancelling an unredeemed invite is not
   * destructive: no account exists because of it, nobody has gained anything
   * from it, and the owner can send another in one line. A modal in front of
   * it would train the owner to dismiss modals, which is exactly the habit the
   * removal dialog below depends on them not having.
   */
  const handleRevokeInvite = async (invite: StaffInvite) => {
    setPendingId(invite.id);

    try {
      await revokeStaffInvite(invite.id);
      showNotice({
        tone: 'success',
        title: 'Invite cancelled',
        message: `The code sent to ${invite.email} no longer works.`,
      });
      await refresh();
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Could not cancel that invite',
        // The 404 ("That invite is no longer pending") is the interesting
        // case: it means the person redeemed it while this screen was open.
        message: nextError?.message ?? 'Unable to cancel that invite right now.',
      });
      // Whatever happened, this screen's copy of the row is now suspect.
      await refresh();
    } finally {
      setPendingId(null);
    }
  };

  /**
   * DESTRUCTIVE, and the only control here that is. It takes a working login
   * away from a colleague mid-shift, and it fires from a row in a list where a
   * mis-tap lands on the neighbour -- so it goes through `useConfirm`, which
   * names the person in its title.
   */
  const handleRemoveStaff = async (member: StaffMember) => {
    const copy = staffRemovalConfirm(member);
    setPendingId(member.uid);

    try {
      const removed = await confirm({
        ...copy,
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a second tap cannot fire a second removal.
        onConfirm: () => revokeStaffAccess(member.uid),
      });

      if (removed) {
        showNotice({
          tone: 'success',
          title: 'Access removed',
          message: `${staffMemberName(member)} can no longer act for this store.`,
        });
        await refresh();
      }
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Could not remove access',
        message: nextError?.message ?? 'Unable to remove that person right now.',
      });
      await refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (loading) {
    return (
      <SkeletonScreen>
        <Skeleton width="30%" height={22} />
        <Skeleton width="70%" height={13} style={{ marginBottom: 26, marginTop: 10 }} />
        <Skeleton height={150} radius={14} style={{ marginBottom: 20 }} />
        <SkeletonListRow />
        <SkeletonListRow />
      </SkeletonScreen>
    );
  }

  // A request that failed before anything loaded has established NOTHING about
  // this restaurant's team, so the screen must not fall through to "No one else
  // has access yet" -- that sentence is a claim, and this state cannot make it.
  const failedCold = error !== null && !loaded;

  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView it would anchor to the
    // bottom of the CONTENT and scroll away.
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}
      >
        {/* Labelled because the visible text leads with a bare `&lsaquo;`,
            which a screen reader either reads out as punctuation or drops. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to Store"
          style={styles.backLink}
          onPress={handleBack}
        >
          <Text style={styles.backLinkText}>&lsaquo; Store</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Team</Text>
        <Text style={styles.subtitle}>
          Give each person their own login instead of sharing yours. You invite them by email; they choose their own
          password, and you never see it.
        </Text>

        {failedCold ? (
          <View style={styles.errorCard}>
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorTitle}>
              Could not load your team
            </Text>
            <Text style={styles.errorCopy}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => void refresh()}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Stale rather than fatal: a failed refresh keeps whatever is
                already on screen and says so, instead of emptying the list. */}
            {error ? (
              <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
                {error}
              </Text>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Invite someone</Text>
              <Text style={styles.cardCopy}>
                We email them a 6-digit code. They sign up in this app with that address, then enter the code to join
                your store. The code is only in their inbox - you will not see it here.
              </Text>
              <TextInput
                accessibilityLabel="Email address of the person you are inviting"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!inviting}
                inputMode="email"
                keyboardType="email-address"
                onChangeText={(next) => {
                  setEmail(next);
                  // Cleared on edit, not re-validated on every keystroke: an
                  // error that reappears while somebody is still typing their
                  // address reads as the field arguing with them.
                  if (emailError) {
                    setEmailError(null);
                  }
                }}
                onSubmitEditing={() => void handleInvite()}
                placeholder="name@restaurant.com"
                placeholderTextColor={partnerTheme.textSoft}
                returnKeyType="send"
                style={[styles.input, emailError ? styles.inputError : null]}
                value={email}
              />
              {emailError ? (
                <Text accessibilityLiveRegion="polite" role="alert" style={styles.fieldError}>
                  {emailError}
                </Text>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ busy: inviting, disabled: inviting }}
                disabled={inviting}
                onPress={() => void handleInvite()}
                style={[styles.primaryButton, inviting ? styles.controlDisabled : null]}
              >
                {inviting ? (
                  <ActivityIndicator color={partnerTheme.textOnBrand} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send invite code</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.listHeading}>People with access</Text>
            {staff.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Only you, so far</Text>
                <Text style={styles.emptyCopy}>
                  Anyone you invite shows up here once they have signed up and entered their code.
                </Text>
              </View>
            ) : (
              staff.map((member) => (
                <View key={member.uid} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{staffMemberName(member)}</Text>
                    {/* Only when it adds something. For a person with no
                        display name the title IS the address, and printing it
                        twice reads as a rendering bug. */}
                    {member.displayName?.trim() && member.email ? (
                      <Text style={styles.rowCopy}>{member.email}</Text>
                    ) : null}
                    {member.disabled ? (
                      <Text style={styles.rowWarning}>
                        This login is disabled - they cannot sign in until an admin re-enables it.
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    // The visible word is "Remove", which in a list of people
                    // does not say who. Every row's button would otherwise
                    // announce identically.
                    accessibilityLabel={`Remove ${staffMemberName(member)}'s access`}
                    accessibilityState={{ disabled: pendingId === member.uid }}
                    disabled={pendingId === member.uid}
                    onPress={() => void handleRemoveStaff(member)}
                    style={[styles.dangerButton, pendingId === member.uid ? styles.controlDisabled : null]}
                  >
                    <Text style={styles.dangerButtonText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            {invites.length > 0 ? (
              <>
                <Text style={styles.listHeading}>Invites out</Text>
                {invites.map((invite) => {
                  const view = describeStaffInvite(invite);
                  const expiry = formatInviteExpiry(invite.expiresAt);
                  const busy = pendingId === invite.id;

                  return (
                    <View key={invite.id} style={styles.row}>
                      <View style={styles.rowText}>
                        <View style={styles.rowHeader}>
                          <Text style={styles.rowTitle}>{invite.email}</Text>
                          <View style={[styles.badge, view.tone === 'expired' ? styles.badgeExpired : styles.badgePending]}>
                            <Text
                              style={[
                                styles.badgeText,
                                view.tone === 'expired' ? styles.badgeTextExpired : styles.badgeTextPending,
                              ]}
                            >
                              {view.label}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.rowCopy}>{view.detail}</Text>
                        {/* Omitted entirely when the timestamp is unreadable.
                            A stated deadline is a promise, and a guessed one
                            is worse than none. */}
                        {expiry ? <Text style={styles.rowMeta}>{expiry}</Text> : null}
                        <View style={styles.rowActions}>
                          {view.canInviteAgain ? (
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel={`Send a new code to ${invite.email}`}
                              accessibilityState={{ busy, disabled: busy }}
                              disabled={busy}
                              onPress={() => void handleInviteAgain(invite)}
                              style={[styles.inlineButton, busy ? styles.controlDisabled : null]}
                            >
                              <Text style={styles.inlineButtonText}>Send a new code</Text>
                            </TouchableOpacity>
                          ) : null}
                          {view.canRevoke ? (
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel={`Cancel the invite to ${invite.email}`}
                              accessibilityState={{ busy, disabled: busy }}
                              disabled={busy}
                              onPress={() => void handleRevokeInvite(invite)}
                              style={[styles.inlineButton, busy ? styles.controlDisabled : null]}
                            >
                              <Text style={styles.inlineDangerText}>Cancel invite</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      {notice}
      {confirmDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 1100,
    paddingBottom: 30,
    paddingHorizontal: 18,
    width: '100%',
  },
  backLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginBottom: 6,
    minHeight: MIN_TAP_TARGET,
    paddingRight: 12,
    paddingVertical: 10,
  },
  backLinkText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  title: {
    color: partnerTheme.text,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  subtitle: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  errorCard: {
    backgroundColor: partnerTheme.dangerSoft,
    borderRadius: radius.xl,
    marginTop: 14,
    padding: 18,
  },
  errorTitle: {
    color: partnerTheme.dangerText,
    fontSize: 16,
    fontWeight: '800',
  },
  errorCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 10,
  },
  retryText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  cardTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardCopy: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  // `dangerText`, not `danger`: the red in this palette is a FILL and fails AA
  // as ink on every light surface in the app, including this card.
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
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  controlDisabled: {
    opacity: 0.5,
  },
  listHeading: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 22,
  },
  emptyCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 12,
    padding: 18,
  },
  emptyTitle: {
    color: partnerTheme.text,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyCopy: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  row: {
    alignItems: 'flex-start',
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowTitle: {
    color: partnerTheme.text,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  rowCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  rowMeta: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  rowWarning: {
    color: partnerTheme.warningText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgePending: {
    backgroundColor: partnerTheme.accentSoft,
  },
  badgeExpired: {
    backgroundColor: partnerTheme.warningSoft,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  // The text counterparts of the two fills above -- `accent` and `warning`
  // themselves are fills and fail AA as ink on their own soft tints.
  badgeTextPending: {
    color: partnerTheme.accentStrong,
  },
  badgeTextExpired: {
    color: partnerTheme.warningText,
  },
  /**
   * A text button rather than a filled one, and sized to the floor by
   * `minHeight` rather than by padding. `hitSlop` would be the obvious move
   * for a small inline control and is inert on react-native-web, so the box
   * itself has to be legal.
   */
  inlineButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingRight: 14,
  },
  inlineButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  inlineDangerText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    fontWeight: '800',
  },
  dangerButton: {
    alignItems: 'center',
    borderColor: partnerTheme.dangerText,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 14,
  },
  dangerButtonText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    fontWeight: '800',
  },
});

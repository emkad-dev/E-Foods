/**
 * The partner account: who is signed in, which restaurant this login controls,
 * and the two irreversible-ish doors out of the product.
 *
 * Split off the Store tab, where it sat under a ~220-line setup form. None of
 * it is touched during service, and the account-deletion confirm flow in
 * particular should not share a screen with controls a partner taps in a hurry.
 *
 * The restaurant claim list is here rather than on the Store tab because it is
 * an account-to-restaurant binding, not a shop-floor control, and it renders
 * only when there is actually something to claim - the everyday state is a
 * single line naming the linked restaurant.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useConfirm, useNotice } from '@feasty/design-system';
import {
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_TITLE,
  accountDeletionErrorMessage,
  accountDeletionParagraphs,
} from '../../../../packages/domain/src/accountDeletion';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { useAuth } from '../../src/contexts/AuthContext';
import { VERIFIED_LINK_MESSAGE } from '../../src/domain/restaurantLinkCopy';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

export default function PartnerAccountScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { deleteAccount, linkRestaurant, loading: authLoading, signOut, user } = useAuth();
  const { error, loading, restaurant, restaurants, requiresVerifiedLink } = usePartnerRestaurant();
  const { confirm, confirmDialog } = useConfirm();
  // Sign-out and link failures used to report through `Alert`, which is
  // `class Alert { static alert() {} }` in react-native-web - nothing at all on
  // partner.feasty.com.ng. `error` below belongs to usePartnerRestaurant and
  // carries LOAD failures only.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= 1024 ? insets.bottom + 16 : insets.bottom + 86,
  });
  // Separate from `error` above: this one sits beside the delete button, which
  // is the control it belongs to.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState<string | null>(null);

  // Derived here rather than taken from the hook: the server's own
  // `claimableRestaurants` keeps the restaurant this login already manages in
  // the list, which would put a "Confirm link" button on the store the partner
  // already controls. The rule this screen wants is "everything except the one
  // already linked", so the hook no longer keeps the server's copy at all.
  //
  // NOTE the `?? restaurant?.id` fallback. It makes this filter and the
  // server's `requiresVerifiedLink` read the linked id from two different
  // places, which is what keeps the empty state below reachable - see the
  // comment on it.
  const linkedRestaurantId = user?.restaurantId ?? restaurant?.id ?? null;
  const claimableRestaurants = [...restaurants]
    .filter((candidate) => candidate.id !== linkedRestaurantId)
    .sort((left, right) => left.name.localeCompare(right.name));

  const handleLinkRestaurant = async (restaurantId: string, restaurantName: string) => {
    setLinkPending(restaurantId);

    try {
      await linkRestaurant(restaurantId);
      showNotice({
        tone: 'success',
        title: 'Restaurant linked',
        message: `${restaurantName} is now connected to this partner account.`,
      });
    } catch (nextError: any) {
      // `linkRestaurant` writes to AuthContext's `error`, which this screen
      // never renders - the slot at the top belongs to usePartnerRestaurant.
      showNotice({
        tone: 'error',
        title: 'Link failed',
        message: nextError?.message ?? 'Unable to link this restaurant right now.',
      });
    } finally {
      setLinkPending(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Sign out failed',
        message: nextError?.message ?? 'Unable to sign out right now.',
      });
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);

    try {
      await confirm({
        title: ACCOUNT_DELETION_TITLE,
        paragraphs: accountDeletionParagraphs('partner'),
        confirmLabel: ACCOUNT_DELETION_CONFIRM_LABEL,
        cancelLabel: ACCOUNT_DELETION_CANCEL_LABEL,
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a second tap cannot fire a second delete.
        onConfirm: deleteAccount,
      });
    } catch (nextError) {
      // The backend's 412 ("Partner accounts linked to a restaurant must be
      // offboarded by admin...") is the whole point of this path, so it is shown
      // in the screen rather than through Alert, which is inert on the web build
      // at partner.feasty.com.ng.
      setDeleteError(accountDeletionErrorMessage(nextError));
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/profile' as never);
  };

  // Raised once on mount and never again, so this cannot flash over a realtime
  // refresh. Without it the linked-restaurant line read "Not linked yet" while
  // the context was still loading.
  if (loading) {
    return <LoadingSkeleton mode="profile" />;
  }

  const accountBusy = authLoading || linkPending !== null;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
        {/* Labelled because the visible text leads with a bare `&lsaquo;`,
            which a screen reader either reads out as punctuation or drops. */}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Store" style={styles.backLink} onPress={handleBack}>
          <Text style={styles.backLinkText}>&lsaquo; Store</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.subtitle}>The login that controls this store.</Text>
        {error ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
            {error}
          </Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Signed in as</Text>
          <Text style={styles.metaLine}>{user?.email ?? 'Email not available'}</Text>
          {/* The LIVE name first. `user.restaurantName` is a denormalised copy
              on the user document, refreshed on the client only by
              `linkRestaurant` -- which store-details calls just when the
              restaurant ID changes, never on a rename. So renaming the store
              updated RestaurantRecord and the realtime-backed `restaurant.name`
              while this line, preferring the copy, kept showing the old name
              for the rest of the session. The copy stays as the fallback: it is
              the only name available before the restaurant context resolves. */}
          <Text style={styles.metaLine}>
            Controlling {restaurant?.name ?? user?.restaurantName ?? 'no restaurant yet'}
          </Text>
        </View>

        {requiresVerifiedLink || claimableRestaurants.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Link a restaurant</Text>
            <Text style={styles.helperText}>
              {requiresVerifiedLink
                ? VERIFIED_LINK_MESSAGE
                : 'These restaurants are owned by this account. Linking one makes it the restaurant this login controls.'}
            </Text>
            {claimableRestaurants.map((candidate) => (
              <View key={candidate.id} style={styles.restaurantRow}>
                <View style={styles.restaurantMeta}>
                  <Text style={styles.restaurantName}>{candidate.name}</Text>
                  <Text style={styles.restaurantInfo}>
                    {candidate.cuisine ?? 'Cuisine not set'} | {candidate.address ?? 'Address not set'}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  // "Confirm link" is identical on every row; which restaurant
                  // it links is only in the text beside it.
                  accessibilityLabel={`Confirm link to ${candidate.name}`}
                  style={[styles.linkButton, accountBusy ? styles.controlDisabled : null]}
                  onPress={() => handleLinkRestaurant(candidate.id, candidate.name)}
                  disabled={accountBusy}
                >
                  <Text style={styles.linkButtonText}>
                    {linkPending === candidate.id ? 'Linking...' : 'Confirm link'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
            {/* KEPT, and not because it is hard to reach - it is reachable.
                The block above renders when `requiresVerifiedLink || length > 0`,
                so this line needs the flag true AND an empty list. The flag is
                raised server-side from `UserAccount.restaurantId`; the list is
                filtered client-side by `user.restaurantId ?? restaurant.id`.
                Those two agree only while the cached user profile is current.
                AuthContext hydrates `user` from the stored profile on cold start
                and again on the offline fallback, so a profile cached before the
                account was linked has no `restaurantId` - the filter then falls
                back to the managed restaurant's own id and removes it from the
                list, leaving nothing, while the server still reports a dangling
                link. A partner who owns exactly one restaurant lands here. */}
            {claimableRestaurants.length === 0 ? (
              <Text style={styles.metaLine}>
                No other restaurant is attached to this account. Saving your store details will link the one you own.
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Leaving</Text>
          <Text style={styles.helperText}>
            Sign out when you are done on this device. If you want this partner account removed entirely, use delete. The
            backend will block self-removal while admin-controlled business records are still attached.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.secondaryButton, accountBusy ? styles.controlDisabled : null]}
            onPress={handleSignOut}
            disabled={accountBusy}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.deleteButton, accountBusy ? styles.controlDisabled : null]}
            onPress={handleDeleteAccount}
            disabled={accountBusy}
          >
            <Text style={styles.deleteButtonText}>Delete account</Text>
          </TouchableOpacity>
          {deleteError ? (
            <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
              {deleteError}
            </Text>
          ) : null}
        </View>

        {confirmDialog}
      </ScrollView>
      {notice}
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
    marginTop: 12,
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
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  metaLine: {
    color: partnerTheme.textMuted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 4,
  },
  helperText: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  restaurantRow: {
    alignItems: 'center',
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  restaurantMeta: {
    flex: 1,
  },
  restaurantName: {
    color: partnerTheme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  restaurantInfo: {
    color: partnerTheme.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surfaceMuted,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    minWidth: 74,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  linkButtonText: {
    color: partnerTheme.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accentStrong,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  deleteButton: {
    alignItems: 'center',
    borderColor: partnerTheme.danger,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 14,
  },
  deleteButtonText: {
    color: partnerTheme.dangerText,
    fontSize: 15,
    fontWeight: '800',
  },
  // One shared dim for every control that can go disabled on this screen.
  controlDisabled: {
    opacity: 0.5,
  },
});

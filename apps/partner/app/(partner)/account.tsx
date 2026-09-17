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
        <TouchableOpacity style={styles.backLink} onPress={handleBack}>
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
          <Text style={styles.metaLine}>
            Controlling {user?.restaurantName ?? restaurant?.name ?? 'no restaurant yet'}
          </Text>
        </View>

        {requiresVerifiedLink || claimableRestaurants.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Link a restaurant</Text>
            <Text style={styles.helperText}>
              {requiresVerifiedLink
                ? 'A restaurant owned by this account is not explicitly linked to your partner profile yet. Confirm it so future access stays pinned to the right restaurant.'
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
            style={[styles.secondaryButton, accountBusy ? styles.controlDisabled : null]}
            onPress={handleSignOut}
            disabled={accountBusy}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity
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

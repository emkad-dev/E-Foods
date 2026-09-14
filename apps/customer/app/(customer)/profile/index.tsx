import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text, space, useConfirm, useNotice } from '@feasty/design-system';
import {
  ACCOUNT_DELETION_CANCEL_LABEL,
  ACCOUNT_DELETION_CONFIRM_LABEL,
  ACCOUNT_DELETION_TITLE,
  accountDeletionErrorMessage,
  accountDeletionParagraphs,
} from '../../../../../packages/domain/src/accountDeletion';
import AuthPromptCard from '../../../src/components/AuthPromptCard';
import { screenColumn } from '../../../src/components/ScreenColumn';
import ProfileDeliveryCard from '../../../src/components/profile/ProfileDeliveryCard';
import ProfileIdentityCard from '../../../src/components/profile/ProfileIdentityCard';
import ProfileLinkRow from '../../../src/components/profile/ProfileLinkRow';
import ProfileStatTile from '../../../src/components/profile/ProfileStatTile';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useCart } from '../../../src/contexts/CartContext';
import { useFavorites } from '../../../src/contexts/FavoritesContext';
import {
  formatDeliverySummary,
  getProfileInitials,
  summarizeOrders,
  type ProfileOrderSummary,
} from '../../../src/domain/profileSummary';
import { getCustomerOrders } from '../../../src/services/customerReadModel';
import { customerTheme } from '../../../src/theme/palette';

/** Which of the two account actions is in flight, if either. */
type ProfileBusyAction = 'signOut' | 'delete';

export default function ProfileScreen() {
  const { deleteAccount, signOut, user } = useAuth();
  const { deliveryLocation } = useCart();
  const { favoriteRestaurantIds } = useFavorites();
  const { confirm, confirmDialog } = useConfirm();
  // ONE feedback surface for the whole screen. Before this the screen had two —
  // a SuccessBanner pinned to the top for the saves that worked, and a separate
  // inline `deleteError` line down in the Access group — while the username and
  // phone FAILURES went to `Alert`, which is an empty function on the web build
  // (app.feasty.com.ng) and so said nothing at all. Floating rather than inline
  // because the controls are spread down a scrolling page: Sign out and Delete
  // sit at the very bottom, past the fold on a short screen. The profile tab
  // hides the tab bar, so the card needs no bottom offset here.
  const { dismissNotice, notice, showNotice } = useNotice({ placement: 'floating' });

  // NOT `loading` from useAuth(). That is one context-wide flag raised by every
  // auth operation — sign-in, bootstrap, the profile saves, sign-out and delete
  // alike — so gating controls on it made saving a display name disable the
  // Sign out row and relabel it "Working...". Each action owns its own state.
  const [busy, setBusy] = useState<ProfileBusyAction | null>(null);
  const [orderSummary, setOrderSummary] = useState<ProfileOrderSummary | null>(null);

  const userId = user?.uid;

  useEffect(() => {
    if (!userId) {
      setOrderSummary(null);
      return;
    }

    // ONE read on mount. No polling and no realtime channel: a second
    // subscription on CustomerOrder costs real invocations on the Free plan and
    // a tile showing a count does not warrant one. `getCustomerOrders` memoises
    // per user for 12s, so arriving here from the orders list is free.
    let cancelled = false;

    getCustomerOrders()
      .then(({ orders }) => {
        if (!cancelled) {
          setOrderSummary(summarizeOrders(orders));
        }
      })
      .catch(() => {
        // Swallowed on purpose. The tile's job is to navigate to /orders; a
        // failed count must not raise an error banner on a screen the customer
        // opened to do something else, and the tile renders figureless.
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleSignOut = async () => {
    setBusy('signOut');

    try {
      await signOut();
    } catch {
      showNotice({
        tone: 'error',
        title: 'Could not sign out',
        message: 'Check your connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteAccount = async () => {
    dismissNotice();
    // Covers the whole dialog, not just the delete itself, so Sign out cannot be
    // tapped behind the scrim. The dialog's own busy ref remains the guard that
    // actually prevents a double delete — this flag only keeps the screen's two
    // buttons consistent with each other.
    setBusy('delete');

    try {
      await confirm({
        title: ACCOUNT_DELETION_TITLE,
        paragraphs: accountDeletionParagraphs('customer'),
        confirmLabel: ACCOUNT_DELETION_CONFIRM_LABEL,
        cancelLabel: ACCOUNT_DELETION_CANCEL_LABEL,
        destructive: true,
        // Held inside the dialog so both buttons stay disabled for the whole
        // round trip; a second tap cannot fire a second delete.
        onConfirm: deleteAccount,
      });
    } catch (nextError) {
      showNotice({
        tone: 'error',
        title: 'Account not deleted',
        message: accountDeletionErrorMessage(nextError),
      });
    } finally {
      setBusy(null);
    }
  };

  if (!user) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.guestContainer}>
        <View style={screenColumn.reading}>
          <AuthPromptCard
            title="Sign in to manage your account"
            message="Keep addresses, order recovery, and customer account controls in one place."
          />
        </View>
      </ScrollView>
    );
  }

  const delivery = formatDeliverySummary(deliveryLocation);
  const ordersValue = orderSummary
    ? orderSummary.activeCount > 0
      ? `${orderSummary.activeCount} in progress`
      : String(orderSummary.totalCount)
    : null;

  return (
    // The ScrollView is wrapped rather than used as the root because the
    // floating notice positions itself absolutely: inside a ScrollView that
    // would anchor it to the bottom of the CONTENT and let it scroll away,
    // instead of pinning it to the bottom of the screen.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <View style={screenColumn.reading}>
          <ProfileIdentityCard
            initials={getProfileInitials(user.displayName, user.email)}
            name={user.displayName?.trim() || 'Your account'}
            email={user.email}
            onEdit={() => router.push('/profile/edit')}
          />

          <ProfileDeliveryCard
            title={delivery.title}
            subtitle={delivery.subtitle}
            onPress={() => router.push('/delivery-location')}
          />

          <View style={styles.tiles}>
            <ProfileStatTile
              label="Orders"
              value={ordersValue}
              onPress={() => router.push('/orders')}
            />
            <ProfileStatTile
              label="Saved"
              // Free: FavoritesProvider wraps the whole (customer) group and has
              // already loaded by the time any screen inside it renders.
              value={String(favoriteRestaurantIds.length)}
              onPress={() => router.push('/favorites')}
            />
          </View>

          {/* One group, not two. The legal pair sits beside support rather than
              in a card of its own because these three rows are the same kind of
              thing to a customer: somewhere to go read something.

              These are now the primary signed-in route to either document — the
              only other entry point is an accordion link on /accept-policy, which
              nobody revisits — so they are not decoration, they are what an app
              store reviewer looks for. */}
          <Card padding="none" style={styles.group}>
            <Text variant="caption" tone="secondary" style={styles.groupTitle}>
              Help &amp; legal
            </Text>
            <ProfileLinkRow
              icon="life-ring"
              label="Help & Support"
              onPress={() => router.push('/support')}
            />
            <ProfileLinkRow
              icon="lock"
              label="Privacy policy"
              onPress={() => router.push('/privacy')}
            />
            <ProfileLinkRow
              icon="file-text-o"
              label="Terms of service"
              onPress={() => router.push('/terms')}
            />
          </Card>

          <View style={styles.actions}>
            <Button
              label="Sign out"
              variant="secondary"
              fullWidth
              loading={busy === 'signOut'}
              disabled={busy !== null}
              onPress={handleSignOut}
            />
            <Button
              label="Delete my account and data"
              // `destructiveQuiet`, not `destructive`. As a solid red slab this was
              // the single heaviest element on the screen, sitting below — and
              // outweighing — the customer's own identity card, which is what the
              // page is actually for. It is also the rarest control here and the
              // only irreversible one. Red label, no slab: the signal survives, and
              // the weight moves to the confirmation dialog, which already carries
              // a full destructive confirm button.
              variant="destructiveQuiet"
              fullWidth
              loading={busy === 'delete'}
              disabled={busy !== null}
              onPress={handleDeleteAccount}
              style={styles.deleteButton}
            />
          </View>
        </View>

        {confirmDialog}
      </ScrollView>
      {notice}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  container: {
    // 14 is the customer app's horizontal gutter (home, search, orders/[id]).
    padding: 14,
    paddingBottom: 28,
  },
  guestContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  tiles: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.md,
  },
  group: {
    marginTop: space.md,
    overflow: 'hidden',
  },
  groupTitle: {
    letterSpacing: 0.7,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    textTransform: 'uppercase',
  },
  actions: {
    gap: space.md,
    marginTop: space.xl,
  },
  deleteButton: {
    // Extra air above the irreversible control so it is never the button your
    // thumb lands on by momentum after Sign out.
    marginTop: space.md,
  },
});

/**
 * The Store tab: what a partner needs WHILE SERVICE IS RUNNING, and links to the
 * two things they do not.
 *
 * This screen used to be eleven jobs in one 1,155-line scroll, and the ordering
 * was backwards: the pause control - the one control a partner opens this tab
 * for mid-service, with a kitchen backing up - sat below a ~220-line setup form
 * they touch once. Setup now lives at /store-details and the account actions at
 * /account, both reached from the rows at the bottom of this screen, so pausing
 * is the first thing under the title at every width and needs no scrolling.
 *
 * Only `setPartnerStorePause` is called from here. It is the one store action
 * with no validation model and no save step, which is exactly why it can live on
 * a screen that opens instantly.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius, useNotice } from '@feasty/design-system';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import { VERIFIED_LINK_MESSAGE } from '../../src/domain/restaurantLinkCopy';
import { storeSetupGaps, storeTradingState } from '../../src/domain/storeSetupForm';
import { usePartnerRestaurant } from '../../src/hooks/usePartnerRestaurant';
import { setPartnerStorePause } from '../../src/services/partnerRestaurantActions';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT, SCREEN_TOP_INSET } from '../../src/theme/screenChrome';

// Task 16 (F2): quick pause durations - one tap picks a duration and pauses
// immediately, no separate confirm step (pausing is fully reversible with
// one more tap on "Resume now"). Mirrors _shared/availability.ts's
// isStorePaused on the display side only: paused while pausedUntil is still
// in the future, auto-resumes with no partner action once it passes.
const PAUSE_DURATION_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
] as const;

const isStoreCurrentlyPaused = (pausedUntil: string | null | undefined) => {
  if (!pausedUntil) {
    return false;
  }

  const untilMs = Date.parse(pausedUntil);
  return Number.isFinite(untilMs) && untilMs > Date.now();
};

const formatPausedUntil = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function PartnerStoreScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { error, loading, restaurant, requiresVerifiedLink } = usePartnerRestaurant();
  // Every pause and resume failure on this screen used to report through
  // `Alert`, which is `class Alert { static alert() {} }` in react-native-web -
  // nothing at all on partner.feasty.com.ng. The `error` below belongs to
  // usePartnerRestaurant and carries LOAD failures only, so a failed Pause left
  // the partner believing the store was paused while it was still accepting
  // orders nobody would cook.
  //
  // Floating rather than inline: the offset clears the tab bar on narrow
  // layouts; the wide layout uses a sidebar and has none.
  const { notice, showNotice } = useNotice({
    placement: 'floating',
    offsetBottom: width >= 1024 ? insets.bottom + 16 : insets.bottom + 86,
  });
  const [pauseActionPending, setPauseActionPending] = useState(false);

  // Task 16 (F2): the "two taps" pause action - one tap on a duration chip
  // pauses the store immediately via the dedicated partnerSetStorePause RPC,
  // separate from the store-details save so a kitchen backlog doesn't require
  // touching (or re-validating) the rest of the profile.
  const handlePauseStore = async (minutes: number) => {
    if (!restaurant?.id) {
      showNotice({
        tone: 'error',
        title: 'Store setup needed',
        message: 'Create or link a restaurant record before pausing orders.',
      });
      return;
    }

    setPauseActionPending(true);

    try {
      await setPartnerStorePause({
        paused: true,
        pausedUntil: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
        restaurantId: restaurant.id,
      });
    } catch (nextError: any) {
      // The partner must not be left believing the store is paused while it is
      // still taking orders. Sticky, as errors default to.
      showNotice({
        tone: 'error',
        title: 'Pause failed',
        message: nextError?.message ?? 'Unable to pause the store right now.',
      });
    } finally {
      setPauseActionPending(false);
    }
  };

  const handleResumeStore = async () => {
    if (!restaurant?.id) {
      return;
    }

    setPauseActionPending(true);

    try {
      await setPartnerStorePause({ paused: false, restaurantId: restaurant.id });
    } catch (nextError: any) {
      showNotice({
        tone: 'error',
        title: 'Resume failed',
        message: nextError?.message ?? 'Unable to resume the store right now.',
      });
    } finally {
      setPauseActionPending(false);
    }
  };

  // `loading` is raised once, on mount, and never again (usePartnerRestaurant
  // only ever lowers it), so this cannot flash over a realtime refresh. Without
  // it the screen rendered its status card from `undefined` during the first
  // load and told the partner their store was closed and hidden.
  if (loading) {
    return <LoadingSkeleton mode="profile" />;
  }

  const paused = isStoreCurrentlyPaused(restaurant?.pausedUntil);
  const pausedUntilLabel = restaurant?.pausedUntil ? formatPausedUntil(restaurant.pausedUntil) : null;
  const visible = restaurant?.isPublished === true;
  // `isOpen` is a switch the partner last touched at some unknown point in the
  // past, so on its own it said "Taking orders" at 3am for a store that closes
  // at 22:00. The saved trading window is the other half of the answer, and a
  // store that never saved one has no window to be outside of - 'unknown' is
  // NOT treated as closed, because the customer app's own gate fails open on
  // missing hours, so such a store really is orderable.
  const tradingState = storeTradingState(restaurant);
  const openNow = restaurant?.isOpen !== false && tradingState !== 'closed';
  const gaps = storeSetupGaps(restaurant);
  const pauseDisabled = pauseActionPending || !restaurant;

  // Read straight off the SAVED record. The dump this replaces mirrored saved
  // state next to the live switches that edited it, so it contradicted them for
  // as long as an edit went unsaved; there are no switches on this screen.
  //
  // PAUSE OUTRANKS HIDDEN, which is the reverse of what this used to do. The
  // pill sat directly above a body that renders the pause banner whenever the
  // store is paused, regardless of visibility - so a hidden, paused store read
  // "Hidden from customers" in the pill while the line underneath it said new
  // orders were off until a time. The body is the half that cannot change: it
  // carries "Resume now", and suppressing that for a hidden store would leave
  // pausedUntil set and the store silently paused the moment it is published.
  // So the pill follows the body. Nothing is lost by demoting hidden: it is
  // stated again below, with the action attached, whenever it applies.
  const status = !restaurant
    ? { label: 'No store yet', pill: styles.statusPillMuted, text: styles.statusTextMuted }
    : paused
      ? { label: 'Paused', pill: styles.statusPillWarning, text: styles.statusTextWarning }
      : !visible
        ? { label: 'Hidden from customers', pill: styles.statusPillMuted, text: styles.statusTextMuted }
        : !openNow
          ? { label: 'Closed', pill: styles.statusPillWarning, text: styles.statusTextWarning }
          : { label: 'Taking orders', pill: styles.statusPillLive, text: styles.statusTextLive };

  return (
    // Wrapped rather than used as the root because the floating notice
    // positions itself absolutely: inside a ScrollView that would anchor it to
    // the bottom of the CONTENT and let it scroll away, instead of pinning it
    // to the bottom of the screen.
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + SCREEN_TOP_INSET }]}>
        <Text style={styles.title}>Store</Text>
        <Text style={styles.subtitle}>Pause or resume orders here. Everything you set up once lives behind the rows below.</Text>
        {error ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.errorText}>
            {error}
          </Text>
        ) : null}

        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <Text style={styles.cardTitle}>Right now</Text>
            <View style={[styles.statusPill, status.pill]}>
              <Text style={[styles.statusText, status.text]}>{status.label}</Text>
            </View>
          </View>
          {paused ? (
            <View style={styles.pausedBanner}>
              <Text style={styles.pausedBannerCopy}>
                {pausedUntilLabel
                  ? `New orders are off until ${pausedUntilLabel}. They start again on their own then, or tap below to take orders sooner.`
                  : 'New orders are off. Tap below to start taking them again.'}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.primaryButton, pauseActionPending ? styles.controlDisabled : null]}
                onPress={handleResumeStore}
                disabled={pauseActionPending}
              >
                <Text style={styles.primaryButtonText}>{pauseActionPending ? 'Updating...' : 'Resume now'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.helperText}>
                Kitchen backed up? Pause the whole store for a set time - customers stop seeing you in search and can&apos;t place new
                orders. It resumes on its own the moment the time is up, no need to remember to switch it back on.
              </Text>
              <View style={styles.pauseChipRow}>
                {PAUSE_DURATION_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.label}
                    accessibilityRole="button"
                    // "30 min" alone is not an instruction. The visible label
                    // only means anything next to the paragraph above it, which
                    // a screen reader lands on separately (or not at all).
                    accessibilityLabel={`Pause new orders for ${option.label}`}
                    // Defect: every disabled control on the old screen looked
                    // identical to an enabled one, so a tap that did nothing
                    // read as a broken app. Each one now dims.
                    style={[styles.pauseChip, pauseDisabled ? styles.controlDisabled : null]}
                    onPress={() => handlePauseStore(option.minutes)}
                    disabled={pauseDisabled}
                  >
                    <Text style={styles.pauseChipText}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!restaurant ? (
                <Text style={styles.helperNote}>Pausing needs a store record. Open store details to create one.</Text>
              ) : null}
            </View>
          )}
          {/* Says in the body what the pill can no longer always say, so the
              two never carry different stories about the same store. */}
          {restaurant && !visible ? (
            <Text style={styles.helperNote}>
              Customers cannot see this store at all while it is hidden. Make it visible in store details.
            </Text>
          ) : null}
          {restaurant && visible && !paused && tradingState === 'closed' ? (
            <Text style={styles.helperNote}>
              Your saved trading hours ({restaurant.openingTime} - {restaurant.closingTime}) have you closed right now.
              Customers see you again at {restaurant.openingTime}.
            </Text>
          ) : null}
        </View>

        {gaps.length > 0 ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Finish your store setup</Text>
            {gaps.map((gap) => (
              <Text key={gap} style={styles.warningCopy}>
                {gap}
              </Text>
            ))}
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.warningAction}
              onPress={() => router.push('/store-details' as never)}
            >
              <Text style={styles.warningActionText}>Open store details</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {requiresVerifiedLink ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Verified link needed</Text>
            {/* One sentence, in one place - this screen and the account screen
                used to carry their own, and both described the opposite of the
                condition the backend actually raises. */}
            <Text style={styles.warningCopy}>{VERIFIED_LINK_MESSAGE}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.warningAction} onPress={() => router.push('/account' as never)}>
              <Text style={styles.warningActionText}>Open account</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity accessibilityRole="button" style={styles.navRow} onPress={() => router.push('/store-details' as never)}>
          <View style={styles.navRowText}>
            <Text style={styles.navRowTitle}>Store details</Text>
            <Text style={styles.navRowCopy}>
              Name, photos, address, trading hours, delivery and whether customers can see you.
            </Text>
          </View>
          {/* Drawn, not typed. As a 24pt `&rsaquo;` it was a glyph in a text
              node, so it grew with the OS font-size setting while the row's
              minHeight did not, and at the larger accessibility sizes it pushed
              out of the row. A bordered box is the same 10pt at every setting,
              and being textless it is skipped by screen readers rather than
              announced as punctuation. */}
          <View style={styles.navRowChevron} />
        </TouchableOpacity>

        {/* Read occasionally, never mid-service, so it belongs behind a row
            here rather than in the tab bar - same call as store details and
            account. */}
        <TouchableOpacity accessibilityRole="button" style={styles.navRow} onPress={() => router.push('/ratings' as never)}>
          <View style={styles.navRowText}>
            <Text style={styles.navRowTitle}>Ratings</Text>
            <Text style={styles.navRowCopy}>Your score and what customers said about their orders.</Text>
          </View>
          <View style={styles.navRowChevron} />
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" style={styles.navRow} onPress={() => router.push('/account' as never)}>
          <View style={styles.navRowText}>
            <Text style={styles.navRowTitle}>Account</Text>
            <Text style={styles.navRowCopy}>Your sign-in, the restaurant this account is linked to, and sign out.</Text>
          </View>
          <View style={styles.navRowChevron} />
        </TouchableOpacity>
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
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  statusPillLive: {
    backgroundColor: partnerTheme.successSoft,
  },
  statusPillWarning: {
    backgroundColor: partnerTheme.warningSoft,
  },
  statusPillMuted: {
    backgroundColor: partnerTheme.surfaceMuted,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '800',
  },
  statusTextLive: {
    color: partnerTheme.accentStrong,
  },
  statusTextWarning: {
    color: partnerTheme.warningText,
  },
  statusTextMuted: {
    color: partnerTheme.textMuted,
  },
  helperText: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  helperNote: {
    color: partnerTheme.textSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  pauseChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  pauseChip: {
    alignItems: 'center',
    backgroundColor: partnerTheme.warningSoft,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pauseChipText: {
    color: partnerTheme.warningText,
    fontSize: 14,
    fontWeight: '800',
  },
  // One shared dim for every control that can go disabled on this screen.
  controlDisabled: {
    opacity: 0.5,
  },
  pausedBanner: {
    backgroundColor: partnerTheme.warningSoft,
    // Was the literal '#efcf96' -- the only two hard-coded colours on this
    // screen, and a light-mode-only value no token controls. It also barely
    // existed: 1.18:1 against the warningSoft fill it outlined. `warning` is
    // the accent the design system pairs with `warningSoft`, and at 2.13:1 the
    // border is now actually a border. Deliberately stronger than what it
    // replaced, not a like-for-like swap.
    borderColor: partnerTheme.warning,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
  },
  pausedBannerCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  warningCard: {
    backgroundColor: partnerTheme.warningSoft,
    borderColor: partnerTheme.warning,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  warningTitle: {
    color: partnerTheme.warningText,
    fontSize: 15,
    fontWeight: '800',
  },
  warningCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  warningAction: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: 10,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: 10,
  },
  warningActionText: {
    color: partnerTheme.warningText,
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  navRow: {
    alignItems: 'center',
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    minHeight: MIN_TAP_TARGET,
    padding: 16,
  },
  navRowText: {
    flex: 1,
    minWidth: 0,
  },
  navRowTitle: {
    color: partnerTheme.text,
    fontSize: 16,
    fontWeight: '800',
  },
  navRowCopy: {
    color: partnerTheme.textSoft,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  navRowChevron: {
    borderColor: partnerTheme.textMuted,
    borderRightWidth: 2,
    borderTopWidth: 2,
    height: 10,
    transform: [{ rotate: '45deg' }],
    width: 10,
  },
});

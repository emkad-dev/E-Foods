import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type ViewStyle,
} from 'react-native';

import { border, brand, status, surface, text as textColor } from '../tokens/color';
import { radius } from '../tokens/radius';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import {
  noticeLiveRegion,
  noticeRole,
  resolveNoticeDurationMs,
  type NoticeTone,
} from './noticePolicy';

/**
 * The one-way notice: "Saved", "Save failed", "We don't deliver here yet".
 *
 * WHY THIS EXISTS: in `react-native-web` `Alert` is
 * `class Alert { static alert() {} }` — an empty function — so on the customer
 * web build (app.feasty.com.ng) every `Alert.alert` used purely to *tell* the
 * user something produced nothing at all. Unlike the yes/no gates, which at
 * least failed loudly by never running their action, these failed silently: the
 * Refresh-payment-status button answered its own question into the void, and
 * tapping Add on a dish outside the delivery area looked like a broken button.
 *
 * WHY A BANNER AND NOT A DIALOG: `useConfirm` is the right shape when the app
 * needs an answer — it takes focus, blocks the page, and refuses to go away.
 * A notice needs none of that and is actively harmed by all of it. It reports
 * something that already happened, so stealing focus costs the user their place
 * in the form, and demanding an OK for "Username saved" is hostile. This is
 * therefore a live region rather than a modal: the screen reader announces it
 * (`role="alert"` for errors, `role="status"` for the rest) without focus ever
 * moving, and a sighted user can keep typing straight through it.
 *
 * The host live region is mounted PERMANENTLY and filled on demand, rather than
 * mounted when a notice arrives. A live region that appears in the same commit
 * as its content is announced inconsistently across screen readers; one that is
 * already in the accessibility tree when the text lands is announced reliably.
 * Idle it renders an empty zero-height (inline) or pass-through (floating) box.
 *
 * PLACEMENT — pick by where the triggering control lives:
 *  - `inline` (default): the notice flows in the layout, normally right beside
 *    the control it answers for. Correct on short screens where control and
 *    notice are visible together — the auth forms, a detail card.
 *  - `floating`: pinned to the bottom of the screen, above the content. Correct
 *    when the action fires from an arbitrary row of a long list, where an
 *    inline notice would render somewhere the user is not looking.
 *
 * Deliberately built on plain `react-native` `Text` rather than this package's
 * `Text` primitive, for the same reason as `ConfirmDialog`: that primitive pins
 * `fontFamily` to the FEASTY faces, which only apps calling `useFeastyFonts()`
 * have loaded.
 */

export type { NoticeTone };

export type NoticeRequest = {
  /** Defaults to `info`. `error` is sticky and announced assertively. */
  tone?: NoticeTone;
  /** The headline. Should read as a complete statement on its own. */
  title: string;
  /** Optional second line: what happened, or what to do next. */
  message?: string;
  /**
   * Override the auto-dismiss. `null` keeps it on screen until dismissed;
   * omit it to take the tone's default (see `noticePolicy.ts`).
   */
  durationMs?: number | null;
};

export type UseNoticeOptions = {
  /** See the PLACEMENT note above. Defaults to `inline`. */
  placement?: 'inline' | 'floating';
  /**
   * `floating` only: pixels to lift the card off the bottom edge, for screens
   * that already have chrome down there (a tab bar, a sticky cart button). A
   * notice that appears behind the tab bar is the same silence this primitive
   * exists to fix, so screens with bottom chrome must pass this.
   */
  offsetBottom?: number;
};

export type UseNoticeResult = {
  /** Shows a notice, replacing any notice already on screen. */
  showNotice: (request: NoticeRequest) => void;
  /** Clears the current notice. Safe to call when nothing is showing. */
  dismissNotice: () => void;
  /**
   * Render this once in the screen's tree. Unlike `confirmDialog` this is never
   * null — the empty live region has to stay mounted (see above).
   */
  notice: ReactElement;
};

type ActiveNotice = NoticeRequest & { tone: NoticeTone; key: number };

export function useNotice(options: UseNoticeOptions = {}): UseNoticeResult {
  const placement = options.placement ?? 'inline';
  const offsetBottom = options.offsetBottom ?? 0;
  const [active, setActive] = useState<ActiveNotice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(0);
  // A notice is commonly raised by work that also navigates away, which
  // unmounts this screen mid-await; without this the trailing setState from the
  // auto-dismiss timer would fire on an unmounted tree.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const dismissNotice = useCallback(() => {
    // Cleared synchronously, before the mounted guard, so a replacement notice
    // can never be cut short by the previous notice's timer.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!mountedRef.current) {
      return;
    }

    setActive(null);
  }, []);

  const showNotice = useCallback((request: NoticeRequest) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!mountedRef.current) {
      return;
    }

    const tone = request.tone ?? 'info';
    keyRef.current += 1;
    // The key changes on every show, so re-raising the same notice remounts the
    // text node. Without it, tapping a blocked button twice would leave the DOM
    // untouched and the live region would stay silent the second time.
    setActive({ ...request, tone, key: keyRef.current });

    // iOS has no live-region equivalent; VoiceOver only speaks what it is told.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(
        request.message ? `${request.title}. ${request.message}` : request.title
      );
    }

    const durationMs = resolveNoticeDurationMs(tone, request.durationMs);

    if (durationMs !== null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;

        if (mountedRef.current) {
          setActive(null);
        }
      }, durationMs);
    }
  }, []);

  const notice = useMemo(() => {
    const tone = active?.tone ?? null;
    const tonePalette = tone ? TONE_STYLES[tone] : null;

    return (
      <View
        // `box-none` so the idle host — and, on `floating`, the padded area
        // around the card — never swallows a tap meant for the screen behind it.
        pointerEvents="box-none"
        style={
          placement === 'floating'
            ? [styles.floatingHost, offsetBottom > 0 ? { bottom: offsetBottom } : null]
            : styles.inlineHost
        }
      >
        <View
          aria-live={noticeLiveRegion(tone)}
          pointerEvents="box-none"
          role={noticeRole(tone)}
          style={placement === 'floating' ? styles.floatingRegion : undefined}
        >
          {active && tonePalette ? (
            <View
              key={active.key}
              pointerEvents="auto"
              style={[styles.card, tonePalette.card]}
              testID={`feasty-notice-${active.tone}`}
            >
              <View style={[styles.accent, tonePalette.accent]} />
              <View style={styles.copy}>
                <RNText style={styles.title}>{active.title}</RNText>
                {active.message ? <RNText style={styles.message}>{active.message}</RNText> : null}
              </View>
              <Pressable
                aria-label="Dismiss notice"
                hitSlop={8}
                onPress={dismissNotice}
                role="button"
                style={({ pressed }) => [styles.dismiss, pressed ? styles.dismissPressed : null]}
              >
                <RNText style={styles.dismissLabel}>Dismiss</RNText>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    );
  }, [active, dismissNotice, offsetBottom, placement]);

  return { showNotice, dismissNotice, notice };
}

const toneStyles = StyleSheet.create({
  successCard: {
    backgroundColor: brand.primaryTint,
    borderColor: brand.primarySoft,
  },
  successAccent: {
    backgroundColor: status.success,
  },
  errorCard: {
    backgroundColor: status.dangerSoft,
    borderColor: status.danger,
  },
  errorAccent: {
    backgroundColor: status.danger,
  },
  infoCard: {
    backgroundColor: surface.muted,
    borderColor: border.default,
  },
  infoAccent: {
    backgroundColor: brand.primary,
  },
});

/**
 * Every card background here is in `a11y.lightSurfaces`, so `text.primary` and
 * `text.secondary` are already proven to clear 4.5:1 on all three tones by
 * `color.test.ts`. The tone is carried by the fill and the accent bar, never by
 * the text color — `status.danger` as red body text would fail on its own tint.
 */
const TONE_STYLES: Record<NoticeTone, { card: ViewStyle; accent: ViewStyle }> = {
  success: { card: toneStyles.successCard, accent: toneStyles.successAccent },
  error: { card: toneStyles.errorCard, accent: toneStyles.errorAccent },
  info: { card: toneStyles.infoCard, accent: toneStyles.infoAccent },
};

const styles = StyleSheet.create({
  inlineHost: {
    width: '100%',
  },
  floatingHost: {
    bottom: 0,
    left: 0,
    padding: space.lg,
    position: 'absolute',
    right: 0,
    // Above the in-screen chrome (the restaurant screen's cart footer sits at
    // 30) so a notice is never hidden behind a floating button.
    zIndex: 40,
  },
  floatingRegion: {
    alignItems: 'center',
  },
  card: {
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space.md,
    maxWidth: 460,
    overflow: 'hidden',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    width: '100%',
  },
  accent: {
    borderRadius: radius.pill,
    marginTop: space.xs,
    width: 3,
    alignSelf: 'stretch',
  },
  copy: {
    flex: 1,
    gap: space.hair,
  },
  title: {
    color: textColor.primary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  message: {
    color: textColor.secondary,
    fontSize: 13,
    lineHeight: 19,
  },
  dismiss: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.sm,
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    paddingHorizontal: space.sm,
  },
  dismissPressed: {
    opacity: 0.7,
  },
  dismissLabel: {
    color: textColor.secondary,
    fontSize: 13,
    fontWeight: '700',
  },
});

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';

import { border, overlay, status, surface, text as textColor } from '../tokens/color';
import { radius } from '../tokens/radius';
import { MIN_TAP_TARGET, space } from '../tokens/space';

/**
 * A promise-based confirmation dialog that behaves identically on iOS, Android
 * and web.
 *
 * WHY THIS EXISTS: every destructive confirmation in the apps used to go through
 * `Alert.alert`. In `react-native-web` `Alert` is
 * `class Alert { static alert() {} }` — an empty function — so on the customer
 * (app.feasty.com.ng) and partner (partner.feasty.com.ng) web builds those
 * dialogs, and the error alerts behind them, were silently no-ops. The
 * account-deletion control that Apple Guideline 5.1.1(v) and Google Play require
 * therefore did nothing at all on web.
 *
 * `Modal` is used rather than `window.confirm` because react-native-web
 * implements it properly — portal, `role="dialog"`, `aria-modal`, Escape wired to
 * `onRequestClose`, a tab focus trap that focuses the first focusable descendant
 * on open and restores focus to the trigger on close — so one code path serves
 * every platform and the dialog is styled like the app instead of like browser
 * chrome. `window.confirm` would also have been blocking, unstyleable, and unable
 * to show a pending state.
 *
 * Deliberately built on plain `react-native` `Text` rather than this package's
 * `Text` primitive: that primitive pins `fontFamily` to the FEASTY faces, which
 * only the apps calling `useFeastyFonts()` have loaded. This component has to be
 * safe in every app, so it inherits whatever family the host app uses and takes
 * only color/size/spacing from the token layer.
 */

export type ConfirmRequest = {
  /** Dialog heading. Also the dialog's accessible name. */
  title: string;
  /** Body copy, one entry per paragraph. */
  paragraphs: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirm button in the danger role. Defaults to `false`. */
  destructive?: boolean;
  /**
   * Optional work to run while the dialog stays open with both buttons
   * disabled, which is what makes a double-tap unable to fire twice.
   * Resolving closes the dialog and resolves `confirm()` with `true`;
   * throwing closes the dialog and makes `confirm()` reject with that error,
   * so the caller renders it inline.
   */
  onConfirm?: () => Promise<unknown> | unknown;
};

export type UseConfirmResult = {
  /**
   * Opens the dialog. Resolves `true` once confirmed (and, when `onConfirm` is
   * supplied, once that work has succeeded), `false` if the user cancelled,
   * dismissed with Escape, pressed the Android back button, or tapped the
   * scrim. Rejects only with an error thrown by `onConfirm`.
   */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** Render this once anywhere in the screen's tree. */
  confirmDialog: ReactElement | null;
};

type Settle = {
  resolve: (confirmed: boolean) => void;
  reject: (error: unknown) => void;
};

export function useConfirm(): UseConfirmResult {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // The guard that actually prevents a double fire. `busy` is state, so two
  // taps landing in the same tick both read the stale `false` from their
  // closure before React re-renders, and `onConfirm` runs twice — verified in a
  // browser: three fast clicks produced three calls. A ref updates
  // synchronously, so the second tap sees the first. `busy` is kept purely to
  // drive the rendered disabled/spinner state.
  const busyRef = useRef(false);
  const settleRef = useRef<Settle | null>(null);
  // `onConfirm` commonly navigates away (the delete flow lands on /login), which
  // unmounts this screen mid-await. Without this guard the trailing setState
  // would fire on an unmounted tree.
  const mountedRef = useRef(true);
  // Web only. On native this stays a plain View ref with no `focus`, so the
  // optional call below is a no-op there.
  const cardRef = useRef<View | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      busyRef.current = false;
      // A screen torn down with the dialog still open must not leave the caller
      // awaiting forever. An unmount is a dismissal, and dismissal is cancel.
      settleRef.current?.resolve(false);
      settleRef.current = null;
    };
  }, []);

  // Runs after react-native-web's own focus trap has settled on the scrim, and
  // moves focus onto the labelled dialog card instead.
  useEffect(() => {
    if (!request) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const node = cardRef.current as unknown as { focus?: () => void } | null;
      node?.focus?.();
    });

    return () => cancelAnimationFrame(frame);
  }, [request]);

  const close = useCallback(() => {
    // Cleared before the mounted guard: an unmounted screen must still leave
    // the ref false, or a remount would start out permanently busy.
    busyRef.current = false;

    if (!mountedRef.current) {
      return;
    }

    setRequest(null);
    setBusy(false);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    // Defensive: a second open while one is pending cancels the first rather
    // than orphaning its promise.
    settleRef.current?.resolve(false);
    settleRef.current = null;

    return new Promise<boolean>((resolve, reject) => {
      settleRef.current = { resolve, reject };
      busyRef.current = false;
      setRequest(next);
      setBusy(false);
    });
  }, []);

  const handleCancel = useCallback(() => {
    // Cancel is inert while the confirmed work is in flight: the request has
    // already left, so pretending it can be called off would be a lie.
    if (busyRef.current) {
      return;
    }

    const settle = settleRef.current;
    settleRef.current = null;
    close();
    settle?.resolve(false);
  }, [close]);

  const handleConfirm = useCallback(async () => {
    if (busyRef.current || !request) {
      return;
    }

    const settle = settleRef.current;

    if (!request.onConfirm) {
      settleRef.current = null;
      close();
      settle?.resolve(true);
      return;
    }

    // Set synchronously, before the first await, so a same-tick repeat tap is
    // rejected by the guard above.
    busyRef.current = true;
    setBusy(true);

    try {
      await request.onConfirm();
      settleRef.current = null;
      close();
      settle?.resolve(true);
    } catch (error) {
      settleRef.current = null;
      close();
      settle?.reject(error);
    }
  }, [close, request]);

  const confirmDialog = useMemo(() => {
    if (!request) {
      return null;
    }

    const destructive = request.destructive ?? false;

    return (
      <Modal
        // "none", not "fade", and this is load-bearing on web. Under an
        // animated type react-native-web only fires `onShow` from the DOM
        // `animationend` event, and until `onShow` lands the modal is not
        // "active": it renders without `role="dialog"` and its focus trap stays
        // disarmed, so focus never enters the dialog and Tab walks straight out
        // into the page behind it. Verified in a browser against the real web
        // build — with "fade" the dialog's outer element had `role` null and
        // `document.activeElement` was still the trigger. With "none" the modal
        // activates synchronously on mount, so the role, the trap and the
        // focus-restore-on-close are all guaranteed.
        animationType="none"
        // Escape (web) and the Android hardware back button both route to
        // `onRequestClose`, i.e. to cancel — the safe default.
        onRequestClose={handleCancel}
        transparent
        visible
      >
        <View style={styles.root}>
          {/* The scrim. `tabIndex={-1}` is required, not cosmetic:
              react-native-web's Pressable defaults to tabIndex 0 and ignores
              `focusable`, so without it the scrim joins the tab order as an
              unlabelled full-screen div. `-1` keeps it out of the tab order —
              but it is still programmatically focusable, so react-native-web's
              trap, which takes the FIRST focusable descendant, still lands here
              on open. That is why the card below is focused explicitly. */}
          <Pressable
            accessible={false}
            aria-hidden
            focusable={false}
            importantForAccessibility="no"
            onPress={handleCancel}
            style={StyleSheet.absoluteFill}
            tabIndex={-1}
          />
          <View
            aria-label={request.title}
            aria-modal
            ref={cardRef}
            role="alertdialog"
            style={styles.card}
            // WAI-ARIA's dialog pattern: when no single control is the obvious
            // starting point, focus the dialog itself. Landing here means a
            // screen reader announces "Delete account, alert dialog" and its
            // body, instead of the unlabelled scrim.
            tabIndex={-1}
          >
            <RNText style={styles.title}>{request.title}</RNText>
            <ScrollView
              contentContainerStyle={styles.bodyContent}
              style={styles.body}
              // Long destructive copy must stay reachable on a short screen.
            >
              {request.paragraphs.map((paragraph, index) => (
                <RNText key={`${index}-${paragraph.slice(0, 24)}`} style={styles.paragraph}>
                  {paragraph}
                </RNText>
              ))}
            </ScrollView>
            <View style={styles.actions}>
              {/* Cancel comes first so the focus trap's "first focusable
                  descendant" is the safe choice, not the destructive one. */}
              <Pressable
                accessibilityState={{ disabled: busy }}
                aria-label={request.cancelLabel}
                disabled={busy}
                onPress={handleCancel}
                role="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.cancelButton,
                  pressed && !busy ? styles.buttonPressed : null,
                  busy ? styles.buttonDisabled : null,
                ]}
              >
                <RNText style={styles.cancelLabel}>{request.cancelLabel}</RNText>
              </Pressable>
              <Pressable
                accessibilityState={{ busy, disabled: busy }}
                aria-label={request.confirmLabel}
                disabled={busy}
                onPress={handleConfirm}
                role="button"
                style={({ pressed }) => [
                  styles.button,
                  destructive ? styles.confirmButtonDestructive : styles.confirmButton,
                  pressed && !busy ? styles.buttonPressed : null,
                  busy ? styles.buttonDisabled : null,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={textColor.onBrand} size="small" />
                ) : (
                  <RNText style={styles.confirmLabel}>{request.confirmLabel}</RNText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }, [busy, handleCancel, handleConfirm, request]);

  return { confirm, confirmDialog };
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: overlay.scrim,
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    backgroundColor: surface.default,
    borderColor: border.subtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    maxHeight: '85%',
    maxWidth: 420,
    padding: space.xl,
    width: '100%',
  },
  title: {
    color: textColor.primary,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: space.md,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: space.md,
    paddingBottom: space.xs,
  },
  paragraph: {
    color: textColor.secondary,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    backgroundColor: surface.muted,
    borderColor: border.default,
    borderWidth: 1,
  },
  cancelLabel: {
    color: textColor.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: textColor.primary,
  },
  confirmButtonDestructive: {
    backgroundColor: status.danger,
  },
  confirmLabel: {
    color: textColor.onBrand,
    fontSize: 15,
    fontWeight: '700',
  },
});

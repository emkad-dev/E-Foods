import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { brand, border, overlay, surface, text as textColor } from '../tokens/color';
import { radius } from '../tokens/radius';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import { buildAuthPromptHref } from './authPromptRoute';

/**
 * The point-of-action sign-in prompt: "Sign in / Sign up / Not now".
 *
 * WHY THIS EXISTS: the customer app's `promptForAuth` was built on
 * `Alert.alert`. In `react-native-web` `Alert` is
 * `class Alert { static alert() {} }` — an empty function — so on
 * app.feasty.com.ng every point-of-action prompt was a silent no-op: the
 * visitor tapped the heart, or Place order, and nothing happened at all. The
 * `Alert` version also pushed `/login` with no `redirectTo`, so on native, where
 * it did render, signing in dumped the visitor somewhere other than the screen
 * they were on.
 *
 * This is the sibling of `useConfirm` in `ConfirmDialog.tsx` and deliberately
 * copies its hard-won web details — see the comments on `animationType`, the
 * scrim's `tabIndex`, and the synchronous ref guard below. Two differences:
 * there are three actions rather than two, and it resolves nothing. Navigation
 * is fire-and-forget, so `promptForAuth` returns `void` and callers do not await
 * it.
 *
 * Like `ConfirmDialog`, this is built on plain `react-native` `Text` rather than
 * this package's `Text` primitive: that primitive pins `fontFamily` to the
 * FEASTY faces, which only apps calling `useFeastyFonts()` have loaded.
 */

export type AuthPromptRequest = {
  /** Dialog heading. Also the dialog's accessible name. */
  title: string;
  /** One line of body copy explaining why signing in is being asked for now. */
  message: string;
  /**
   * Where to send the visitor once they have signed in — normally the screen
   * they are standing on, so tapping a heart on a restaurant page returns them
   * to that restaurant. Passed through to `/login` and `/register` as the
   * `redirectTo` param those screens already read.
   */
  redirectTo?: string;
};

export type UseAuthPromptResult = {
  /** Opens the prompt. Fire-and-forget: navigation, not a promise. */
  promptForAuth: (request: AuthPromptRequest) => void;
  /** Render this once anywhere in the screen's tree. */
  authPromptDialog: ReactElement | null;
};

export function useAuthPrompt(): UseAuthPromptResult {
  const router = useRouter();
  const [request, setRequest] = useState<AuthPromptRequest | null>(null);
  // The guard that actually prevents a double navigation. State is no good
  // here: two taps landing in the same tick both read the stale value from
  // their closure before React re-renders, and both push a route. A ref is
  // updated synchronously, so the second tap sees the first — the same defect,
  // and the same fix, as the `busyRef` in `ConfirmDialog`.
  const navigatingRef = useRef(false);
  // Navigating away unmounts the screen that owns this hook mid-teardown;
  // without this the trailing setState would fire on an unmounted tree.
  const mountedRef = useRef(true);
  // Web only. On native this stays a plain View ref with no `focus`, so the
  // optional call below is a no-op there.
  const cardRef = useRef<View | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      navigatingRef.current = false;
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
    // the ref false, or a remount would start out permanently inert.
    navigatingRef.current = false;

    if (!mountedRef.current) {
      return;
    }

    setRequest(null);
  }, []);

  const promptForAuth = useCallback((next: AuthPromptRequest) => {
    navigatingRef.current = false;
    setRequest(next);
  }, []);

  const handleDismiss = useCallback(() => {
    if (navigatingRef.current) {
      return;
    }

    close();
  }, [close]);

  const navigate = useCallback(
    (target: 'signIn' | 'signUp') => {
      if (navigatingRef.current || !request) {
        return;
      }

      // Set synchronously, before the push, so a same-tick repeat tap is
      // rejected by the guard above.
      navigatingRef.current = true;
      const href = buildAuthPromptHref(target, request.redirectTo);

      // Closed first: `router.push` may keep this screen mounted underneath the
      // auth screen, and a dialog left visible over it would trap focus there.
      // `navigatingRef` deliberately stays true — the next `promptForAuth` call
      // (and unmount) resets it, so nothing between here and then can push a
      // second route off the dialog that is already on its way out.
      setRequest(null);
      router.push(href as never);
    },
    [request, router]
  );

  const authPromptDialog = useMemo(() => {
    if (!request) {
      return null;
    }

    return (
      <Modal
        // "none", not "fade", and this is load-bearing on web. Under an
        // animated type react-native-web only fires `onShow` from the DOM
        // `animationend` event, and until `onShow` lands the modal is not
        // "active": it renders without `role="dialog"` and its focus trap stays
        // disarmed, so focus never enters the dialog and Tab walks straight out
        // into the page behind it. With "none" the modal activates
        // synchronously on mount, so the role, the trap and the
        // focus-restore-on-close are all guaranteed.
        animationType="none"
        // Escape (web) and the Android hardware back button both route here,
        // i.e. to "Not now" — the safe default for a prompt nobody asked for.
        onRequestClose={handleDismiss}
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
            onPress={handleDismiss}
            style={StyleSheet.absoluteFill}
            tabIndex={-1}
          />
          <View
            aria-label={request.title}
            aria-modal
            ref={cardRef}
            role="dialog"
            style={styles.card}
            // WAI-ARIA's dialog pattern: when no single control is the obvious
            // starting point, focus the dialog itself, so a screen reader
            // announces the title and body instead of the unlabelled scrim.
            tabIndex={-1}
          >
            <RNText style={styles.title}>{request.title}</RNText>
            <RNText style={styles.message}>{request.message}</RNText>
            <View style={styles.actions}>
              <Pressable
                aria-label="Sign in"
                onPress={() => navigate('signIn')}
                role="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.signInButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <RNText style={styles.signInLabel}>Sign in</RNText>
              </Pressable>
              <Pressable
                aria-label="Sign up"
                onPress={() => navigate('signUp')}
                role="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.signUpButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <RNText style={styles.signUpLabel}>Sign up</RNText>
              </Pressable>
              <Pressable
                aria-label="Not now"
                onPress={handleDismiss}
                role="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.dismissButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <RNText style={styles.dismissLabel}>Not now</RNText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }, [handleDismiss, navigate, request]);

  return { promptForAuth, authPromptDialog };
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
  message: {
    color: textColor.secondary,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    // Stacked, not a three-across row: three labels side by side wrap and
    // crowd below the smallest phone width this app supports.
    gap: space.md,
    marginTop: space.xl,
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  signInButton: {
    backgroundColor: brand.primary,
  },
  signInLabel: {
    color: textColor.onBrand,
    fontSize: 15,
    fontWeight: '700',
  },
  signUpButton: {
    backgroundColor: surface.muted,
    borderColor: border.default,
    borderWidth: 1,
  },
  signUpLabel: {
    color: textColor.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  dismissButton: {
    backgroundColor: 'transparent',
  },
  dismissLabel: {
    color: textColor.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
});

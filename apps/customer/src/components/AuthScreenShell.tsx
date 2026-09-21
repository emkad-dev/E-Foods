import { ReactNode, forwardRef, useImperativeHandle, useRef } from 'react';
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { elevation, radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';
import { pageTitleTextStyle } from '../theme/screenChrome';
import AuthLegalFooter from './AuthLegalFooter';

type AuthScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /**
   * Height of a transparent navigation header sitting above this screen, so a
   * card taller than the viewport does not scroll up underneath it.
   */
  topInset?: number;
};

/**
 * What a screen can ask of the card it is rendered in. Reached through a `ref`,
 * so a screen that passes none — which is four of the six screens using this
 * shell, none of them touched by this pass — gets exactly the component it got
 * before.
 */
export type AuthScreenShellHandle = {
  /**
   * Bring the top of the card into view.
   *
   * WHY THIS EXISTS: every screen in here renders its one error surface as the
   * first thing in the card body, and the submit button is at the bottom of a
   * form that scrolls. Measured on /register at 375x812, pressing "Create
   * account" on an incomplete form put the message at y=-141 — present in the
   * DOM, correct, announced to a screen reader by `role="alert"`, and invisible
   * to everybody else. That is the same "the message exists but never reaches
   * the person" defect these screens were cleaned up to remove, arrived at from
   * a new direction.
   *
   * `scrollTo` rather than `scrollIntoView`: the latter is a DOM method and
   * this has to work on the native builds too.
   *
   * A no-op when the card is already at the top, which is the cheap and
   * sufficient test for "the error is already on screen" — the error surface is
   * the first thing in the body, so it can only be scrolled off the top edge,
   * and only when there is an offset to scroll off by. On a short screen like
   * sign-in at 375x812 the content does not scroll at all, so this never moves
   * anything.
   */
  scrollToTop: () => void;
};

/**
 * Centered card layout shared by the sign in and sign up screens.
 * The gradient runs from a green tint into a warm orange one so the brand
 * colours frame the card without competing with the form inside it.
 */
const AuthScreenShell = forwardRef<AuthScreenShellHandle, AuthScreenShellProps>(function AuthScreenShell(
  { title, subtitle, children, topInset = 0 },
  ref
) {
  const scrollRef = useRef<ScrollView>(null);
  // Held in a ref, not state: nothing renders from it, and re-rendering the
  // whole card on every scroll frame to store a number would be the kind of
  // cost this fix does not need to carry.
  const offsetRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: () => {
        if (offsetRef.current <= 0) return;
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      },
    }),
    []
  );

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  };

  return (
    <LinearGradient
      colors={[customerTheme.accentTint, customerTheme.background, '#fff4e6']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.screen}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scrollContent, topInset ? { paddingTop: topInset + 20 } : null]}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        // Continuous events on iOS; without it `onScroll` fires once per
        // gesture and the offset above goes stale mid-scroll.
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View accessible accessibilityRole="image" accessibilityLabel="FEASTY" style={styles.brand}>
            <Image
              source={require('../../assets/images/feasty-pizza.png')}
              style={styles.brandMark}
              resizeMode="contain"
            />
            <Text style={styles.wordmark}>
              <Text style={styles.wordmarkGreen}>FEAST</Text>
              <Text style={styles.wordmarkOrange}>Y</Text>
            </Text>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.body}>{children}</View>

          <AuthLegalFooter />
        </View>
      </ScrollView>
    </LinearGradient>
  );
});

export default AuthScreenShell;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    ...elevation.lg,
    alignSelf: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
  brand: {
    alignItems: 'center',
    marginBottom: 18,
  },
  brandMark: {
    height: 58,
    width: 64,
  },
  wordmark: {
    fontSize: 26,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 30,
    marginTop: 8,
  },
  wordmarkGreen: {
    color: customerTheme.brandGreen,
  },
  wordmarkOrange: {
    color: customerTheme.brandOrange,
  },
  title: {
    ...pageTitleTextStyle,
    letterSpacing: -0.4,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  body: {
    width: '100%',
  },
});

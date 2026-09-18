import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { FontAwesome } from '@expo/vector-icons';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type SuccessBannerProps = {
  /** Rendered only when a message is present, so callers can pass state directly. */
  message?: string | null;
  title?: string;
  onDismiss?: () => void;
};

/** Strong ease-out — the built-in curves are too weak to read as intentional. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Inline confirmation for success states. Replaces blocking Alert dialogs so the
 * user can read the result and keep moving.
 *
 * Uses RN's Animated rather than Reanimated's `entering`: `entering` holds the
 * node at `visibility: hidden` until it runs, so anything that stalls the
 * animation hides the confirmation outright. Driving opacity ourselves means the
 * worst case is an un-animated banner, not an invisible one.
 */
export default function SuccessBanner({ message, title = 'Done', onDismiss }: SuccessBannerProps) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) {
      progress.setValue(0);
      return;
    }

    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    Animated.timing(progress, {
      duration: 240,
      easing: EASE_OUT,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [message, progress, reduceMotion]);

  if (!message) {
    return null;
  }

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
        },
      ]}
    >
      <View style={styles.iconWrap}>
        <FontAwesome name="check" size={13} color={customerTheme.textOnBrand} />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>

      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          onPress={onDismiss}
          style={styles.dismiss}
        >
          <FontAwesome name="times" size={14} color={customerTheme.textSoft} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: customerTheme.accentTint,
    borderColor: customerTheme.accentSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    padding: 14,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.brandGreen,
    borderRadius: radius.pill,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
    width: 22,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: customerTheme.accentStrong,
    fontSize: 14,
    fontWeight: '800',
  },
  message: {
    color: customerTheme.text,
    fontSize: 13,
    lineHeight: 19,
  },
  dismiss: {
    alignItems: 'center',
    // A 2pt padding around a 14pt glyph is an 18pt target -- the smallest in the
    // customer app. It carried hitSlop={10}, which is exactly the trap: on
    // the web build RNW 0.21 reads hitSlop only from the legacy Touchable
    // mixin, so the one thing standing between this and an 18pt button did
    // nothing at all on app.feasty.com.ng. The hitSlop stays for native, where
    // it still widens the target beyond the floor.
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    padding: 2,
  },
});

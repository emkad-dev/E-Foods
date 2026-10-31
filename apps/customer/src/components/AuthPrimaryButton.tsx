import { useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { BusyLabel, radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type AuthPrimaryButtonProps = {
  disabled?: boolean;
  /** Shows a spinner beside the label. Implies disabled. */
  busy?: boolean;
  label: string;
  onPress: () => void;
};

/** Strong ease-out — the built-in curves are too weak to read as intentional. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Primary auth CTA. Scales to 0.97 while held so the button confirms the press
 * immediately; the release is slightly slower than the press so it settles.
 */
export default function AuthPrimaryButton({ disabled: disabledProp = false, busy = false, label, onPress }: AuthPrimaryButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const disabled = disabledProp || busy;

  const animateTo = (toValue: number, duration: number) => {
    Animated.timing(scale, {
      duration,
      easing: EASE_OUT,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animateTo(0.97, 120)}
        onPressOut={() => animateTo(1, 160)}
        style={[styles.button, disabled && !busy ? styles.buttonDisabled : null, busy ? styles.buttonBusy : null]}
      >
        <BusyLabel busy={busy} label={label} textStyle={styles.label} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  // Lighter than disabled: busy means "working on it", not "you can't".
  buttonBusy: {
    opacity: 0.85,
  },
  label: {
    color: customerTheme.textOnBrand,
    fontSize: 16,
    fontWeight: '700',
  },
});

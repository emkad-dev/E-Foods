import { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type AuthTextFieldProps = TextInputProps & {
  /**
   * Visible label above the box, and the field's accessible name.
   *
   * Every auth field used to be identified by its placeholder and nothing else.
   * A placeholder is gone the instant someone types, so a half-filled form could
   * not be read back after an interruption, and a screen reader had only the
   * value to announce. The same string is mirrored into `accessibilityLabel`
   * (which `react-native-web` renders as `aria-label`) so the name exists on
   * both targets rather than only where the pixels happen to be.
   *
   * Optional on purpose: `forgot-password` is a single email box under a
   * subtitle that already names it, and it is outside this pass. Omitting the
   * label leaves that screen rendering exactly what it rendered before.
   */
  label?: string;
  /** Quiet line under the box — what the value is for, or how it will be stored. */
  hint?: string;
  /** Layout for the whole label/box/hint group. `style` still targets the box. */
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Text input shared by the auth screens. Border colour is the only thing that
 * changes on focus — the width stays at 1 so focusing never shifts layout.
 */
export default function AuthTextField({
  containerStyle,
  hint,
  label,
  style,
  onFocus,
  onBlur,
  ...rest
}: AuthTextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        // Before `{...rest}` so a caller can still override it, and only set when
        // there is a label to mirror — an empty accessible name is worse than
        // none, because it suppresses the fallback the platform would derive.
        accessibilityLabel={label}
        placeholderTextColor={customerTheme.textMuted}
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, focused ? styles.inputFocused : null, style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: customerTheme.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputFocused: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.accent,
  },
  hint: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
});

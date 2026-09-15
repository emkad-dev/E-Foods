import { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

/**
 * Text input shared by the auth screens. Border colour is the only thing that
 * changes on focus — the width stays at 1 so focusing never shifts layout.
 */
export default function AuthTextField({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
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
  );
}

const styles = StyleSheet.create({
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
});

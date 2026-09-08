import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { border, status, surface, text as textColor } from '../tokens/color';
import { MIN_TAP_TARGET, space } from '../tokens/space';
import { radius } from '../tokens/radius';
import { typeScale } from '../tokens/type';
import { Text } from './Text';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** Renders in danger tone below the field and marks the field invalid. */
  error?: string;
  hint?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerStyle?: ViewStyle;
};

export function Input({
  label,
  error,
  hint,
  leading,
  trailing,
  containerStyle,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const invalid = Boolean(error);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="callout" tone="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          focused ? styles.focused : null,
          invalid ? styles.invalid : null,
        ]}
      >
        {leading}
        <TextInput
          {...rest}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          // RN has no cross-platform "invalid" flag; surface it in the hint so
          // screen readers announce the error alongside the field.
          accessibilityHint={error ?? rest.accessibilityHint}
          placeholderTextColor={textColor.disabled}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {trailing}
      </View>

      {error ? (
        <Text variant="callout" tone="primary" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="callout" tone="secondary" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: space.xs,
  },
  field: {
    minHeight: MIN_TAP_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: surface.default,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: border.default,
  },
  focused: {
    borderColor: border.focus,
    borderWidth: 2,
  },
  invalid: {
    borderColor: status.danger,
  },
  input: {
    flex: 1,
    ...typeScale.body,
    color: textColor.primary,
    // Android adds vertical padding that breaks the 44pt alignment.
    paddingVertical: 0,
  },
  error: {
    marginTop: space.xs,
    color: status.danger,
  },
  hint: {
    marginTop: space.xs,
  },
});

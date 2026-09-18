import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
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
  const inputRef = useRef<TextInput>(null);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="callout" tone="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      {/* Pressable, not View. The field is inset 14pt on each side so the
          text clears the border, and that inset belonged to nobody: a tap on
          it landed on the wrapper and focused nothing, on a control that is
          unmistakably a text field. Focusing from here gives the whole 315pt
          box to the input without moving the text off the border.

          Guarded on `focused` because calling focus() on an already-focused
          input can move the caret -- the press that lands inside the input
          itself must be left alone to place the cursor where the user aimed. */}
      <Pressable
        accessible={false}
        onPress={() => {
          if (!focused) {
            inputRef.current?.focus();
          }
        }}
        style={[
          styles.field,
          focused ? styles.focused : null,
          invalid ? styles.invalid : null,
        ]}
      >
        {leading}
        <TextInput
          ref={inputRef}
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
      </Pressable>

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
    /** A border, not words — the fill red is the right colour here and stays. */
    borderColor: status.danger,
  },
  input: {
    flex: 1,
    ...typeScale.body,
    color: textColor.primary,
    // Android adds vertical padding that breaks the 44pt alignment.
    paddingVertical: 0,
    /**
     * WITHOUT THIS THE FIELD IS A LIE. The wrapper above is 48pt with
     * `alignItems: 'center'`, and zeroing the padding leaves the TextInput at
     * exactly its line box -- measured on the web build at 287x22 inside a
     * 315x48 box. The 13pt above and below looked like field and was not:
     * dispatching a real pointer sequence there left `document.activeElement`
     * on `body`, so a tap near the top or bottom edge of something that is
     * unmistakably a text field did nothing at all.
     *
     * Stretching the input across the wrapper's cross axis hands those 26pt to
     * the control itself. `leading` and `trailing` keep the wrapper's
     * centring because this overrides `alignItems` for one child only, and
     * `textAlignVertical` keeps Android's text centred now that the box is
     * taller than the line -- which is what the zeroed padding was protecting
     * in the first place.
     */
    alignSelf: 'stretch',
    textAlignVertical: 'center',
  },
  error: {
    marginTop: space.xs,
    /**
     * `dangerText`, not `danger`. This is the line that tells someone why their
     * form was rejected, and it renders on whatever surface the field sits on —
     * where the fill red measured 3.52:1 to 4.39:1 on seven of the eight light
     * surfaces the token sweep covers. The message that has to be read was the
     * least readable text in the app.
     */
    color: status.dangerText,
  },
  hint: {
    marginTop: space.xs,
  },
});

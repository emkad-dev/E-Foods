import { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { MIN_PASSWORD_LENGTH } from '../domain/authFormValidation';
import { customerTheme } from '../theme/palette';

type AuthPasswordFieldProps = {
  /** Lets a password manager offer the right entry. */
  autoComplete?: TextInputProps['autoComplete'];
  /** Layout for the whole label/box/hint group. */
  containerStyle?: StyleProp<ViewStyle>;
  editable?: boolean;
  /** Visible label above the box, and the field's accessible name. */
  label?: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  /**
   * Whether this box is the one that SETS a password, and so the one where the
   * length rule is worth stating. Off for sign-in, where the password already
   * exists and a rule about it is noise.
   */
  showHint?: boolean;
  value: string;
};

/**
 * The single true rule, taken from the validator rather than restated.
 *
 * This line used to read "Password must contain alphanumeric characters.
 * Example:`Rider24`,`Dispatch9`..." — literal backticks and a trailing ellipsis
 * rendered to every customer, in a register the app itself does not speak, and
 * describing a constraint nothing enforces. `MIN_PASSWORD_LENGTH` is the only
 * requirement there actually is, so it is interpolated here: change the
 * validator and this sentence changes with it rather than drifting away from it.
 */
const LENGTH_HINT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

export default function AuthPasswordField({
  autoComplete,
  containerStyle,
  editable = true,
  label,
  onChangeText,
  placeholder,
  showHint = false,
  value,
}: AuthPasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);
  // Shown while the box has focus, and kept up afterwards only while what was
  // typed would still be rejected. Permanently-visible helper text is read once
  // and then stops being read at all, which is how the old line survived so
  // long: it was furniture rather than guidance.
  const hintVisible = showHint && (focused || (value.length > 0 && value.length < MIN_PASSWORD_LENGTH));

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.inputWrap, focused ? styles.inputWrapFocused : null]}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete={autoComplete}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={customerTheme.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!showPassword}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <TouchableOpacity
          accessibilityRole="button"
          // The visible word is one of a pair ("Show"/"Hide") and means nothing
          // read on its own, so the announced name says what it acts on.
          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          accessibilityState={{ disabled: !editable }}
          style={styles.toggle}
          onPress={() => setShowPassword((current) => !current)}
          disabled={!editable}
        >
          <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
      </View>
      {hintVisible ? <Text style={styles.hint}>{LENGTH_HINT}</Text> : null}
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
  inputWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 50,
    paddingLeft: 16,
    paddingRight: 8,
  },
  inputWrapFocused: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.accent,
  },
  input: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  // Show/hide password. WCAG 2.5.5 is a 44x44 box, not 44 tall: the label is
  // four characters at 12pt, so the width had to be pinned too. Partner's copy
  // of this component was raised to the height floor earlier in this sweep and
  // customer's was not, which is the whole argument for checking this
  // mechanically rather than by eye.
  toggle: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    paddingVertical: 8,
  },
  toggleText: {
    color: customerTheme.link,
    fontSize: 12,
    fontWeight: '700',
  },
  hint: {
    color: customerTheme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
});

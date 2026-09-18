import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';

type AuthPasswordFieldProps = {
  editable?: boolean;
  onChangeText: (value: string) => void;
  placeholder: string;
  showHint?: boolean;
  value: string;
};

export default function AuthPasswordField({
  editable = true,
  onChangeText,
  placeholder,
  showHint = false,
  value,
}: AuthPasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.inputWrap, focused ? styles.inputWrapFocused : null]}>
        <TextInput
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
        <TouchableOpacity style={styles.toggle} onPress={() => setShowPassword((current) => !current)} disabled={!editable}>
          <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'See password'}</Text>
        </TouchableOpacity>
      </View>
      {showHint ? (
        <Text style={styles.hint}>
          Password must contain alphanumeric characters. Example:`Rider24`,`Dispatch9`...
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 50,
    paddingHorizontal: 16,
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
  // Show/hide password, at 33pt. Partner's copy of this component was raised
  // to the floor earlier in this sweep and customer's was not, which is the
  // whole argument for checking this mechanically rather than by eye.
  toggle: {
    justifyContent: 'center',
    marginLeft: 12,
    minHeight: MIN_TAP_TARGET,
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
    lineHeight: 18,
    marginTop: 8,
  },
});

import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import { partnerTheme } from '../theme/palette';
import { MIN_PASSWORD_LENGTH } from '../domain/authFormValidation';

/**
 * Interpolated from the rule the form actually enforces, so the sentence
 * cannot drift from it again. The string this replaces claimed a
 * composition rule ("alphanumeric characters") that nothing checks, quoted
 * two example passwords with literal backticks around them, and rendered
 * permanently rather than when it could help.
 */
const LENGTH_HINT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

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

  return (
    <View style={styles.wrapper}>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={partnerTheme.textSoft}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!showPassword}
          editable={editable}
        />
        <TouchableOpacity style={styles.toggle} onPress={() => setShowPassword((current) => !current)} disabled={!editable}>
          <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'See password'}</Text>
        </TouchableOpacity>
      </View>
      {showHint ? (
        <Text style={styles.hint}>
          {LENGTH_HINT}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 14,
  },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  input: {
    color: partnerTheme.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  toggle: {
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    marginLeft: 12,
    paddingVertical: 8,
  },
  toggleText: {
    color: partnerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  hint: {
    color: partnerTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});

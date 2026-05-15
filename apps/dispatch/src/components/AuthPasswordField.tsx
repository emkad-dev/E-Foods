import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { dispatchTheme } from '../theme/palette';

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
          placeholderTextColor="#8e8e8e"
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
          Password must contain alphanumeric characters. Example:`Rider24`,`Dispatch9`...
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
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  input: {
    color: dispatchTheme.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  toggle: {
    marginLeft: 12,
    paddingVertical: 8,
  },
  toggleText: {
    color: dispatchTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  hint: {
    color: dispatchTheme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});

import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
    marginBottom: 16,
  },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 50,
    paddingHorizontal: 16,
  },
  input: {
    color: customerTheme.text,
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  toggle: {
    marginLeft: 12,
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

import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { customerTheme } from '../../src/theme/palette';

export default function CompleteProfileScreen() {
  const { error, loading, policyAccepted, updatePhoneNumber, user } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState(String(user?.phoneNumber ?? '').trim());

  useEffect(() => {
    setPhoneNumber(String(user?.phoneNumber ?? '').trim());
  }, [user?.phoneNumber]);

  const handleContinue = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Phone number required', 'Add a phone number to continue.');
      return;
    }

    try {
      await updatePhoneNumber(phoneNumber.trim());
      router.replace((policyAccepted ? '/home' : '/accept-policy') as never);
    } catch (nextError: any) {
      Alert.alert('Save failed', nextError.message ?? 'Unable to save your phone number right now.');
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>FEASTY Customer</Text>
          <Text style={styles.title}>Add your phone number</Text>
          <Text style={styles.copy}>We use this for order updates and rider contact.</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor={customerTheme.textMuted}
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.button, !phoneNumber.trim() ? styles.buttonDisabled : null]}
            onPress={handleContinue}
            disabled={loading || !phoneNumber.trim()}
          >
            <Text style={styles.buttonText}>{loading ? 'Saving...' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    color: customerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: customerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  input: {
    backgroundColor: customerTheme.surfaceMuted,
    borderColor: customerTheme.border,
    borderRadius: 14,
    borderWidth: 1,
    color: customerTheme.text,
    fontSize: 15,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 14,
    marginTop: 16,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});

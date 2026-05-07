import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { adminTheme } from '../../src/theme/palette';

export default function AdminBootstrapScreen() {
  const insets = useSafeAreaInsets();
  const { bootstrapFirstAdmin, clearError, error, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleBootstrap = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing information', 'Enter the allowed bootstrap email and password to continue.');
      return;
    }

    try {
      await bootstrapFirstAdmin(email.trim(), password);
      Alert.alert('Bootstrap complete', 'This account is now the first admin. You can continue into the admin app.');
    } catch (nextError: any) {
      Alert.alert('Bootstrap failed', nextError.message ?? 'Unable to bootstrap the first admin account.');
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>First admin only</Text>
        <Text style={styles.title}>Bootstrap company access</Text>
        <Text style={styles.copy}>
          Use this once, with an email already listed in `BOOTSTRAP_ADMIN_EMAILS`, to mint the first trusted admin claim from inside the sandbox.
        </Text>
      </View>

      <View style={styles.formCard}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Bootstrap admin email"
          placeholderTextColor={adminTheme.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(value) => {
            if (error) {
              clearError();
            }

            setEmail(value);
          }}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={adminTheme.textMuted}
          secureTextEntry
          value={password}
          onChangeText={(value) => {
            if (error) {
              clearError();
            }

            setPassword(value);
          }}
          editable={!loading}
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleBootstrap} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Bootstrapping...' : 'Bootstrap first admin'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" style={styles.link}>
          Back to sign in
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: adminTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: adminTheme.hero,
    borderColor: adminTheme.accentStrong,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: adminTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#ffffff',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#d7e3f3',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: adminTheme.danger,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: adminTheme.cream,
    borderColor: adminTheme.border,
    borderRadius: 16,
    borderWidth: 1,
    color: adminTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: adminTheme.accent,
    borderRadius: 18,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  link: {
    color: adminTheme.accentStrong,
    marginTop: 16,
    textAlign: 'center',
  },
});

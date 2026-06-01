import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { customerTheme } from '../../src/theme/palette';

export default function AcceptPolicyScreen() {
  const { acceptCurrentPolicies, policyLoading } = useAuth();

  const handleAccept = async () => {
    try {
      await acceptCurrentPolicies('customer_policy_gate');
      router.replace('/(customer)/home');
    } catch (error: any) {
      Alert.alert('Policy acceptance failed', error.message ?? 'Unable to save your acceptance right now.');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>FEASTy</Text>
        <Text style={styles.title}>Accept Terms</Text>
        <Text style={styles.copy}>
          Review and accept the current Terms and Privacy Policy before using the customer app.
        </Text>
        <View style={styles.linkRow}>
          <Link href="/(auth)/terms" style={styles.link}>Terms</Link>
          <Text style={styles.dot}>•</Text>
          <Link href="/(auth)/privacy" style={styles.link}>Privacy</Link>
        </View>
        <TouchableOpacity style={styles.button} onPress={handleAccept} disabled={policyLoading}>
          <Text style={styles.buttonText}>{policyLoading ? 'Saving...' : 'I agree'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
  },
  eyebrow: { color: customerTheme.brandGreen, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  title: { color: customerTheme.text, fontSize: 28, fontWeight: '900', marginTop: 8 },
  copy: { color: customerTheme.textMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  linkRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 16 },
  link: { color: customerTheme.link, fontSize: 15, fontWeight: '800' },
  dot: { color: customerTheme.textMuted },
  button: {
    alignItems: 'center',
    backgroundColor: customerTheme.accent,
    borderRadius: 14,
    marginTop: 18,
    paddingVertical: 15,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});

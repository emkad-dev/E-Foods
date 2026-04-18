import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function PartnerRegisterScreen() {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>E-Foods Partner</Text>
          <Text style={styles.title}>Partner access is admin-managed</Text>
          <Text style={styles.copy}>
            Restaurant accounts are no longer self-serve. Ask the platform team to create or invite your store account before you sign in.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What to do next</Text>
          <Text style={styles.cardCopy}>1. Contact the platform admin or onboarding team.</Text>
          <Text style={styles.cardCopy}>2. Share the email that should receive partner access.</Text>
          <Text style={styles.cardCopy}>3. Come back and sign in after the account has been approved.</Text>

          <Link href="/(auth)/login" style={styles.link}>
            Back to partner sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#fff9f0',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: '#fff4dc',
    borderColor: '#f3d8a5',
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: '#9a6400',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#1f2937',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#6b7280',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#f1e0bf',
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  cardTitle: {
    color: '#1f2937',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  cardCopy: {
    color: '#6b7280',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  link: {
    color: '#9a6400',
    marginTop: 18,
    textAlign: 'center',
  },
});

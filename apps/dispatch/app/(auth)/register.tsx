import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DispatchRegisterScreen() {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>E-Fooders</Text>
          <Text style={styles.title}>Dispatch access is admin-managed</Text>
          <Text style={styles.copy}>
            Dispatch accounts are no longer self-serve. Ask the operations lead or platform admin to create or invite this account first.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What to do next</Text>
          <Text style={styles.cardCopy}>1. Contact the dispatch admin or operations lead.</Text>
          <Text style={styles.cardCopy}>2. Share the email that should receive dispatch access.</Text>
          <Text style={styles.cardCopy}>3. Return here and sign in after the account has been approved.</Text>

          <Link href="/(auth)/login" style={styles.link}>
            Back to dispatch sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#111315',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: '#1a1f22',
    borderColor: '#2a2f34',
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: '#d5ff3f',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f6f7f8',
    fontSize: 31,
    fontWeight: '800',
  },
  copy: {
    color: '#b6bcc4',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  card: {
    backgroundColor: '#181c1f',
    borderColor: '#2a2f34',
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  cardTitle: {
    color: '#f6f7f8',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  cardCopy: {
    color: '#b6bcc4',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  link: {
    color: '#d5ff3f',
    marginTop: 18,
    textAlign: 'center',
  },
});

import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { adminTheme } from '../../src/theme/palette';

export default function AdminRegisterInfoScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 28 }]}
    >
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Internal access only</Text>
        <Text style={styles.title}>Admin accounts are company-managed</Text>
        <Text style={styles.copy}>
          Public sign-up is intentionally disabled here. Admin access should be created and approved by the company so
          platform control stays tightly managed.
        </Text>
        <View style={styles.note}>
          <Text style={styles.noteTitle}>Current approval path</Text>
          <Text style={styles.noteLine}>1. Bootstrap the very first admin once with an allowed internal email.</Text>
          <Text style={styles.noteLine}>2. Use the Access tab to provision partner, dispatch, or extra admin accounts.</Text>
          <Text style={styles.noteLine}>3. Staff accounts receive server-issued claims and profile metadata automatically.</Text>
          <Text style={styles.noteLine}>4. Approved operators then sign in with the accounts created inside the sandbox.</Text>
        </View>

        <Link href={'/(auth)/bootstrap' as never} style={styles.link}>
          Bootstrap first admin
        </Link>

        <Link href="/(auth)/login" style={styles.linkSecondary}>
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
  card: {
    backgroundColor: adminTheme.surface,
    borderColor: adminTheme.border,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
  },
  eyebrow: {
    color: adminTheme.accentStrong,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: adminTheme.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 10,
  },
  copy: {
    color: adminTheme.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  note: {
    backgroundColor: adminTheme.surfaceMuted,
    borderRadius: 18,
    marginTop: 18,
    padding: 16,
  },
  noteTitle: {
    color: adminTheme.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  noteLine: {
    color: adminTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  link: {
    color: adminTheme.accentStrong,
    marginTop: 18,
    textAlign: 'center',
  },
  linkSecondary: {
    color: adminTheme.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
});

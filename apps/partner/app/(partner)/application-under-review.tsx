import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

export default function ApplicationUnderReviewScreen() {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>Your application is under review</Text>
        <Text style={styles.copy}>
          Thanks for applying. Our team is checking your details. We will email
          {user?.email ? ` ${user.email}` : ' you'} as soon as your restaurant is approved.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What happens next</Text>
        <Text style={styles.cardLine}>1. We verify your identity and restaurant details.</Text>
        <Text style={styles.cardLine}>2. You get an email with the decision.</Text>
        <Text style={styles.cardLine}>3. Once approved, sign in to set up your menu and go live.</Text>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => void signOut()}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: partnerTheme.background, flex: 1 },
  content: { paddingHorizontal: 20 },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderRadius: 28,
    padding: 24,
  },
  eyebrow: {
    color: partnerTheme.heroSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: { color: '#fffdf8', fontSize: 30, fontWeight: '800' },
  copy: { color: '#e7dbc7', fontSize: 15, lineHeight: 22, marginTop: 10 },
  card: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: 26,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  cardTitle: { color: partnerTheme.text, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  cardLine: { color: partnerTheme.textMuted, fontSize: 14, lineHeight: 22 },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 14,
  },
  secondaryButtonText: { color: partnerTheme.textMuted, fontSize: 14, fontWeight: '700' },
});

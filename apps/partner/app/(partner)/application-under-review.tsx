import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/contexts/AuthContext';
import { partnerTheme } from '../../src/theme/palette';

export default function ApplicationUnderReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const applicationStatus = (user?.partnerApplicationStatus ?? '').trim().toLowerCase();
  const isVerificationFailure =
    applicationStatus === 'rejected' || applicationStatus === 'verification_failed' || applicationStatus === 'verification-failed';

  const statusCopy = useMemo(() => {
    if (isVerificationFailure) {
      return 'We reviewed your submission and need you to update a few details before we can approve the restaurant.';
    }

    return 'We are verifying your business identity, restaurant details, and payout setup. We will email you as soon as the review is complete.';
  }, [isVerificationFailure]);

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
        <Text style={styles.title}>{isVerificationFailure ? 'Update your onboarding details' : 'Your application is under review'}</Text>
        <Text style={styles.copy}>
          {statusCopy}
          {user?.email ? ` We will email ${user.email} when the next step is ready.` : ''}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{isVerificationFailure ? 'What needs to happen next' : 'What happens next'}</Text>
        <Text style={styles.cardLine}>
          1. We verify your identity, restaurant details, and payout information.
        </Text>
        <Text style={styles.cardLine}>
          2. Once verification passes, the restaurant is approved and the payout subaccount is created.
        </Text>
        <Text style={styles.cardLine}>3. After approval, you go straight into the menu builder.</Text>

        {isVerificationFailure ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/complete-restaurant-details')}>
            <Text style={styles.primaryButtonText}>Update details</Text>
          </TouchableOpacity>
        ) : null}

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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: 18,
    marginTop: 20,
    paddingVertical: 14,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
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

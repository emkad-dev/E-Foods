import { ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { elevation } from '@feasty/design-system';
import { customerTheme } from '../theme/palette';
import AuthLegalFooter from './AuthLegalFooter';

type AuthScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /**
   * Height of a transparent navigation header sitting above this screen, so a
   * card taller than the viewport does not scroll up underneath it.
   */
  topInset?: number;
};

/**
 * Centered card layout shared by the sign in and sign up screens.
 * The gradient runs from a green tint into a warm orange one so the brand
 * colours frame the card without competing with the form inside it.
 */
export default function AuthScreenShell({ title, subtitle, children, topInset = 0 }: AuthScreenShellProps) {
  return (
    <LinearGradient
      colors={[customerTheme.accentTint, customerTheme.background, '#fff4e6']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, topInset ? { paddingTop: topInset + 20 } : null]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View accessible accessibilityRole="image" accessibilityLabel="FEASTY" style={styles.brand}>
            <Image
              source={require('../../assets/images/feasty-pizza.png')}
              style={styles.brandMark}
              resizeMode="contain"
            />
            <Text style={styles.wordmark}>
              <Text style={styles.wordmarkGreen}>FEAST</Text>
              <Text style={styles.wordmarkOrange}>Y</Text>
            </Text>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.body}>{children}</View>

          <AuthLegalFooter />
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

/** "Or continue with" rule used between the email form and the Google button. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    ...elevation.lg,
    alignSelf: 'center',
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
  brand: {
    alignItems: 'center',
    marginBottom: 18,
  },
  brandMark: {
    height: 58,
    width: 64,
  },
  wordmark: {
    fontSize: 26,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 30,
    marginTop: 8,
  },
  wordmarkGreen: {
    color: customerTheme.brandGreen,
  },
  wordmarkOrange: {
    color: customerTheme.brandOrange,
  },
  title: {
    color: customerTheme.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  body: {
    width: '100%',
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    marginVertical: 18,
  },
  dividerLine: {
    backgroundColor: customerTheme.border,
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: customerTheme.textMuted,
    fontSize: 13,
    marginHorizontal: 10,
  },
});

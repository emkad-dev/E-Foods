import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MIN_TAP_TARGET, radius } from '@feasty/design-system';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateLoginForm } from '../../src/domain/authFormValidation';
import { resolvePartnerSuccessNotice } from '../../src/utils/successNotices';
import { partnerTheme } from '../../src/theme/palette';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

export default function PartnerLoginScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ notice?: string | string[]; redirectTo?: string | string[] }>();
  const { clearError, error, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : undefined;
  // Confirmations that have to outlive a navigation. Reset-password, register
  // and forgot-password all land here with `notice=<key>` instead of relying on
  // an Alert callback, which never fires on the web build
  // (partner.feasty.com.ng). The keys live in src/utils/successNotices.ts.
  const notice = resolvePartnerSuccessNotice(params.notice);
  // Client-side validation used to go to `Alert`, an empty function on the web
  // build, so an empty submit looked like a dead button. Held locally because
  // `AuthContext` exposes no setter, and rendered through the SAME slot as the
  // context's `error` below, so the screen keeps exactly one error surface.
  const [validationError, setValidationError] = useState<string | null>(null);
  const formError = validationError ?? error;

  const handleEmailChange = (value: string) => {
    if (error) {
      clearError();
    }

    setValidationError(null);
    setEmail(value);
  };

  const handlePasswordChange = (value: string) => {
    if (error) {
      clearError();
    }

    setValidationError(null);
    setPassword(value);
  };

  const handleLogin = async () => {
    const invalid = validateLoginForm({ email, password });

    if (invalid) {
      setValidationError(invalid);
      return;
    }

    setValidationError(null);

    try {
      await signIn(email.trim(), password);
    } catch {
      // `signIn` has already pushed the formatted message into `AuthContext`'s
      // `error`, which the slot above renders; the dead `Alert` that used to
      // sit here added nothing on native and nothing at all on web.
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Partner</Text>
        <Text style={styles.title}>Sign in to your dashboard</Text>
        <Text style={styles.copy}>
          Use your restaurant operations account to manage orders, menu updates, and store performance. We’ll take
          you to the right place after sign in.
        </Text>
      </View>

      <View style={styles.formCard}>
        {notice ? (
          <Text accessibilityLiveRegion="polite" role="alert" style={styles.noticeText}>
            {notice}
          </Text>
        ) : null}
        {formError ? (
          <Text accessibilityLiveRegion="assertive" role="alert" style={styles.errorText}>
            {formError}
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Partner email"
          placeholderTextColor={partnerTheme.textSoft}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={handleEmailChange}
          editable={!loading}
        />
        <AuthPasswordField
          placeholder="Password"
          value={password}
          onChangeText={handlePasswordChange}
          editable={!loading}
          showHint
        />

        <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Open dashboard'}</Text>
        </TouchableOpacity>

        {/* `asChild` so each link is a real box rather than a run of inline
            text. A bare <Link> renders as Text, which react-native-web gives
            `display: inline` -- and CSS ignores min-height on an inline box,
            so the obvious fix does nothing. Each of these was the 14pt default
            line box: 20pt. */}
        <Link
          href={redirectTo ? { pathname: '/(auth)/register', params: { redirectTo } } : '/(auth)/register'}
          asChild
        >
          <Pressable style={styles.linkPressable}>
            <Text style={styles.link}>Need a partner login? Create one</Text>
          </Pressable>
        </Link>
        <Link
          href={redirectTo ? { pathname: '/(auth)/forgot-password', params: { redirectTo } } : '/(auth)/forgot-password'}
          asChild
        >
          <Pressable style={styles.linkPressable}>
            <Text style={styles.linkSecondary}>Forgot password?</Text>
          </Pressable>
        </Link>
        <Pressable style={styles.linkPressable} onPress={() => Linking.openURL('https://feasty.com.ng')}>
          <Text style={styles.linkSecondary}>Looking to order food? Visit feasty.com.ng</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: partnerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: partnerTheme.hero,
    borderColor: partnerTheme.hero,
    borderRadius: radius['2xl'],
    borderWidth: 1,
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
  title: {
    color: partnerTheme.textOnHero,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  copy: {
    color: partnerTheme.textOnHeroMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: partnerTheme.surface,
    borderColor: partnerTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: partnerTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  noticeText: {
    color: partnerTheme.success,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: partnerTheme.cream,
    borderColor: partnerTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: partnerTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: partnerTheme.accent,
    borderRadius: radius.xl,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: partnerTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // The spacing moved off the labels and onto the boxes that now hold them,
  // and shrank: a 44pt box already carries its own air, so keeping the old
  // 16/12 margins on top of it would have pushed the three links most of a
  // thumb's width further down the screen.
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
  },
  link: {
    color: partnerTheme.accentStrong,
    textAlign: 'center',
  },
  linkSecondary: {
    color: partnerTheme.textMuted,
    textAlign: 'center',
  },
});

import { useState } from 'react';
import { radius } from '../../../../packages/design-system/src/tokens/radius';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AuthPasswordField from '../../src/components/AuthPasswordField';
import { useAuth } from '../../src/contexts/AuthContext';
import { validateLoginForm } from '../../src/domain/authFormValidation';
import { resolveDispatchSuccessNotice } from '../../src/utils/routeNotices';
import { dispatchTheme } from '../../src/theme/palette';
import { MIN_TAP_TARGET } from '../../../../packages/design-system/src/tokens/space';
import { SCREEN_TITLE_SIZE, SCREEN_TITLE_WEIGHT } from '../../src/theme/screenChrome';

export default function DispatchLoginScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ notice?: string | string[] }>();
  const { clearError, error, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Confirmations that have to outlive a navigation. Reset-password, register
  // and forgot-password all land here with `notice=<key>` rather than relying
  // on an Alert callback, which would be an empty function the day dispatch
  // gains a web build. The keys live in src/utils/routeNotices.ts.
  const notice = resolveDispatchSuccessNotice(params.notice);
  // Client-side validation used to go to `Alert`, an empty function under
  // react-native-web, so an empty submit would look like a dead button. Held
  // locally because `AuthContext` exposes no setter, and rendered through the
  // SAME slot as the context's `error` below, so the screen keeps exactly one
  // error surface rather than gaining a second competing one.
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
      // `error`, which the slot above renders; the `Alert` that used to sit
      // here only duplicated it on native and said nothing at all on web.
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FEASTY Dispatch</Text>
        <Text style={styles.title}>Dispatch sign in</Text>
        <Text style={styles.copy}>
          Use a dispatch-enabled team account to access live orders, rider controls, and operations tools.
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
          placeholder="Dispatch email"
          placeholderTextColor={dispatchTheme.textSoft}
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
          <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Enter dispatch board'}</Text>
        </TouchableOpacity>

        {/* `asChild` so each link is a real box instead of a run of inline
            text. A bare <Link> renders as Text, which react-native-web gives
            `display: inline`, and CSS ignores min-height on an inline box --
            so the obvious fix would have looked right and changed nothing.
            Both of these were the 14pt default line box: 20pt. Riders are on
            budget Android hardware, where that is the hardest target to hit. */}
        <Link href="/(auth)/register" asChild>
          <Pressable style={styles.linkPressable}>
            <Text style={styles.link}>Need a dispatch account? Sign up</Text>
          </Pressable>
        </Link>
        <Link href="./forgot-password" asChild>
          <Pressable style={styles.linkPressable}>
            <Text style={styles.linkSecondary}>Forgot password?</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: dispatchTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hero: {
    backgroundColor: dispatchTheme.hero,
    borderColor: dispatchTheme.heroSecondary,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: 24,
  },
  eyebrow: {
    color: dispatchTheme.accentSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    color: dispatchTheme.textOnInverse,
    fontSize: SCREEN_TITLE_SIZE,
    fontWeight: SCREEN_TITLE_WEIGHT,
  },
  copy: {
    color: dispatchTheme.textOnInverseMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: dispatchTheme.surface,
    borderColor: dispatchTheme.border,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  errorText: {
    color: dispatchTheme.dangerText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  noticeText: {
    color: dispatchTheme.success,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 14,
  },
  input: {
    backgroundColor: dispatchTheme.cream,
    borderColor: dispatchTheme.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: dispatchTheme.text,
    fontSize: 15,
    marginTop: 14,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: dispatchTheme.accent,
    borderRadius: radius.xl,
    marginTop: 18,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: dispatchTheme.textOnBrand,
    fontSize: 15,
    fontWeight: '800',
  },
  // The spacing moved off the labels and onto the boxes that now carry them,
  // and shrank. A 44pt box already holds 12pt of air above and below a 20pt
  // label, so keeping the old 16/12 margins on top of that would have pushed
  // the two links most of a thumb's width further down the screen.
  linkPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: MIN_TAP_TARGET,
  },
  link: {
    color: dispatchTheme.accentStrong,
    textAlign: 'center',
  },
  linkSecondary: {
    color: dispatchTheme.textMuted,
    textAlign: 'center',
  },
});

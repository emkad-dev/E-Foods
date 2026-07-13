import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PhoneVerification } from '../../../../packages/auth/src/components/PhoneVerification';
import { useAuth } from '../../src/contexts/AuthContext';
import { requestPhoneCode, verifyPhoneCode } from '../../src/services/phoneVerification';
import { customerTheme } from '../../src/theme/palette';

export default function CompleteProfileScreen() {
  const { error, policyAccepted, updatePhoneNumber, user } = useAuth();

  const handleVerified = async (e164: string) => {
    try {
      // The gateway already saved the verified number; this syncs local
      // auth state (same value, so the verification timestamp is kept).
      await updatePhoneNumber(e164);
    } catch {
      // Profile is already correct server-side; navigation may proceed.
    }
    router.replace((policyAccepted ? '/home' : '/accept-policy') as never);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>FEASTY Customer</Text>
          <Text style={styles.title}>Verify your phone number</Text>
          <Text style={styles.copy}>
            We use this for order updates and rider contact. We&apos;ll text you a 6-digit code by
            SMS or WhatsApp.
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.verifyBlock}>
            <PhoneVerification
              theme={customerTheme}
              initialPhone={typeof user?.phoneNumber === 'string' ? user.phoneNumber : undefined}
              requestCode={async (e164, channel) => {
                const result = await requestPhoneCode(e164, channel);
                return { resendInSeconds: result.resendInSeconds };
              }}
              verifyCode={async (e164, code) => {
                await verifyPhoneCode(e164, code);
              }}
              onVerified={(e164) => {
                Alert.alert('Phone verified', 'Your number is confirmed.');
                void handleVerified(e164);
              }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: customerTheme.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: customerTheme.surface,
    borderColor: customerTheme.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  eyebrow: {
    color: customerTheme.accentStrong,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    color: customerTheme.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 8,
  },
  copy: {
    color: customerTheme.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  errorText: {
    color: customerTheme.danger,
    fontSize: 13,
    marginTop: 12,
  },
  verifyBlock: {
    marginTop: 16,
  },
});

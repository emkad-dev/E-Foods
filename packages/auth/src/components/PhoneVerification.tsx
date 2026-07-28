import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { OtpEntry, type OtpChannel } from './OtpEntry';
import { PhoneInput, type PhoneComponentTheme, type PhoneInputChange } from './PhoneInput';

type RequestCode = (e164: string, channel: OtpChannel) => Promise<{ resendInSeconds: number }>;
type VerifyCode = (e164: string, code: string) => Promise<void>;

type Props = {
  theme: PhoneComponentTheme;
  /** Calls the auth-gateway otp-request route (network lives in the app). */
  requestCode: RequestCode;
  /** Calls the auth-gateway otp-verify route. */
  verifyCode: VerifyCode;
  onVerified: (e164: string) => void;
  initialPhone?: string;
};

/**
 * Two-step verify flow: enter phone -> receive code (SMS/WhatsApp) -> enter
 * code. Pure UI; the app supplies the gateway calls so this package stays
 * free of network and session concerns.
 */
export const PhoneVerification = ({ theme, requestCode, verifyCode, onVerified, initialPhone }: Props) => {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState<PhoneInputChange | null>(null);
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [resendInSeconds, setResendInSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (targetChannel: OtpChannel) => {
    if (!phone?.e164 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestCode(phone.e164, targetChannel);
      setResendInSeconds(result.resendInSeconds > 0 ? result.resendInSeconds : 60);
      setStep('code');
    } catch (err: any) {
      setError(err?.message ?? 'Unable to send the code right now.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (code: string) => {
    if (!phone?.e164 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(phone.e164, code);
      onVerified(phone.e164);
    } catch (err: any) {
      setError(err?.message ?? 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <View>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to {phone?.e164} via {channel === 'sms' ? 'SMS' : 'WhatsApp'}.
        </Text>
        <OtpEntry
          theme={theme}
          resendInSeconds={resendInSeconds}
          onSubmit={(code) => void submitCode(code)}
          onResend={(nextChannel) => void sendCode(nextChannel)}
          channel={channel}
          onChannelChange={setChannel}
          busy={busy}
          errorText={error}
        />
        <TouchableOpacity style={styles.linkButton} onPress={() => { setStep('phone'); setError(null); }} disabled={busy}>
          <Text style={styles.linkText}>Change phone number</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <PhoneInput theme={theme} onChange={setPhone} initialValue={initialPhone} editable={!busy} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.button, !phone?.e164 || busy ? styles.buttonDisabled : null]}
        onPress={() => void sendCode(channel)}
        disabled={!phone?.e164 || busy}
      >
        <Text style={styles.buttonText}>{busy ? 'Sending…' : 'Send verification code'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const makeStyles = (theme: PhoneComponentTheme) =>
  StyleSheet.create({
    subtitle: { color: theme.textMuted, fontSize: 14, marginBottom: 16, textAlign: 'center' },
    button: {
      marginTop: 16,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.surface, fontSize: 16, fontWeight: '700' },
    errorText: { color: theme.danger, fontSize: 13, marginTop: 8 },
    linkButton: { marginTop: 16, alignItems: 'center' },
    linkText: { color: theme.accent, fontSize: 14, fontWeight: '600' },
  });

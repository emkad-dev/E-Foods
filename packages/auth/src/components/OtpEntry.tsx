import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { PhoneComponentTheme } from './PhoneInput';
import { MIN_TAP_TARGET } from '../../../design-system/src/tokens/space';

export type OtpChannel = 'sms' | 'whatsapp';

type Props = {
  theme: PhoneComponentTheme;
  /** Seconds until resend is allowed again; restarts whenever it changes to > 0. */
  resendInSeconds: number;
  onSubmit: (code: string) => void;
  onResend: (channel: OtpChannel) => void;
  channel: OtpChannel;
  onChannelChange: (channel: OtpChannel) => void;
  busy?: boolean;
  errorText?: string | null;
};

const CODE_LENGTH = 6;

export const OtpEntry = ({
  theme, resendInSeconds, onSubmit, onResend, channel, onChannelChange, busy, errorText,
}: Props) => {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(resendInSeconds);

  useEffect(() => {
    setCountdown(resendInSeconds);
  }, [resendInSeconds]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [countdown > 0]);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) onSubmit(digits);
  };

  return (
    <View>
      {/* One hidden input drives six visual cells — avoids per-cell focus juggling. */}
      <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel="Verification code">
        <View style={styles.cellRow}>
          {Array.from({ length: CODE_LENGTH }).map((_, index) => (
            <View
              key={index}
              style={[styles.cell, index === code.length ? styles.cellActive : null]}
            >
              <Text style={styles.cellText}>{code[index] ?? ''}</Text>
            </View>
          ))}
        </View>
      </Pressable>
      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        value={code}
        onChangeText={handleChange}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={CODE_LENGTH}
        editable={!busy}
        autoFocus
        caretHidden
      />

      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

      <View style={styles.channelRow}>
        {(['sms', 'whatsapp'] as OtpChannel[]).map((option) => {
          const selected = option === channel;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.channelChip, selected ? styles.channelChipActive : null]}
              onPress={() => onChannelChange(option)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.channelText, selected ? styles.channelTextActive : null]}>
                {option === 'sms' ? 'SMS' : 'WhatsApp'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.resendButton}
        onPress={() => {
          setCode('');
          onResend(channel);
        }}
        disabled={busy || countdown > 0}
      >
        <Text style={[styles.resendText, countdown > 0 ? styles.resendTextDisabled : null]}>
          {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const makeStyles = (theme: PhoneComponentTheme) =>
  StyleSheet.create({
    cellRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
    cell: {
      width: 44,
      height: 52,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    cellActive: { borderColor: theme.accent },
    cellText: { fontSize: 22, fontWeight: '700', color: theme.text },
    hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
    errorText: { color: theme.dangerText, fontSize: 13, marginTop: 10, textAlign: 'center' },
    channelRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 16 },
    // The same 33pt chip as PhoneInput's country selector, here choosing where
    // the code is sent. Email confirmation is OTP-only across this product, so
    // this screen is on the signup path for every account in every app.
    channelChip: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      justifyContent: 'center',
      minHeight: MIN_TAP_TARGET,
      paddingVertical: 6,
      paddingHorizontal: 16,
      backgroundColor: theme.surface,
    },
    channelChipActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
    channelText: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },
    channelTextActive: { color: theme.text },
    // No padding at all, so the target was the 14pt label's line box -- about
    // 20pt -- on the control someone reaches for precisely when the first code
    // did not arrive.
    resendButton: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 14,
      minHeight: MIN_TAP_TARGET,
    },
    resendText: { color: theme.accent, fontSize: 14, fontWeight: '600' },
    resendTextDisabled: { color: theme.textMuted },
  });

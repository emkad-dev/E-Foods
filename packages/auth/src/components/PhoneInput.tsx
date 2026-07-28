import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  SUPPORTED_PHONE_COUNTRIES,
  formatLocalPhone,
  normalizePhone,
  phoneRejectionMessage,
} from '../../../domain/src/phone';
import type { PhoneCountry, PhoneResult } from '../../../domain/src/phone';

/** Palette subset every app theme already provides (customer/partner/dispatch). */
export type PhoneComponentTheme = {
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  accent: string;
  accentSoft: string;
  danger: string;
};

export type PhoneInputChange = {
  /** Normalized E.164 (+234…/+44…) when the input is valid, otherwise null. */
  e164: string | null;
  /** What the user currently sees in the field. */
  display: string;
  country: PhoneCountry;
};

type Props = {
  theme: PhoneComponentTheme;
  onChange: (change: PhoneInputChange) => void;
  initialValue?: string;
  editable?: boolean;
  autoFocus?: boolean;
};

const initialState = (initialValue?: string): { country: PhoneCountry; text: string } => {
  const parsed = initialValue ? normalizePhone(initialValue) : null;
  if (parsed?.ok) {
    return { country: parsed.country, text: formatLocalPhone(parsed.local, parsed.country) };
  }
  return { country: 'NG', text: '' };
};

export const PhoneInput = ({ theme, onChange, initialValue, editable = true, autoFocus }: Props) => {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [{ country, text }, setState] = useState(() => initialState(initialValue));
  const [touched, setTouched] = useState(false);

  const result: PhoneResult | null = text.trim() ? normalizePhone(text, country) : null;
  const showError = touched && result !== null && !result.ok;

  const emit = (nextText: string, nextCountry: PhoneCountry) => {
    const nextResult = nextText.trim() ? normalizePhone(nextText, nextCountry) : null;
    onChange({
      e164: nextResult?.ok ? nextResult.e164 : null,
      display: nextText,
      country: nextCountry,
    });
  };

  const handleText = (raw: string) => {
    // Pasted international numbers keep their '+' shape; local input gets grouped.
    const next = raw.trimStart().startsWith('+') ? raw.trim() : formatLocalPhone(raw, country);
    setState({ country, text: next });
    emit(next, country);
  };

  const handleCountry = (nextCountry: PhoneCountry) => {
    const nextText = text.startsWith('+') ? '' : formatLocalPhone(text, nextCountry);
    setState({ country: nextCountry, text: nextText });
    emit(nextText, nextCountry);
  };

  const active = SUPPORTED_PHONE_COUNTRIES.find((c) => c.country === country);

  return (
    <View>
      <View style={styles.row}>
        {SUPPORTED_PHONE_COUNTRIES.map((option) => {
          const selected = option.country === country;
          return (
            <TouchableOpacity
              key={option.country}
              style={[styles.countryChip, selected ? styles.countryChipActive : null]}
              onPress={() => handleCountry(option.country)}
              disabled={!editable}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.countryChipText, selected ? styles.countryChipTextActive : null]}>
                {option.flag} {option.dialCode}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={[styles.input, showError ? styles.inputError : null]}
        placeholder={active?.placeholder ?? 'Phone number'}
        placeholderTextColor={theme.textMuted}
        keyboardType="phone-pad"
        value={text}
        onChangeText={handleText}
        onBlur={() => setTouched(true)}
        editable={editable}
        autoFocus={autoFocus}
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      {showError && !result.ok ? (
        <Text style={styles.errorText}>{phoneRejectionMessage(result.reason)}</Text>
      ) : null}
    </View>
  );
};

const makeStyles = (theme: PhoneComponentTheme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    countryChip: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 14,
      backgroundColor: theme.surface,
    },
    countryChipActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
    countryChipText: { color: theme.textMuted, fontSize: 14, fontWeight: '600' },
    countryChipTextActive: { color: theme.text },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      fontSize: 16,
      color: theme.text,
      backgroundColor: theme.surface,
    },
    inputError: { borderColor: theme.danger },
    errorText: { color: theme.danger, fontSize: 13, marginTop: 6 },
  });

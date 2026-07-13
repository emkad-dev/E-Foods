/**
 * Phone normalization + validation for FEASTY's two supported markets:
 * Nigerian (+234) and UK (+44) mobiles. Everything else is rejected.
 *
 * MIRROR: supabase/functions/_shared/phone.ts is a byte-identical copy of this
 * module (edge functions run on Deno and do not import packages/). If you
 * change one file, change the other.
 */

export type PhoneCountry = 'NG' | 'GB';

export type PhoneRejectionReason =
  | 'empty'
  | 'invalid_characters'
  | 'unsupported_country'
  | 'invalid_length'
  | 'not_a_mobile';

export type PhoneResult =
  | { ok: true; e164: string; country: PhoneCountry; local: string }
  | { ok: false; reason: PhoneRejectionReason };

type CountryRule = {
  dialCode: string;
  /** National significant number: 10 digits, mobile ranges only. */
  nsnPattern: RegExp;
  nsnLength: number;
};

const RULES: Record<PhoneCountry, CountryRule> = {
  // Nigerian mobiles: 070x/071x/080x/081x/090x/091x → NSN starts 70|71|80|81|90|91.
  NG: { dialCode: '234', nsnPattern: /^[789][01]\d{8}$/, nsnLength: 10 },
  // UK mobiles: 07xxx xxxxxx → NSN starts 7.
  GB: { dialCode: '44', nsnPattern: /^7\d{9}$/, nsnLength: 10 },
};

/** Country metadata for input UIs (flag, dial code, sample placeholder). */
export const SUPPORTED_PHONE_COUNTRIES: Array<{
  country: PhoneCountry;
  dialCode: string;
  flag: string;
  placeholder: string;
  localLength: number;
}> = [
  { country: 'NG', dialCode: '+234', flag: '\u{1F1F3}\u{1F1EC}', placeholder: '0803 123 4567', localLength: 11 },
  { country: 'GB', dialCode: '+44', flag: '\u{1F1EC}\u{1F1E7}', placeholder: '07123 456789', localLength: 11 },
];

const validateNsn = (nsn: string, country: PhoneCountry): PhoneResult => {
  const rule = RULES[country];
  // Forgive the common "+234 0803..." mistake: a leading trunk 0 left on the NSN.
  const candidate = nsn.length === rule.nsnLength + 1 && nsn.startsWith('0') ? nsn.slice(1) : nsn;
  if (candidate.length !== rule.nsnLength) return { ok: false, reason: 'invalid_length' };
  if (!rule.nsnPattern.test(candidate)) return { ok: false, reason: 'not_a_mobile' };
  return { ok: true, e164: `+${rule.dialCode}${candidate}`, country, local: `0${candidate}` };
};

/**
 * Normalize any user-entered phone number to E.164.
 *
 * Accepted shapes: `+234…`/`+44…`, `00`-prefixed international, bare
 * `234…`/`44…` with full country length, and local `0…` (11 digits).
 * `countryHint` (the UI's country toggle) disambiguates local numbers; a local
 * number starting `070`/`071` is valid in both markets, and without a hint
 * Nigeria — the primary market — wins.
 */
export const normalizePhone = (input: string, countryHint?: PhoneCountry): PhoneResult => {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  let digits = trimmed.replace(/[\s\-.()]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!/^\+?\d+$/.test(digits)) return { ok: false, reason: 'invalid_characters' };

  if (digits.startsWith('+')) {
    const rest = digits.slice(1);
    if (rest.startsWith(RULES.NG.dialCode)) return validateNsn(rest.slice(3), 'NG');
    if (rest.startsWith(RULES.GB.dialCode)) return validateNsn(rest.slice(2), 'GB');
    return { ok: false, reason: 'unsupported_country' };
  }

  // Bare country code (no `+`), distinguished from local numbers by length and
  // the missing trunk 0.
  if (digits.startsWith('234') && digits.length === 13) return validateNsn(digits.slice(3), 'NG');
  if (digits.startsWith('44') && digits.length === 12) return validateNsn(digits.slice(2), 'GB');

  if (digits.startsWith('0')) {
    const nsn = digits.slice(1);
    const order: PhoneCountry[] = countryHint === 'GB' ? ['GB', 'NG'] : ['NG', 'GB'];
    let firstFailure: PhoneResult | null = null;
    for (const country of order) {
      const result = validateNsn(nsn, country);
      if (result.ok) return result;
      if (!firstFailure) firstFailure = result;
    }
    return firstFailure as PhoneResult;
  }

  return { ok: false, reason: 'unsupported_country' };
};

/**
 * Group local digits for display as the user types:
 * NG `0803 123 4567` (4-3-4), GB `07123 456789` (5-6).
 */
export const formatLocalPhone = (digits: string, country: PhoneCountry): string => {
  const clean = digits.replace(/\D/g, '').slice(0, 11);
  if (country === 'GB') {
    if (clean.length <= 5) return clean;
    return `${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  if (clean.length <= 4) return clean;
  if (clean.length <= 7) return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`;
};

/** Friendly copy for each rejection reason, shared by the app inputs. */
export const phoneRejectionMessage = (reason: PhoneRejectionReason): string => {
  switch (reason) {
    case 'empty':
      return 'Enter your phone number.';
    case 'invalid_characters':
      return 'Use digits only — no letters or symbols.';
    case 'unsupported_country':
      return 'Only Nigerian (+234) and UK (+44) numbers are supported.';
    case 'invalid_length':
      return 'That number has the wrong number of digits.';
    case 'not_a_mobile':
      return 'Enter a mobile number — landlines are not supported.';
    default:
      return 'That phone number does not look right.';
  }
};

/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/domain/authFormValidation.test.ts
 *
 * Every rule here used to be an `Alert.alert` that returned. The screens now
 * render the returned string in the inline error slot they already had, so the
 * thing worth pinning down is that a rule REFUSES when it should (returns a
 * message) and stays out of the way when it should (returns null) — a rule that
 * silently returned null would restore the dead-button behaviour being fixed.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MIN_PASSWORD_LENGTH,
  validateEmailCode,
  validateForgotPasswordForm,
  validateLoginForm,
  validateRegisterForm,
  validateResetPasswordForm,
  validateVerifyEmailForm,
} from './authFormValidation.js';

const validRegistration = {
  displayName: 'Ada',
  email: 'ada@example.com',
  password: 'supersecret',
  phoneE164: '+2348012345678',
  acceptedPolicies: true,
};

const validReset = {
  email: 'rider@example.com',
  code: '123456',
  password: 'supersecret',
  confirmPassword: 'supersecret',
};

describe('validateLoginForm', () => {
  it('accepts a filled form', () => {
    assert.equal(validateLoginForm({ email: 'rider@example.com', password: 'secret' }), null);
  });

  it('refuses a missing email', () => {
    assert.match(validateLoginForm({ email: '  ', password: 'secret' }) ?? '', /dispatch email/);
  });

  it('refuses a missing password', () => {
    assert.match(validateLoginForm({ email: 'rider@example.com', password: '' }) ?? '', /password/);
  });
});

describe('validateForgotPasswordForm', () => {
  it('accepts an email', () => {
    assert.equal(validateForgotPasswordForm({ email: 'rider@example.com' }), null);
  });

  it('refuses whitespace only', () => {
    assert.match(validateForgotPasswordForm({ email: '   ' }) ?? '', /dispatch account/);
  });
});

describe('validateRegisterForm', () => {
  it('accepts a complete registration', () => {
    assert.equal(validateRegisterForm(validRegistration), null);
  });

  for (const field of ['displayName', 'email', 'password'] as const) {
    it(`refuses a blank ${field}`, () => {
      assert.match(validateRegisterForm({ ...validRegistration, [field]: '   ' }) ?? '', /before continuing/);
    });
  }

  it('refuses an incomplete phone number', () => {
    // `PhoneInput` reports null until the number parses, so this is the shape
    // the screen actually sees rather than an empty string.
    assert.match(validateRegisterForm({ ...validRegistration, phoneE164: null }) ?? '', /phone number/);
  });

  it('refuses a password under the Supabase minimum', () => {
    const message = validateRegisterForm({ ...validRegistration, password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) });
    assert.match(message ?? '', /at least 6 characters/);
  });

  it('refuses unaccepted policies last, so missing fields are reported first', () => {
    assert.match(validateRegisterForm({ ...validRegistration, acceptedPolicies: false }) ?? '', /Terms/);
    // A form that is both empty AND unaccepted names the empty fields, because
    // that is what the rider has to fix first.
    const both = validateRegisterForm({ ...validRegistration, displayName: '', acceptedPolicies: false });
    assert.match(both ?? '', /before continuing/);
  });
});

describe('validateEmailCode', () => {
  it('accepts a full-length code', () => {
    assert.equal(validateEmailCode({ value: '123456' }), null);
  });

  it('refuses a short or empty code', () => {
    assert.match(validateEmailCode({ value: '12345' }) ?? '', /6 digits/);
    assert.match(validateEmailCode({ value: '   ' }) ?? '', /6 digits/);
  });
});

describe('validateVerifyEmailForm', () => {
  it('accepts an address with a full code', () => {
    assert.equal(validateVerifyEmailForm({ email: 'rider@example.com', code: '123456' }), null);
  });

  it('asks for the address first — verifyOtp is keyed on (email, token)', () => {
    assert.match(validateVerifyEmailForm({ email: '  ', code: '' }) ?? '', /email address you signed up with/);
  });

  it('then asks for the whole code', () => {
    assert.match(validateVerifyEmailForm({ email: 'rider@example.com', code: '12' }) ?? '', /6 digits/);
  });
});

describe('validateResetPasswordForm', () => {
  it('accepts an address, a full code and a matching pair', () => {
    assert.equal(validateResetPasswordForm(validReset), null);
  });

  it('reports the missing address before anything else the rider typed', () => {
    // Checked first on purpose: reset is OTP-only and `verifyOtp` is keyed on
    // (email, token), so a code alone identifies nobody and complaining about
    // the password fields would send the rider in circles.
    const message = validateResetPasswordForm({ ...validReset, email: '   ', code: '', password: '', confirmPassword: '' });
    assert.match(message ?? '', /email address you asked for the reset code with/);
  });

  it('reports an incomplete code before the password pair', () => {
    const message = validateResetPasswordForm({ ...validReset, code: '123', password: '', confirmPassword: '' });
    assert.match(message ?? '', /6 digits/);
  });

  it('refuses an empty field', () => {
    assert.match(validateResetPasswordForm({ ...validReset, confirmPassword: '' }) ?? '', /both password fields/);
  });

  it('refuses a mismatch', () => {
    assert.match(validateResetPasswordForm({ ...validReset, confirmPassword: 'different' }) ?? '', /must match/);
  });

  it('refuses a short password even when both fields match', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const message = validateResetPasswordForm({ ...validReset, password: short, confirmPassword: short });
    assert.match(message ?? '', /at least 6 characters/);
  });
});

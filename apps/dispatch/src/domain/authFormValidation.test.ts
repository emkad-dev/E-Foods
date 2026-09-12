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
  validateForgotPasswordForm,
  validateLoginForm,
  validateRegisterForm,
  validateResetPasswordForm,
} from './authFormValidation.js';

const validRegistration = {
  displayName: 'Ada',
  email: 'ada@example.com',
  password: 'supersecret',
  phoneE164: '+2348012345678',
  acceptedPolicies: true,
};

const validReset = {
  hasResetCredential: true,
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

describe('validateResetPasswordForm', () => {
  it('accepts a matching pair on a credentialed link', () => {
    assert.equal(validateResetPasswordForm(validReset), null);
  });

  it('reports the missing recovery code before anything the rider typed', () => {
    // Checked first on purpose: no password can rescue a link with no code, so
    // complaining about the password fields would send the rider in circles.
    const message = validateResetPasswordForm({ hasResetCredential: false, password: '', confirmPassword: '' });
    assert.match(message ?? '', /recovery code/);
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

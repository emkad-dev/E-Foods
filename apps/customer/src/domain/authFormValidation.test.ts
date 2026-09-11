import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MIN_PASSWORD_LENGTH,
  validateEmailCode,
  validateForgotPasswordForm,
  validateLoginForm,
  validatePhoneNumber,
  validateRegisterForm,
  validateResetPasswordForm,
  validateUsername,
} from './authFormValidation.ts';

const validRegistration = {
  nickname: 'Ada',
  email: 'ada@example.com',
  password: 'supersecret',
  confirmPassword: 'supersecret',
  phoneNumber: '08012345678',
  acceptedPolicies: true,
};

describe('validateLoginForm', () => {
  it('accepts a complete form', () => {
    assert.equal(validateLoginForm({ email: 'ada@example.com', password: 'pw' }), null);
  });

  it('rejects a blank or whitespace-only field', () => {
    assert.match(validateLoginForm({ email: '', password: 'pw' }) ?? '', /email and your password/);
    assert.match(validateLoginForm({ email: 'a@b.co', password: '   ' }) ?? '', /email and your password/);
  });
});

describe('validateForgotPasswordForm', () => {
  it('requires an email', () => {
    assert.equal(validateForgotPasswordForm({ email: 'ada@example.com' }), null);
    assert.match(validateForgotPasswordForm({ email: '  ' }) ?? '', /email address linked/);
  });
});

describe('validateRegisterForm', () => {
  it('accepts a complete, consistent registration', () => {
    assert.equal(validateRegisterForm(validRegistration), null);
  });

  it('reports missing fields first', () => {
    assert.match(
      validateRegisterForm({ ...validRegistration, phoneNumber: '' }) ?? '',
      /complete all fields/
    );
    assert.match(
      validateRegisterForm({ ...validRegistration, nickname: '   ' }) ?? '',
      /complete all fields/
    );
  });

  it('reports a password mismatch before password strength', () => {
    // Both are wrong here (short AND mismatched); the mismatch is the one the
    // user can see for themselves, so it is the more useful message.
    assert.match(
      validateRegisterForm({ ...validRegistration, password: 'abc', confirmPassword: 'abd' }) ?? '',
      /passwords must match/
    );
  });

  it('enforces the minimum password length', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    assert.match(
      validateRegisterForm({ ...validRegistration, password: short, confirmPassword: short }) ?? '',
      /at least 6 characters/
    );
  });

  it('refuses to submit without the policy tick', () => {
    assert.match(
      validateRegisterForm({ ...validRegistration, acceptedPolicies: false }) ?? '',
      /Accept the Terms and Privacy Policy/
    );
  });
});

describe('validateResetPasswordForm', () => {
  const valid = { hasResetCredential: true, password: 'supersecret', confirmPassword: 'supersecret' };

  it('accepts a complete form on a link that carried a code', () => {
    assert.equal(validateResetPasswordForm(valid), null);
  });

  it('reports the broken link before anything the user typed', () => {
    // No password can rescue a link with no code, so this must win even when
    // the password fields are also empty.
    assert.match(
      validateResetPasswordForm({ hasResetCredential: false, password: '', confirmPassword: '' }) ?? '',
      /missing the required reset code/
    );
  });

  it('requires both password fields, then a match, then length', () => {
    assert.match(validateResetPasswordForm({ ...valid, confirmPassword: '' }) ?? '', /both passwords/);
    assert.match(
      validateResetPasswordForm({ ...valid, confirmPassword: 'different' }) ?? '',
      /passwords must match/
    );
    assert.match(
      validateResetPasswordForm({ ...valid, password: 'abcde', confirmPassword: 'abcde' }) ?? '',
      /at least 6 characters/
    );
  });
});

describe('profile and verification field checks', () => {
  it('requires a username', () => {
    assert.equal(validateUsername({ value: 'Ada' }), null);
    assert.match(validateUsername({ value: '  ' }) ?? '', /greet you with/);
  });

  it('requires a phone number', () => {
    assert.equal(validatePhoneNumber({ value: '08012345678' }), null);
    assert.match(validatePhoneNumber({ value: '' }) ?? '', /riders and support/);
  });

  it('requires the full 6-digit email code', () => {
    assert.equal(validateEmailCode({ value: '123456' }), null);
    assert.match(validateEmailCode({ value: '12345' }) ?? '', /6 digits/);
  });
});

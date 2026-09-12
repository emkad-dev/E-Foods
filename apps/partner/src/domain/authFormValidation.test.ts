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
  contactName: 'Ada',
  email: 'ada@example.com',
  password: 'supersecret',
  phoneE164: '+2348012345678',
  acceptedPolicies: true,
};

const validReset = {
  email: 'ada@example.com',
  code: '123456',
  password: 'supersecret',
  confirmPassword: 'supersecret',
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
    assert.match(validateForgotPasswordForm({ email: '  ' }) ?? '', /linked to your partner account/);
  });
});

describe('validateRegisterForm', () => {
  it('accepts a complete registration', () => {
    assert.equal(validateRegisterForm(validRegistration), null);
  });

  it('rejects any missing contact field', () => {
    for (const missing of [
      { contactName: '  ' },
      { email: '' },
      { password: '' },
      { phoneE164: null },
      // PhoneInput emits '' rather than null while the number is unusable.
      { phoneE164: '' },
    ]) {
      assert.match(
        validateRegisterForm({ ...validRegistration, ...missing }) ?? '',
        /contact name, email, password, and phone number/
      );
    }
  });

  it('rejects a password below the Supabase minimum', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    assert.match(validateRegisterForm({ ...validRegistration, password: short }) ?? '', /at least/);
    assert.equal(validateRegisterForm({ ...validRegistration, password: 'x'.repeat(MIN_PASSWORD_LENGTH) }), null);
  });

  it('rejects an unticked policy box last, so field gaps are reported first', () => {
    assert.match(
      validateRegisterForm({ ...validRegistration, acceptedPolicies: false }) ?? '',
      /Terms and Privacy Policy/
    );
    assert.match(
      validateRegisterForm({ ...validRegistration, acceptedPolicies: false, email: '' }) ?? '',
      /contact name, email, password, and phone number/
    );
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
    assert.equal(validateVerifyEmailForm({ email: 'ada@example.com', code: '123456' }), null);
  });

  it('asks for the address first — verifyOtp is keyed on (email, token)', () => {
    assert.match(validateVerifyEmailForm({ email: '  ', code: '' }) ?? '', /email address you signed up with/);
  });

  it('then asks for the whole code', () => {
    assert.match(validateVerifyEmailForm({ email: 'ada@example.com', code: '12' }) ?? '', /6 digits/);
  });
});

describe('validateResetPasswordForm', () => {
  it('accepts an address, a full code and a matching pair', () => {
    assert.equal(validateResetPasswordForm(validReset), null);
  });

  it('reports the missing address before anything else the partner typed', () => {
    // Reset is OTP-only: a code alone identifies nobody, so the address is the
    // first thing worth asking for.
    assert.match(
      validateResetPasswordForm({ ...validReset, email: '  ', code: '', password: '', confirmPassword: '' }) ?? '',
      /email address you asked for the reset code with/
    );
  });

  it('reports an incomplete code before the password pair', () => {
    assert.match(
      validateResetPasswordForm({ ...validReset, code: '123', password: '', confirmPassword: '' }) ?? '',
      /6 digits/
    );
  });

  it('requires both fields, then a match, then the length floor', () => {
    assert.match(validateResetPasswordForm({ ...validReset, confirmPassword: '  ' }) ?? '', /both password fields/);
    assert.match(validateResetPasswordForm({ ...validReset, confirmPassword: 'other' }) ?? '', /must match/);

    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    assert.match(
      validateResetPasswordForm({ ...validReset, password: short, confirmPassword: short }) ?? '',
      /at least/
    );
  });
});

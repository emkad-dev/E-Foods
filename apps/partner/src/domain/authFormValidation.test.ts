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
  contactName: 'Ada',
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

describe('validateResetPasswordForm', () => {
  it('accepts a matching pair from a link that carried a credential', () => {
    assert.equal(validateResetPasswordForm(validReset), null);
  });

  it('reports the missing recovery code before anything the partner typed', () => {
    assert.match(
      validateResetPasswordForm({ ...validReset, hasResetCredential: false, password: '', confirmPassword: '' }) ?? '',
      /missing the required recovery code/
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

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ALLOWED_SIGNUP_EMAIL_DOMAINS,
  MIN_PASSWORD_LENGTH,
  validateEmailCode,
  validateForgotPasswordForm,
  normalizeProfilePhoneNumber,
  validateLoginForm,
  validatePhoneNumber,
  validateRegisterForm,
  validateResetPasswordForm,
  validateSignupEmailDomain,
  validateUsername,
} from './authFormValidation.ts';

const validRegistration = {
  nickname: 'Ada',
  // On the signup allowlist. `example.com` is not, and registration is the one
  // form that enforces it.
  email: 'ada@gmail.com',
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

  it('rejects an off-allowlist domain, after the empty-field check and before the passwords', () => {
    // Empty fields still win: an entirely blank form should not be told its
    // domain is wrong.
    assert.match(
      validateRegisterForm({ ...validRegistration, email: '   ', nickname: '' }) ?? '',
      /complete all fields/
    );

    // The domain wins over a password problem, because the email field is the
    // one above it on the screen.
    assert.match(
      validateRegisterForm({
        ...validRegistration,
        email: 'chef@restaurant.ng',
        password: 'abc',
        confirmPassword: 'abd',
      }) ?? '',
      /We accept gmail\.com/
    );
  });

  it('accepts a plus-alias on an allowed domain', () => {
    assert.equal(validateRegisterForm({ ...validRegistration, email: 'ada+feasty@gmail.com' }), null);
  });
});

describe('validateSignupEmailDomain', () => {
  it('accepts every domain on the allowlist', () => {
    for (const domain of ALLOWED_SIGNUP_EMAIL_DOMAINS) {
      assert.equal(validateSignupEmailDomain(`ada@${domain}`), null, `${domain} should be accepted`);
    }

    // The list is the owner's, exactly — a silent addition or removal here is a
    // policy change, so pin it.
    assert.deepEqual([...ALLOWED_SIGNUP_EMAIL_DOMAINS], [
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'yahoo.co.uk',
      'yahoo.com.ng',
      'icloud.com',
      'me.com',
      'mac.com',
    ]);
  });

  it('accepts a plus-alias — people use them legitimately', () => {
    assert.equal(validateSignupEmailDomain('ada+feasty@gmail.com'), null);
    assert.equal(validateSignupEmailDomain('ada+2026-09-12@yahoo.com.ng'), null);
  });

  it('ignores case and surrounding whitespace', () => {
    assert.equal(validateSignupEmailDomain('ADA@GMAIL.COM'), null);
    assert.equal(validateSignupEmailDomain('  Ada@Icloud.Com  '), null);
    assert.equal(validateSignupEmailDomain('\tada@MAC.com\n'), null);
  });

  it('rejects a domain that merely CONTAINS an allowed one', () => {
    // The whole point of comparing the full domain instead of `endsWith` /
    // `includes`: every one of these is an attacker-chosen domain.
    for (const email of [
      'ada@gmail.com.evil.com',
      'ada@notgmail.com',
      'ada@gmail.company',
      'ada@sub.gmail.com',
      'ada@yahoo.com.ng.evil.co',
      'ada@evil.com?x=gmail.com',
    ]) {
      assert.match(validateSignupEmailDomain(email) ?? '', /We accept gmail\.com/, `${email} should be rejected`);
    }
  });

  it('rejects a business domain with a message that names what IS accepted', () => {
    const message = validateSignupEmailDomain('owner@mamaputkitchen.com.ng') ?? '';

    assert.match(message, /Gmail, Yahoo or iCloud/);
    // Naming the accepted domains is the requirement — a bare "invalid email"
    // on a well-formed address reads as a bug.
    for (const domain of ALLOWED_SIGNUP_EMAIL_DOMAINS) {
      assert.ok(message.includes(domain), `the rejection should name ${domain}`);
    }
  });

  it('rejects outlook and other common non-allowlisted providers', () => {
    for (const email of ['ada@outlook.com', 'ada@hotmail.com', 'ada@protonmail.com', 'ada@example.com']) {
      assert.match(validateSignupEmailDomain(email) ?? '', /We accept/, `${email} should be rejected`);
    }
  });

  it('asks for a complete address when there is no single @-separated domain', () => {
    for (const email of ['', '   ', 'ada', 'ada@', '@gmail.com', 'ada@gmail@com']) {
      assert.match(validateSignupEmailDomain(email) ?? '', /complete email address/, `${email} should be incomplete`);
    }
  });
});

describe('the signup domain allowlist is NOT applied anywhere else', () => {
  // Customer accounts predating the allowlist may sit on a domain that is not on
  // it. Gating any of these paths on the same check would lock those people out
  // of an account they already own, so each one must keep accepting an
  // off-allowlist address.
  const legacy = 'ada@example.com';

  it('sign-in accepts an off-allowlist address', () => {
    assert.equal(validateLoginForm({ email: legacy, password: 'supersecret' }), null);
  });

  it('forgot-password accepts an off-allowlist address', () => {
    assert.equal(validateForgotPasswordForm({ email: legacy }), null);
  });

  it('password reset accepts an off-allowlist address', () => {
    assert.equal(
      validateResetPasswordForm({
        email: legacy,
        code: '123456',
        password: 'supersecret',
        confirmPassword: 'supersecret',
      }),
      null
    );
  });
});

describe('validateResetPasswordForm', () => {
  const valid = {
    email: 'ada@example.com',
    code: '123456',
    password: 'supersecret',
    confirmPassword: 'supersecret',
  };

  it('accepts a complete OTP reset form', () => {
    assert.equal(validateResetPasswordForm(valid), null);
  });

  it('asks for the email first — verifyOtp is keyed on (email, token)', () => {
    // Everything else can be perfect; without an address there is nobody to
    // redeem the code against, so this message must win.
    assert.match(validateResetPasswordForm({ ...valid, email: '   ' }) ?? '', /email address you asked for/);
  });

  it('requires the full 6-digit code before looking at the passwords', () => {
    assert.match(
      validateResetPasswordForm({ ...valid, code: '123', password: '', confirmPassword: '' }) ?? '',
      /6 digits/
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

  it('rejects anything that is not a supported mobile', () => {
    // The whole point: `abc` used to save into the field riders dial.
    assert.match(validatePhoneNumber({ value: 'abc' }) ?? '', /digits only/);
    // Lagos landline (01...) - right length, wrong range.
    assert.match(validatePhoneNumber({ value: '01234567890' }) ?? '', /mobile number/);
    assert.match(validatePhoneNumber({ value: '0803123' }) ?? '', /number of digits/);
    assert.match(validatePhoneNumber({ value: '+1 415 555 0123' }) ?? '', /Nigerian/);
  });

  it('accepts the shapes people actually type', () => {
    assert.equal(validatePhoneNumber({ value: '0803 123 4567' }), null);
    assert.equal(validatePhoneNumber({ value: '+2348031234567' }), null);
    assert.equal(validatePhoneNumber({ value: '+44 7123 456789' }), null);
  });

  it('hands the screen an E.164 number to save, not the typed text', () => {
    assert.equal(normalizeProfilePhoneNumber('0803 123 4567'), '+2348031234567');
    assert.equal(normalizeProfilePhoneNumber('+44 7123 456789'), '+447123456789');
    assert.equal(normalizeProfilePhoneNumber('abc'), null);
  });

  it('requires the full 6-digit email code', () => {
    assert.equal(validateEmailCode({ value: '123456' }), null);
    assert.match(validateEmailCode({ value: '12345' }) ?? '', /6 digits/);
  });
});

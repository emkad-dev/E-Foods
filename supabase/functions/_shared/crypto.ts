/// <reference path="./edge-runtime.d.ts" />

/**
 * Constant-time string comparison. Used anywhere a secret-derived value
 * (an OTP hash, a webhook HMAC signature) is compared against caller input,
 * so a timing side-channel can't be used to guess the value byte-by-byte.
 */
export const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

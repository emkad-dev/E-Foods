import { ClientSafeError } from './observability.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateEmail = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ClientSafeError(400, 'Enter a valid email address.');
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ClientSafeError(400, 'Enter a valid email address.');
  }
  return email;
};

export const validatePassword = (raw: unknown): string => {
  if (typeof raw !== 'string' || raw.length < 6) {
    throw new ClientSafeError(400, 'Password must be at least 6 characters.');
  }
  // Upper bound guards against bcrypt CPU-amplification from oversized inputs.
  if (raw.length > 128) {
    throw new ClientSafeError(400, 'Password must be at most 128 characters.');
  }
  if (!/[A-Z]/.test(raw)) throw new ClientSafeError(400, 'Password must include an uppercase letter.');
  if (!/[a-z]/.test(raw)) throw new ClientSafeError(400, 'Password must include a lowercase letter.');
  if (!/[0-9]/.test(raw)) throw new ClientSafeError(400, 'Password must include a number.');
  return raw;
};

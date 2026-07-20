type Kind = 'login' | 'signup' | 'refresh' | 'logout';

// Deliberately NOT keyed on whether the account exists — same message for
// wrong-password and unknown-user so accounts cannot be enumerated.
export const safeAuthMessage = (kind: Kind, _gotrueStatus: number): string => {
  switch (kind) {
    case 'login':   return 'Incorrect email or password.';
    case 'signup':  return 'We could not create your account. Please try again.';
    case 'refresh': return 'Your session has expired. Please sign in again.';
    case 'logout':  return 'Could not sign you out. Please try again.';
  }
};

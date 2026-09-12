export {
  createUserWithEmail,
  formatAuthError,
  getUserRoleClaim,
  isStaleSupabaseSessionError,
  isNetworkRequestError,
  SESSION_EXPIRED_ERROR_MESSAGE,
  sendPasswordResetEmailWithFallback as sendPasswordReset,
  sendVerificationEmailWithFallback as sendVerificationEmail,
  signInWithEmail,
  signOutUser,
  verifyEmailOtp,
  verifyPasswordResetOtp,
} from '../../../../../packages/auth/src';

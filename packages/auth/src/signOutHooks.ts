/**
 * Work that must run while the session is still valid, just before signing
 * out - today: detaching this device's push token from the account, so the
 * next person to use the phone does not receive the previous user's order
 * updates (and the signed-out user's pushes stop landing on a device they
 * left). After `auth.signOut()` RLS no longer lets the client touch the row,
 * so this cannot be done from an auth-state listener.
 *
 * Hooks are best-effort and time-boxed: signing out must never hang or fail
 * because a cleanup request did.
 */
export type BeforeSignOutHook = () => Promise<void> | void;

const hooks = new Set<BeforeSignOutHook>();

export const BEFORE_SIGN_OUT_TIMEOUT_MS = 3_000;

export const registerBeforeSignOut = (hook: BeforeSignOutHook) => {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
};

export const runBeforeSignOutHooks = async (timeoutMs = BEFORE_SIGN_OUT_TIMEOUT_MS) => {
  if (hooks.size === 0) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  const work = Promise.allSettled(
    Array.from(hooks).map(async (hook) => {
      await hook();
    })
  ).then(() => undefined);

  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

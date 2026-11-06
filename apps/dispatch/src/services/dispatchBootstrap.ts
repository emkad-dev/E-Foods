import { BOOTSTRAP_READ_DEADLINE_MS, fetchProfileBootstrap } from '../../../../packages/auth/src';
import { callDispatchBackendRpc } from './backendRpc';

/**
 * The rider's own profile in one authenticated call, for interactive sign-in.
 * `null` means the deployed backend does not have the action yet, so the caller
 * keeps its direct profile read. See packages/auth/src/profileBootstrap.ts.
 */
export const fetchDispatchBootstrap = () =>
  fetchProfileBootstrap(
    (action) => callDispatchBackendRpc(action, undefined, { deadlineMs: BOOTSTRAP_READ_DEADLINE_MS }),
    'dispatchBootstrap'
  );

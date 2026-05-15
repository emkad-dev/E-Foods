import { callCustomerBackendRpc } from './backendRpc';

export const deleteOwnAccount = async () =>
  callCustomerBackendRpc<{ deleted: boolean; targetUid: string }>('deleteOwnAccount');

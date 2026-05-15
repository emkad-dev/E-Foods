import { callDispatchBackendRpc } from './backendRpc';

export const deleteOwnAccount = async () =>
  callDispatchBackendRpc<{ deleted: boolean; targetUid: string }>('deleteOwnAccount');

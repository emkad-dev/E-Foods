import { callPartnerBackendRpc } from './backendRpc';

export const deleteOwnAccount = async () =>
  callPartnerBackendRpc<{ deleted: boolean; targetUid: string }>('deleteOwnAccount');

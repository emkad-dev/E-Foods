export type AdminLiveRefreshController = {
  dispose: () => void;
  runNow: () => void;
  schedule: () => void;
};

export type AdminLiveRefreshControllerOptions = {
  debounceMs?: number;
};

export declare const createAdminLiveRefreshController: (
  refresh: () => Promise<void>,
  options?: AdminLiveRefreshControllerOptions
) => AdminLiveRefreshController;

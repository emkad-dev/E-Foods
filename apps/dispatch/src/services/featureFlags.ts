import type { FeatureFlagMap } from '../../../../packages/domain/src/featureFlags';
import { callDispatchBackendRpc } from './backendRpc';

export type FeatureFlagsResponse = {
  featureFlags: FeatureFlagMap;
};

export const getFeatureFlags = () => callDispatchBackendRpc<FeatureFlagsResponse>('getFeatureFlags');

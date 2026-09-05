import type { FeatureFlagMap } from '../../../../packages/domain/src/featureFlags';
import { callCustomerBackendRpc } from './backendRpc';

export type FeatureFlagsResponse = {
  featureFlags: FeatureFlagMap;
};

export const getFeatureFlags = () => callCustomerBackendRpc<FeatureFlagsResponse>('getFeatureFlags');

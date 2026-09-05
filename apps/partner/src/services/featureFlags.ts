import type { FeatureFlagMap } from '../../../../packages/domain/src/featureFlags';
import { callPartnerBackendRpc } from './backendRpc';

export type FeatureFlagsResponse = {
  featureFlags: FeatureFlagMap;
};

export const getFeatureFlags = () => callPartnerBackendRpc<FeatureFlagsResponse>('getFeatureFlags');

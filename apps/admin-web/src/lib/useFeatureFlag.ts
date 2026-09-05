import { useSnapshot } from '../contexts/SnapshotContext';

export const useFeatureFlag = (flagKey: string) => {
  const { snapshot } = useSnapshot();
  return snapshot.featureFlags[flagKey] === true;
};

// Platform-free exports only.
//
// `useAppStateVisibility` is deliberately NOT re-exported here: it imports
// `react-native`, and admin-web (plain React + Vite, no react-native dependency)
// consumes this barrel. Re-exporting it would drag an unresolvable import into
// that build. The React Native apps import it by direct path instead:
//
//   import { useAppStateVisibility } from '<...>/packages/runtime/src/useAppStateVisibility';
//
// `externalLink` is excluded for the same reason -- it imports `react-native`
// for the Platform check and the native Linking fallback. Its PURE half,
// `externalLinkPolicy`, is safe here and is what the tests exercise.
export * from './useVisiblePolling';
export * from './visiblePoller';
export * from './realtimeResource';
export * from './useRealtimeResource';
export * from './externalLinkPolicy';

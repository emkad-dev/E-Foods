// Platform-free exports only.
//
// `useAppStateVisibility` is deliberately NOT re-exported here: it imports
// `react-native`, and admin-web (plain React + Vite, no react-native dependency)
// consumes this barrel. Re-exporting it would drag an unresolvable import into
// that build. The React Native apps import it by direct path instead:
//
//   import { useAppStateVisibility } from '<...>/packages/runtime/src/useAppStateVisibility';
export * from './useVisiblePolling';
export * from './visiblePoller';

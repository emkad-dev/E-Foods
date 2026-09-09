const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Watch only what Metro actually resolves from, not the whole monorepo root.
// Expo's monorepo guide suggests watching the root, but on Windows without
// watchman the node crawler has to walk android/, supabase/, docs/, every
// app's dist/ and .expo/ as well - and times out with "Failed to start watch
// mode", which kills the transformer and leaves a server that serves the HTML
// shell but can never build a bundle. These two cover the workspace packages
// and the hoisted dependencies, which is everything resolvable.
config.watchFolders = [
  path.resolve(workspaceRoot, 'packages'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules', 'react-native', 'node_modules'),
];

module.exports = config;

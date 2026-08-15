// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// pnpm keeps workspace packages as symlinks and hoists nothing by default, so Metro has
// to be told about the repo root explicitly or `@maren/sdk` will not resolve.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// @maren/sdk ships TypeScript source rather than a build artifact (see its package.json
// "main": "./src/index.ts"), so Metro must transform files that live outside this app.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;

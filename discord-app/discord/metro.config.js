const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// discord-app/ — the monorepo root
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the entire discord-app/ folder (includes shared/)
config.watchFolders = [workspaceRoot];

// Resolve hoisted deps from discord-app/node_modules, fall back to local
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Map @dis/* directly to their source files under shared/
config.resolver.extraNodeModules = {
  '@dis/types': path.resolve(workspaceRoot, 'shared/types'),
  '@dis/api':   path.resolve(workspaceRoot, 'shared/api'),
  '@dis/ws':    path.resolve(workspaceRoot, 'shared/ws'),
  '@dis/store': path.resolve(workspaceRoot, 'shared/store'),
};

module.exports = config;

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// Reuse only the pure model and fictional fixtures from the web workspace.
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
};
// The live web build (scripts/build-workspace-web.mjs sets RECHARGE_LIVE_ONLY) leaves out the
// sample-data preview, so phones download only the live app.
if (process.env.RECHARGE_LIVE_ONLY === '1') {
  const resolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === '../../App' && context.originModulePath.endsWith(path.join('src', 'app', '[section].tsx'))) {
      return (resolve ?? context.resolveRequest)(context, '../LiveOnlyRedirect', platform);
    }
    return (resolve ?? context.resolveRequest)(context, moduleName, platform);
  };
}
module.exports = config;

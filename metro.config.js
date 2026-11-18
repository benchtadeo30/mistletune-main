const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude server virtual environments and cache directories
const existingBlockList = config.resolver.blockList;

config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  /[/\\]server[/\\]\.(?:venv|cache)[/\\].*/,
];

// SVG transformer for Expo
config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer/expo'
);

// Treat SVG files as source files
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== 'svg'
);

config.resolver.sourceExts = [
  ...new Set([...config.resolver.sourceExts, 'svg'])
];

// Support additional model and binary asset formats
config.resolver.assetExts = [
  ...new Set([
    ...config.resolver.assetExts,
    'pte',
    'bin',
    'wasm'
  ])
];

module.exports = config;
/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.nomnomdrive.app',
  productName: 'NomNomDrive',
  copyright: 'Copyright © 2026 NomNomDrive',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'node_modules/**/*',
    '!node_modules/.cache',
    '!**/*.map',
  ],

  // sqlite-vec ships pre-built .so/.dylib/.dll that must be dlopen'd at runtime.
  // These can't be loaded from inside an asar archive, so unpack them.
  asarUnpack: [
    'node_modules/sqlite-vec-*/**',
  ],

  extraResources: [
    {
      from: 'build/icons',
      to: 'icons',
      filter: ['**/*'],
    },
  ],

  // Rebuild native modules (node-llama-cpp, better-sqlite3, sqlite-vec) for Electron's ABI
  npmRebuild: true,
  buildDependenciesFromSource: false,

  linux: {
    target: [{ target: 'AppImage', arch: ['x64', 'arm64'] }],
    category: 'Utility',
    icon: 'build/icons/icon.png',
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.productivity',
    icon: 'build/icons/icon.png',
    identity: null, // unsigned for now; set MAC_CERTS secret to enable signing
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icons/icon.png',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },

  // In CI: GH_TOKEN enables GitHub publishing to the existing release for the tag.
  // releaseType 'release' ensures assets are uploaded to a published release (not a draft).
  // Locally: publish is null (no publishing).
  publish: process.env.GH_TOKEN ? { provider: 'github', releaseType: 'release' } : null,
};

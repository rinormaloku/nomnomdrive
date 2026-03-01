import type { Configuration } from 'electron-builder';

const config: Configuration = {
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

  publish: {
    provider: 'github',
    releaseType: 'release',
  },
};

export default config;

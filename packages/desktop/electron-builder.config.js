// Platform-specific file exclusions for node-llama-cpp.
// Each platform build keeps only its CPU binary; GPU variants (CUDA, Vulkan, Metal)
// are stripped to save ~600+ MB. Users who need GPU can install the variant separately.
const platform = process.platform; // 'linux' | 'darwin' | 'win32'

const llamaExclusions = [
  // Always strip GPU / accelerator variants — they add 600+ MB
  '!node_modules/@node-llama-cpp/*-cuda/**',
  '!node_modules/@node-llama-cpp/*-cuda-ext/**',
  '!node_modules/@node-llama-cpp/*-vulkan/**',
  '!node_modules/@node-llama-cpp/*-metal/**',

  // Strip other platforms' binaries entirely
  ...(platform !== 'linux'
    ? ['!node_modules/@node-llama-cpp/linux-*/**']
    : [
        // On Linux x64, drop ARM variants
        '!node_modules/@node-llama-cpp/linux-arm64/**',
        '!node_modules/@node-llama-cpp/linux-armv7l/**',
      ]),
  ...(platform !== 'darwin' ? ['!node_modules/@node-llama-cpp/mac-*/**'] : []),
  ...(platform !== 'win32' ? ['!node_modules/@node-llama-cpp/win-*/**'] : []),
];

const canvasExclusions = [
  // Keep only the platform-appropriate native variant
  ...(platform === 'linux'
    ? [
        '!node_modules/@napi-rs/canvas-linux-x64-musl/**',
        '!node_modules/@napi-rs/canvas-*-arm*/**',
      ]
    : []),
  ...(platform !== 'linux' ? ['!node_modules/@napi-rs/canvas-linux-*/**'] : []),
  ...(platform !== 'darwin' ? ['!node_modules/@napi-rs/canvas-darwin-*/**'] : []),
  ...(platform !== 'win32' ? ['!node_modules/@napi-rs/canvas-win32-*/**'] : []),
];

// Determine which node-llama-cpp platform package to unpack for native dlopen
const llamaUnpack =
  platform === 'darwin'
    ? 'node_modules/@node-llama-cpp/mac-*/**'
    : platform === 'win32'
      ? 'node_modules/@node-llama-cpp/win-*/**'
      : 'node_modules/@node-llama-cpp/linux-x64/**';

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
    ...llamaExclusions,
    ...canvasExclusions,
  ],

  // Native modules that use dlopen at runtime must live outside the asar archive.
  asarUnpack: ['node_modules/sqlite-vec-*/**', 'node_modules/better-sqlite3/**', llamaUnpack],

  extraResources: [
    {
      from: 'build/icons',
      to: 'icons',
      filter: ['**/*'],
    },
  ],

  // Only ship English locale packs (~39 MB savings from Chromium locales)
  electronLanguages: ['en-US'],

  // Rebuild native modules (node-llama-cpp, better-sqlite3, sqlite-vec) for Electron's ABI
  npmRebuild: true,
  buildDependenciesFromSource: false,

  linux: {
    target: [{ target: 'AppImage' }],
    category: 'Utility',
    icon: 'build/icons/icon.png',
  },

  mac: {
    target: [{ target: 'dmg' }],
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

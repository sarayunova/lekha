// App is tagged with a .mjs extension to allow
import path from 'path';
import { fileURLToPath } from 'url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// const root = path.join(dirname, '..', '..');
const root = dirname; // redundant, but is meant to keep with the previous line
const buildDirPath = path.join(root, 'dist_electron', 'build');
const packageDirPath = path.join(root, 'dist_electron', 'bundled');

const frappeBooksConfig = {
  productName: 'Lekha',
  appId: 'com.liviverse.lekha',
  artifactName: '${productName}-v${version}-${os}-${arch}.${ext}',
  // better-sqlite3 ships prebuilt binaries, so skip rebuilding from source
  npmRebuild: false,
  asarUnpack: '**/*.node',
  extraResources: [
    { from: 'translations', to: '../translations' },
    { from: 'templates', to: '../templates' },
  ],
  files: '**',
  extends: null,
  // Writes app-update.yml and latest.yml; release assets are uploaded with
  // `gh release upload` (see scripts/release.md).
  publish: [
    {
      provider: 'github',
      owner: 'sarayunova',
      repo: 'lekha',
      releaseType: 'release',
    },
  ],
  directories: {
    output: packageDirPath,
    app: buildDirPath,
  },
  mac: {
    type: 'distribution',
    artifactName: '${productName}-v${version}-mac-${arch}.${ext}',
    category: 'public.app-category.finance',
    icon: 'build/icon.icns',
    // electron-builder reads APPLE_TEAM_ID and the Apple credentials from
    // the environment; only notarize when they are provided.
    notarize: Boolean(process.env.APPLE_TEAM_ID),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    darkModeSupport: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  win: {
    artifactName: '${productName}-v${version}-windows-${arch}.${ext}',
    signExts: ['.dll'],
    icon: 'build/icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    artifactName: '${productName}-Setup-v${version}-windows-${arch}.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/installerIcon.ico',
    uninstallerIcon: 'build/uninstallerIcon.ico',
  },
  portable: {
    artifactName: '${productName}-Portable-v${version}-windows-${arch}.${ext}',
  },
  linux: {
    icon: 'build/icons',
    artifactName: '${productName}-v${version}-linux-${arch}.${ext}',
    category: 'Finance',
    target: [
      {
        target: 'deb',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'AppImage',
        arch: ['x64'],
      },
      {
        target: 'rpm',
        arch: ['x64', 'arm64'],
      },
    ],
  },
};

export default frappeBooksConfig;

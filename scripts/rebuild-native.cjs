// scripts/rebuild-native.cjs
// Rebuilds better-sqlite3 for the installed Electron version.
// naudiodon is skipped — it has no prebuilt for Electron 36 and native build
// requires Windows SDK 10.0.26100.0 which is not present on this machine.
// Run via npm postinstall.
const { rebuild } = require('@electron/rebuild');
const path = require('path');

rebuild({
  buildPath: path.resolve(__dirname, '..'),
  electronVersion: require('electron/package.json').version,
  onlyModules: ['better-sqlite3'],
  force: true,
}).then(() => {
  console.log('Native addons rebuilt successfully.');
}).catch((err) => {
  console.error('Failed to rebuild native addons:', err.message);
  console.error('Run `npm install` again after installing the Windows SDK if needed.');
  process.exit(1);
});

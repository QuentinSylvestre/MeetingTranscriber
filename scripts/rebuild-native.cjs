// scripts/rebuild-native.js
// Rebuilds naudiodon and better-sqlite3 native addons for the installed Electron version.
// Run via npm postinstall. Using programmatic API to avoid shell quoting issues on Windows.
const { rebuild } = require('@electron/rebuild');
const path = require('path');

rebuild({
  buildPath: path.resolve(__dirname, '..'),
  electronVersion: require('electron/package.json').version,
  onlyModules: ['naudiodon', 'better-sqlite3'],
  force: true,
}).then(() => {
  console.log('Native addons rebuilt successfully.');
}).catch((err) => {
  console.error('Failed to rebuild native addons:', err.message);
  // Do NOT throw — postinstall failure blocks npm install entirely.
  // The verify-abi.ts script will catch this at spike time.
  process.exit(0);
});

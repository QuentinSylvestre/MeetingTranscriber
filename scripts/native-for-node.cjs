// scripts/native-for-node.cjs
// Counterpart to rebuild-native.cjs, which builds better-sqlite3 for Electron.
//
// The two targets are mutually exclusive: packaging and `npm run dev` need the Electron
// build, the test runner needs the Node build. Anything that triggers postinstall leaves
// the addon pointed at Electron, and the database tests then cannot load it. Run via
// npm pretest so `npm test` repairs it instead of asking anyone to remember.
const { execFileSync } = require('child_process');
const path = require('path');

const ADDON = path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

function loadsUnderCurrentNode() {
  try {
    process.dlopen({ exports: {} }, ADDON);
    return true;
  } catch {
    return false;
  }
}

if (loadsUnderCurrentNode()) process.exit(0);

console.log('better-sqlite3 is not built for this Node version; rebuilding so the database tests can run…');
try {
  // Scripts must run: better-sqlite3's own install script is what invokes node-gyp,
  // so --ignore-scripts would report success without building anything. `npm rebuild`
  // runs lifecycle scripts for the named package only, not the root postinstall, so
  // this cannot bounce the addon back to the Electron target.
  execFileSync('npm', ['rebuild', 'better-sqlite3', '--prefer-offline'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
} catch (error) {
  console.error('Rebuild failed:', error.message);
  process.exit(1);
}

if (!loadsUnderCurrentNode()) {
  console.error('better-sqlite3 still will not load under Node after rebuilding.');
  console.error('Run `npm rebuild better-sqlite3 --prefer-offline` by hand to see the build output.');
  process.exit(1);
}
console.log('better-sqlite3 rebuilt for Node.');

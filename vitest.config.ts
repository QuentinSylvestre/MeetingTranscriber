import { defineConfig } from 'vitest/config';
import { existsSync } from 'fs';
import { join } from 'path';

// If the better-sqlite3 native binary was built for Electron (ABI 135) rather
// than the current Node version, the DB test suite will crash at import.
// Detect this by checking the binary's module version header.
function sqliteBuiltForCurrentNode(): boolean {
  const nodePath = join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (!existsSync(nodePath)) return false;
  try {
    // readFileSync the first 64 bytes and check the NODE_MODULE_VERSION
    const { readFileSync } = require('fs');
    const buf: Buffer = readFileSync(nodePath);
    // NODE_MODULE_VERSION is at offset 0x28 in the PE header for .node files
    // Simpler: just try to dlopen it
    process.dlopen({ exports: {} } as NodeModule, require.resolve('./node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
    return true;
  } catch {
    return false;
  }
}

const includeDb = sqliteBuiltForCurrentNode();

export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      ...(includeDb ? [] : ['tests/unit/db.test.ts']),
    ],
  },
});

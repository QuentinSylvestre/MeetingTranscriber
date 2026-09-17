import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';

// better-sqlite3 can only be built for one target at a time: Electron for packaging and
// `npm run dev`, Node for the test runner. This used to drop tests/unit/db.test.ts from
// the run when the addon was built for Electron, which meant the suite quietly shrank
// from 16 files to 15 with everything still green — a dropped suite that looked like a
// passing one. Fail loudly instead; `npm test` runs scripts/native-for-node.cjs first
// and repairs the addon, so reaching this error means that step was bypassed.
function assertSqliteBuiltForCurrentNode(): void {
  const require = createRequire(import.meta.url);
  try {
    process.dlopen({ exports: {} } as NodeModule,
      require.resolve('better-sqlite3/build/Release/better_sqlite3.node'));
  } catch {
    throw new Error(
      'better-sqlite3 is not built for this Node version, so the database tests cannot load it.\n' +
      'Run `npm test`, which repairs this automatically, or `npm rebuild better-sqlite3 --prefer-offline`.',
    );
  }
}

assertSqliteBuiltForCurrentNode();

export default defineConfig({
  test: {
    exclude: ['node_modules/**'],
  },
});

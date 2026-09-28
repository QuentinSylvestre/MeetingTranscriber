// The real-meeting golden summary test lives in the private sibling repo; see AGENTS.md
// "Test Execution". This stub runs it when that repo is found and shows a visible skip
// otherwise. A private module that exists but fails to load must fail this file, so the
// import is deliberately not wrapped in try/catch.
import { describe, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { privateDir, privateModulePath } from '../../scripts/private-fixtures.cjs';

const dir = privateDir();
if (dir) {
  await import(pathToFileURL(privateModulePath(dir)).href);
} else {
  describe.skip('golden municipal summary (private repo not found)', () => {
    it('requires the private fixture repo', () => {});
  });
}

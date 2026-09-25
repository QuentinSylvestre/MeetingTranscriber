import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateDir } from '../../scripts/private-fixtures.cjs';

// Covers only the MT_PRIVATE_FIXTURES branch. The unset branch depends on whether this
// machine has the sibling private repo, so it is exercised by the golden stub instead.
const ENV = 'MT_PRIVATE_FIXTURES';

describe('privateDir with MT_PRIVATE_FIXTURES set', () => {
  let saved: string | undefined;
  const temps: string[] = [];
  const makeTemp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-private-'));
    temps.push(dir);
    return dir;
  };
  const errorOf = (fn: () => unknown): Error => {
    try { fn(); } catch (error) { return error as Error; }
    throw new Error('expected privateDir() to throw');
  };

  beforeEach(() => { saved = process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved;
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when the variable is set but empty, naming the variable', () => {
    process.env[ENV] = '';
    expect(errorOf(privateDir).message).toContain(ENV);
  });

  it('throws without echoing the path when the directory lacks the private module', () => {
    const dir = makeTemp();
    process.env[ENV] = dir;
    const error = errorOf(privateDir);
    expect(error.message).toContain(ENV);
    expect(error.message).not.toContain(dir);
    expect(error.message).not.toContain(fs.realpathSync.native(dir));
  });

  it('throws when the directory lies inside the public repo', () => {
    process.env[ENV] = 'tests';
    const error = errorOf(privateDir);
    expect(error.message).toMatch(/inside the public repo/);
    expect(error.message).not.toContain(path.resolve(fileURLToPath(new URL('../..', import.meta.url))));
  });

  it('returns the directory when it holds the private module', () => {
    const dir = makeTemp();
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'tests', 'summary-golden.private.ts'), '');
    process.env[ENV] = dir;
    const result = privateDir();
    expect(result).not.toBeNull();
    expect(fs.realpathSync.native(result as string)).toBe(fs.realpathSync.native(dir));
  });
});

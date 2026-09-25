/**
 * Locates the private fixture repo that holds the real-meeting golden test and its data.
 *
 * - MT_PRIVATE_FIXTURES set (even to an empty string): that directory. A relative value is
 *   resolved against this repo's root, not the current directory. It must contain the
 *   private test module and must lie outside this repo (compared by real path, so
 *   junctions and short names cannot bypass the check). Anything else throws: an explicit
 *   opt-in that points at nothing usable is a configuration error, not a reason to skip.
 * - Unset: the sibling folder ../meeting_transcriber-private. Absent gives null (the golden
 *   test is skipped); present but missing the private test module throws, so a partial
 *   clone fails loudly.
 *
 * Error messages never echo a resolved path.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_ROOT = path.resolve(__dirname, '..');
const ENV = 'MT_PRIVATE_FIXTURES';
const MODULE = path.join('tests', 'summary-golden.private.ts');
const MODULE_LABEL = 'tests/summary-golden.private.ts';

function real(p) {
  return fs.existsSync(p) ? fs.realpathSync.native(p) : p;
}

function isInside(parent, child) {
  const rel = path.relative(real(parent), real(child));
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  return !outside;
}

function privateDir() {
  const value = process.env[ENV];
  if (value !== undefined) {
    if (value === '') throw new Error(`${ENV} is set but empty; unset it or point it at the private repo.`);
    const dir = path.resolve(PUBLIC_ROOT, value);
    if (isInside(PUBLIC_ROOT, dir)) {
      throw new Error(`${ENV} points inside the public repo; clone the private repo elsewhere.`);
    }
    if (!fs.existsSync(path.join(dir, MODULE))) {
      throw new Error(`${ENV} is set but the directory it names has no ${MODULE_LABEL}.`);
    }
    return dir;
  }
  const sibling = path.resolve(PUBLIC_ROOT, '..', 'meeting_transcriber-private');
  if (!fs.existsSync(sibling) || !fs.statSync(sibling).isDirectory()) return null;
  if (!fs.existsSync(path.join(sibling, MODULE))) {
    throw new Error(`Sibling private repo found but incomplete: it has no ${MODULE_LABEL}.`);
  }
  return sibling;
}

module.exports = { privateDir };

/**
 * Locates the private fixture repo that holds the real-meeting golden test and its data.
 *
 * - MT_PRIVATE_FIXTURES set: that directory, which must contain the private test module
 *   and must lie outside this repo. Anything else throws: an explicit opt-in that points at
 *   nothing usable is a configuration error, not a reason to skip.
 * - Unset: the sibling folder ../meeting_transcriber-private if it exists, else null.
 *
 * Error messages never echo the resolved path.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_ROOT = path.resolve(__dirname, '..');
const ENV = 'MT_PRIVATE_FIXTURES';
const MODULE = path.join('tests', 'summary-golden.private.ts');

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function privateDir() {
  const value = process.env[ENV];
  if (value) {
    const dir = path.resolve(value);
    if (isInside(PUBLIC_ROOT, dir)) {
      throw new Error(`${ENV} points inside the public repo; clone the private repo elsewhere.`);
    }
    if (!fs.existsSync(path.join(dir, MODULE))) {
      throw new Error(`${ENV} is set but the directory it names has no ${MODULE.split(path.sep).join('/')}.`);
    }
    return dir;
  }
  const sibling = path.resolve(PUBLIC_ROOT, '..', 'meeting_transcriber-private');
  return fs.existsSync(sibling) && fs.statSync(sibling).isDirectory() ? sibling : null;
}

module.exports = { privateDir };

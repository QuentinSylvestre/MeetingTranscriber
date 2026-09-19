// scripts/finalize-github-release.cjs
//
// Repairs a known electron-builder race (still present as of 26.16.1, the newest
// stable release — fixed only in the unreleased 27.0.0-alpha line): PublishManager
// caches its GitHubPublisher per publish-config key, but populates that cache after
// an await, not before. When the installer and its .blockmap finish building close
// together, both artifact-upload tasks can see an empty cache and each independently
// create its own GitHub release for the same tag, splitting assets across duplicates.
//
// Run this after `electron-builder --publish always`: it finds every release for the
// tag just pushed, keeps the one with the complete asset set (installer + .blockmap +
// latest.yml — falling back to whichever has the most assets if none is complete),
// deletes any duplicates, and publishes the keeper (draft -> false) so releases/latest
// and electron-updater see it.
const https = require('https');

const TAG = process.env.GITHUB_REF_NAME;
const REPO = process.env.GITHUB_REPOSITORY; // "owner/repo"
const TOKEN = process.env.GH_TOKEN;
const EXPECTED_ASSET_SUFFIXES = ['.exe', '.exe.blockmap', 'latest.yml'];

if (!TAG || !REPO || !TOKEN) {
  console.error('finalize-github-release: missing GITHUB_REF_NAME, GITHUB_REPOSITORY, or GH_TOKEN');
  process.exit(1);
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          'User-Agent': 'meeting-transcriber-release-script',
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`${method} ${path} -> HTTP ${res.statusCode}: ${out}`));
            return;
          }
          resolve(out ? JSON.parse(out) : null);
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function isComplete(release) {
  const names = release.assets.map((a) => a.name);
  return EXPECTED_ASSET_SUFFIXES.every((suffix) => names.some((n) => n.endsWith(suffix)));
}

function describe(release) {
  const names = release.assets.map((a) => a.name);
  return `${release.id} (${names.length ? names.join(', ') : 'no assets'})`;
}

(async () => {
  const releases = await api('GET', `/repos/${REPO}/releases?per_page=50`);
  const matches = releases.filter((r) => r.tag_name === TAG);

  if (matches.length === 0) {
    console.error(`finalize-github-release: no release found for tag ${TAG}`);
    process.exit(1);
  }

  const complete = matches.filter(isComplete);
  const ranked = (complete.length > 0 ? complete : matches)
    .slice()
    .sort((a, b) => b.assets.length - a.assets.length);
  const keeper = ranked[0];
  const duplicates = matches.filter((r) => r.id !== keeper.id);

  if (duplicates.length > 0) {
    console.log(`finalize-github-release: ${matches.length} releases found for tag ${TAG} — keeping ${describe(keeper)}`);
  }
  for (const dup of duplicates) {
    console.log(`finalize-github-release: deleting duplicate release ${describe(dup)}`);
    await api('DELETE', `/repos/${REPO}/releases/${dup.id}`);
  }

  if (!isComplete(keeper)) {
    console.error(
      `finalize-github-release: kept release ${keeper.id} is missing expected assets ` +
      `(has: ${keeper.assets.map((a) => a.name).join(', ') || 'none'}, expected one of each suffix: ${EXPECTED_ASSET_SUFFIXES.join(', ')}) ` +
      '— publishing it anyway, but check it manually.'
    );
  }

  if (keeper.draft) {
    console.log(`finalize-github-release: publishing release ${keeper.id}`);
    await api('PATCH', `/repos/${REPO}/releases/${keeper.id}`, { draft: false });
  } else {
    console.log(`finalize-github-release: release ${keeper.id} already published`);
  }

  console.log(`finalize-github-release: done — https://github.com/${REPO}/releases/tag/${TAG}`);
})().catch((err) => {
  console.error('finalize-github-release failed:', err.message);
  process.exit(1);
});

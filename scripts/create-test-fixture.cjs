// Creates tests/fixtures/10s-silence.mp3 for chunker tests.
// Usage: node scripts/create-test-fixture.cjs
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const fixturesDir = path.join(__dirname, '..', 'tests', 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

const outputPath = path.join(fixturesDir, '10s-silence.mp3');

if (fs.existsSync(outputPath)) {
  console.log('Fixture already exists:', outputPath);
  process.exit(0);
}

let ffmpegPath;
try {
  const ffmpegStatic = require('ffmpeg-static');
  ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic.default;
} catch (err) {
  console.error('ffmpeg-static not found:', err.message);
  process.exit(1);
}

try {
  // Generate 10 seconds of silence: anullsrc (null audio source) at 44100 Hz, mono.
  // shell: false — args passed as array to prevent injection.
  execFileSync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '10',
    '-acodec', 'libmp3lame',
    '-ab', '128k',
    '-y',
    outputPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stat = fs.statSync(outputPath);
  console.log(`Created: ${outputPath} (${stat.size} bytes)`);
} catch (err) {
  console.error('Failed to create fixture:', err.message);
  if (err.stderr) console.error(err.stderr.toString());
  process.exit(1);
}

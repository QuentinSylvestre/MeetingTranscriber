'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const iconsDir = path.join(__dirname, '..', 'build', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const pngPath = path.join(iconsDir, 'icon.png');
const icoPath = path.join(iconsDir, 'icon.ico');

if (!fs.existsSync(pngPath)) {
  // Use ffmpeg-static to generate a 256x256 solid color placeholder icon
  // Color: #1e1e2e (dark catppuccin background)
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic.default;
  try {
    execSync(
      `"${ffmpegPath}" -f lavfi -i color=c=0x1e1e2e:s=256x256:r=1 -vframes 1 -y "${pngPath}"`,
      { stdio: 'pipe' }
    );
    console.log('Created icon.png (256x256 placeholder)');
  } catch (e) {
    console.error('Failed to create icon.png:', e.message);
    process.exit(1);
  }
} else {
  console.log('icon.png already exists, skipping');
}

if (!fs.existsSync(icoPath)) {
  // Generate a proper ICO file using ffmpeg-static.
  // ffmpeg can write .ico directly from a PNG source on Windows.
  const ffmpegStatic = require('ffmpeg-static');
  const ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic.default;
  try {
    execSync(
      `"${ffmpegPath}" -i "${pngPath}" -y "${icoPath}"`,
      { stdio: 'pipe' }
    );
    console.log('Created icon.ico (ICO generated from PNG via ffmpeg)');
  } catch (e) {
    console.error('Failed to create icon.ico via ffmpeg:', e.message);
    process.exit(1);
  }
} else {
  console.log('icon.ico already exists, skipping');
}

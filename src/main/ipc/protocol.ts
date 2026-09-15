import { app, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { getPreference } from '../settings/store';

/**
 * Pure path confinement check, exported for unit testing.
 * Returns true iff filePath is equal to one of the allowedRoots or is
 * directly under one of them (separator-bounded, to prevent prefix spoofing).
 */
export function isPathAllowed(filePath: string, allowedRoots: string[]): boolean {
  // Block UNC paths (\\server\share\... or //server/share/...)
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) return false;
  const normalized = path.normalize(filePath);
  return allowedRoots.some(root =>
    normalized.startsWith(path.normalize(root) + path.sep) ||
    normalized === path.normalize(root)
  );
}

/**
 * Must be called before app.whenReady().
 * Registers 'app' as a standard, secure, streaming scheme so that
 * <audio> and <video> elements can load files via app:// URLs.
 *
 * 'stream' is essential — without it Electron doesn't issue range requests
 * for <audio>/<video>, so duration and seeking never work.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

// MIME types for audio files.
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

/**
 * Core handler for app:// requests — extracted for unit testing.
 * Serves local audio files with manual range-request (HTTP 206) support.
 * net.fetch(file://) does NOT correctly forward range responses in Electron 36
 * (known issue: electron/electron#38749), so we handle byte slicing manually.
 *
 * @param requestUrl  The full app:// URL string.
 * @param rangeHeader Value of the incoming Range header, or null.
 * @param allowedRoots List of absolute directory paths the file must be under.
 */
export function handleAppRequest(
  requestUrl: string,
  rangeHeader: string | null,
  allowedRoots: string[]
): Response {
  log.info(`app:// request: ${requestUrl} range=${rangeHeader ?? 'none'}`);
  const url = new URL(requestUrl);

  // For a 'standard' scheme on Windows, Chromium normalises app:///C:/path to
  // app://c/path — the drive letter becomes the (lowercased) hostname.
  // Reconstruct the full Windows path from hostname + pathname.
  // On Unix the hostname is empty and pathname is the full path.
  const hostname = url.hostname;   // e.g. "c" on Windows, "" on Unix
  const pathname = decodeURIComponent(url.pathname); // e.g. "/Users/foo/file.mp3"

  let filePath: string;
  if (hostname && /^[a-z]$/.test(hostname)) {
    // Windows: hostname is the drive letter, pathname starts with /
    filePath = path.normalize(`${hostname.toUpperCase()}:${pathname}`);
  } else {
    // Unix: empty hostname, pathname is the full path
    filePath = path.normalize(pathname);
  }

  // Block UNC paths.
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    log.warn(`app:// blocked UNC path: ${filePath}`);
    return new Response('Forbidden', { status: 403 });
  }

  if (!isPathAllowed(filePath, allowedRoots)) {
    log.warn(`app:// blocked (not in allowed roots): ${filePath} | roots: ${allowedRoots.join(', ')}`);
    return new Response('Forbidden', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    log.warn(`app:// not found: ${filePath}`);
    return new Response('Not Found', { status: 404 });
  }

  const totalSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = AUDIO_MIME[ext] ?? 'application/octet-stream';

  if (rangeHeader) {
    const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!m) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${totalSize}` },
      });
    }

    // RFC 7233 byte-range forms:
    //   "bytes=start-end"  — both m[1] and m[2] present
    //   "bytes=start-"     — open end: m[1] present, m[2] empty
    //   "bytes=-suffix"    — last N bytes: m[1] empty, m[2] is the suffix length
    const isSuffix = m[1] === '';
    const start = isSuffix
      ? Math.max(0, totalSize - parseInt(m[2], 10))
      : parseInt(m[1], 10);
    const end = (isSuffix || m[2] === '')
      ? totalSize - 1
      : Math.min(parseInt(m[2], 10), totalSize - 1);

    if (start > end || start >= totalSize) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${totalSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const buffer = Buffer.alloc(chunkSize);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, chunkSize, start);
    } finally {
      fs.closeSync(fd);
    }

    log.info(`app:// 206: ${filePath} [${start}-${end}/${totalSize}]`);
    return new Response(buffer, {
      status: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': String(chunkSize),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  log.info(`app:// 200 full: ${filePath} [${totalSize} bytes]`);
  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
    },
  });
}

/**
 * Must be called after app.whenReady().
 * Registers the app:// protocol handler.
 */
export function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const ALLOWED_ROOTS = [
      path.resolve(app.getPath('userData')),
      path.resolve(getPreference('recordingsFolder')),
    ];
    return handleAppRequest(request.url, request.headers.get('Range'), ALLOWED_ROOTS);
  });
}

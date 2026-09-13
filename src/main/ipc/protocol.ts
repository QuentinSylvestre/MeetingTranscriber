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

export function registerAppProtocol(): void {
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = new URL(request.url);
    // Decode and normalize the path
    const rawPath = decodeURIComponent(url.pathname);

    // Block UNC paths before any further processing
    if (rawPath.startsWith('//') || rawPath.startsWith('\\\\')) {
      log.warn(`app:// blocked UNC path: ${rawPath}`);
      return callback({ statusCode: 403 });
    }

    // On Windows, pathname may start with /C:/... — strip leading slash
    const filePath = path.normalize(
      rawPath.startsWith('/') && /^\/[A-Za-z]:/.test(rawPath)
        ? rawPath.slice(1)
        : rawPath
    );

    const ALLOWED_ROOTS = [
      path.resolve(app.getPath('userData')),
      path.resolve(getPreference('recordingsFolder')),
    ];

    if (!isPathAllowed(filePath, ALLOWED_ROOTS)) {
      log.warn(`app:// blocked: ${filePath}`);
      return callback({ statusCode: 403 });
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return callback({ statusCode: 404 });
    }

    callback({ path: filePath });
  });
}

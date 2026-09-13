import { app, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { getPreference } from '../settings/store';

export function registerAppProtocol(): void {
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = new URL(request.url);
    // Decode and normalize the path
    const rawPath = decodeURIComponent(url.pathname);
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

    const isAllowed = ALLOWED_ROOTS.some(root =>
      filePath.startsWith(root + path.sep) || filePath === root
    );

    if (!isAllowed) {
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

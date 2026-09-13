import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(): void {
  if (_db) return; // guard: only initialize once
  const dbPath = path.join(app.getPath('userData'), 'db.sqlite');
  log.info(`Initializing database at: ${dbPath}`);
  _db = new Database(dbPath);
  // WAL mode for concurrent reads + write performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON'); // Enable cascade deletes
  runMigrations(_db);
  log.info('Database initialized');
}

function runMigrations(db: Database.Database): void {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    log.warn(`Migrations directory not found: ${migrationsDir}`);
    return;
  }
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sqlPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    try {
      db.exec(sql);
      log.info(`Migration applied: ${file}`);
    } catch (err) {
      log.error(`Migration failed: ${file}`, err);
      throw err;
    }
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

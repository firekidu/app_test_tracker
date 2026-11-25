import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  row_number INTEGER NOT NULL,
  row_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunks_total INTEGER NOT NULL,
  chunks_received TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  error TEXT,
  media_file_id TEXT,
  uploader_username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  file_id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER, height INTEGER, duration_s REAL,
  caption TEXT,
  uploader_username TEXT, uploader_name TEXT,
  created_at TEXT NOT NULL,
  thumb_file_id TEXT, display_file_id TEXT, preview_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
);
CREATE INDEX IF NOT EXISTS media_row_key ON media(row_key);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_failures (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  username TEXT,
  event TEXT NOT NULL,
  by_username TEXT,
  ip TEXT
);
`;

const g = globalThis as unknown as { __smprdDb?: Database.Database };

export function dataPath(...parts: string[]) {
  return path.resolve(/* turbopackIgnore: true */ config().DATA_DIR, ...parts);
}

export function db(): Database.Database {
  if (!g.__smprdDb) {
    const dir = dataPath();
    for (const sub of ['', 'tmp', 'cache', 'secrets']) fs.mkdirSync(path.join(/* turbopackIgnore: true */ dir, sub), { recursive: true });
    const d = new Database(path.join(/* turbopackIgnore: true */ dir, 'app.db'));
    d.pragma('journal_mode = WAL');
    d.pragma('busy_timeout = 5000');
    d.exec(APP_SCHEMA);
    g.__smprdDb = d;
  }
  return g.__smprdDb;
}

export function getSetting(key: string): string | undefined {
  const r = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}
export function setSetting(key: string, value: string) {
  db().prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function deleteSetting(key: string) {
  db().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function nowIso() {
  return new Date().toISOString();
}

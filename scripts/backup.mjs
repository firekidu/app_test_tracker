#!/usr/bin/env node
// Daily backup of /data (BUILD.md §13.10): a consistent SQLite snapshot (accounts, sessions,
// media index) plus the encrypted Google token. Keeps the newest 14.
// Usage inside the container:  node scripts/backup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || '/data';
const outDir = path.join(dataDir, 'backups');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const dbFile = path.join(outDir, `app-${stamp}.db`);

const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
await db.backup(dbFile);
db.close();
const tok = path.join(dataDir, 'secrets', 'google.json.enc');
if (fs.existsSync(tok)) fs.copyFileSync(tok, path.join(outDir, `google-${stamp}.json.enc`));

const keep = 14;
for (const prefix of ['app-', 'google-']) {
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(prefix)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(outDir, f));
}
console.log(`Backup written: ${dbFile}`);

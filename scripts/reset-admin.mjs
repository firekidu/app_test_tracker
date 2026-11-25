#!/usr/bin/env node
// Emergency reset for a locked-out admin (BUILD.md §17).
// Usage inside the container:  node scripts/reset-admin.mjs <username>
// Prints a new temporary password, unlocks the account, re-enables it, makes it an admin
// and signs it out everywhere. The user must change the password at the next sign-in.
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const username = String(process.argv[2] ?? '').trim().toLowerCase();
const dbPath = path.join(process.env.DATA_DIR || '/data', 'app.db');
const db = new Database(dbPath);
if (!username) {
  console.log('Usage: node scripts/reset-admin.mjs <username>\n\nAccounts:');
  for (const u of db.prepare('SELECT username, role, banned FROM "user" ORDER BY role, username').all())
    console.log(`  ${u.username}  (${u.role}${u.banned ? ', disabled' : ''})`);
  process.exit(2);
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
let pw = '';
while (pw.length < 20) {
  const b = crypto.randomBytes(1)[0];
  if (b < 256 - (256 % alphabet.length)) pw += alphabet[b % alphabet.length];
}
// Same scrypt format as Better Auth: "<salt hex>:<key hex>", N=16384, r=16, p=1, dkLen=64.
const salt = crypto.randomBytes(16).toString('hex');
const key = crypto.scryptSync(pw.normalize('NFKC'), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 });
const hash = `${salt}:${key.toString('hex')}`;

const user = db.prepare('SELECT id, role FROM "user" WHERE username = ?').get(username);
if (!user) {
  console.error(`No user "${username}" in ${dbPath}.`);
  process.exit(1);
}
const now = new Date().toISOString();
db.transaction(() => {
  const acc = db.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'").get(user.id);
  if (acc) db.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ?').run(hash, now, acc.id);
  else
    db.prepare("INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, ?, ?)").run(
      crypto.randomUUID(),
      user.id,
      user.id,
      hash,
      now,
      now,
    );
  db.prepare("UPDATE \"user\" SET role = 'admin', banned = 0, banReason = NULL, must_change_password = 1 WHERE id = ?").run(user.id);
  db.prepare('DELETE FROM session WHERE userId = ?').run(user.id);
  db.prepare('DELETE FROM login_failures WHERE username = ?').run(username);
  db.prepare("INSERT INTO auth_events(at, username, event, by_username, ip) VALUES (?, ?, 'password_reset_by_admin', 'reset-admin script', NULL)").run(now, username);
})();
console.log(`New temporary password for ${username}: ${pw}`);
console.log('Sign in with it and choose a new password.');

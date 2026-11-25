import { config } from './config';
import { db, nowIso } from './db';

export function logAuthEvent(event: string, username: string | null, by: string | null = null, ip: string | null = null) {
  db().prepare('INSERT INTO auth_events(at, username, event, by_username, ip) VALUES (?, ?, ?, ?, ?)').run(nowIso(), username, event, by, ip);
}

interface Row {
  username: string;
  failures: number;
  first_failure_at: string | null;
  locked_until: string | null;
}

export function lockState(username: string, now = Date.now()): { locked: boolean; until: string | null } {
  const r = db().prepare('SELECT * FROM login_failures WHERE username = ?').get(username) as Row | undefined;
  if (r?.locked_until && Date.parse(r.locked_until) > now) return { locked: true, until: r.locked_until };
  return { locked: false, until: null };
}

/** Records a failed attempt. Returns true if this failure locked the account. */
export function recordFailure(username: string, now = Date.now()): boolean {
  const c = config();
  const windowMs = c.LOCKOUT_MINUTES * 60_000;
  const r = db().prepare('SELECT * FROM login_failures WHERE username = ?').get(username) as Row | undefined;
  let failures = 1;
  let first = new Date(now).toISOString();
  if (r && r.first_failure_at && now - Date.parse(r.first_failure_at) <= windowMs && !(r.locked_until && Date.parse(r.locked_until) <= now)) {
    failures = r.failures + 1;
    first = r.first_failure_at;
  }
  const lock = failures >= c.LOCKOUT_ATTEMPTS;
  db()
    .prepare(
      `INSERT INTO login_failures(username, failures, first_failure_at, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_failure_at = excluded.first_failure_at, locked_until = excluded.locked_until`,
    )
    .run(username, failures, first, lock ? new Date(now + windowMs).toISOString() : null);
  return lock;
}

export function clearFailures(username: string) {
  db().prepare('DELETE FROM login_failures WHERE username = ?').run(username);
}

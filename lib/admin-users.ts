import { db } from './db';
import { lockState } from './lockout';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  personName: string;
  role: string;
  status: 'active' | 'locked' | 'disabled';
  mustChangePassword: boolean;
  lastSignIn: string | null;
  createdAt: string;
}

export function listUsers(): UserRow[] {
  const rows = db()
    .prepare('SELECT id, username, name, person_name, role, banned, must_change_password, createdAt FROM "user" ORDER BY username')
    .all() as { id: string; username: string; name: string; person_name: string | null; role: string | null; banned: number | null; must_change_password: number | null; createdAt: string | number }[];
  const last = new Map(
    (db().prepare("SELECT username, MAX(at) AS at FROM auth_events WHERE event = 'sign_in_ok' GROUP BY username").all() as { username: string; at: string }[]).map((r) => [r.username, r.at]),
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.name,
    personName: r.person_name ?? '',
    role: r.role ?? 'viewer',
    status: r.banned ? 'disabled' : lockState(r.username).locked ? 'locked' : 'active',
    mustChangePassword: !!r.must_change_password,
    lastSignIn: last.get(r.username) ?? null,
    createdAt: typeof r.createdAt === 'number' ? new Date(r.createdAt).toISOString() : String(r.createdAt),
  }));
}

export function activeAdminCount(exceptId?: string): number {
  const r = db()
    .prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role = 'admin' AND (banned IS NULL OR banned = 0) AND id != ?`)
    .get(exceptId ?? '') as { n: number };
  return r.n;
}

export function userById(id: string) {
  return db().prepare('SELECT id, username, name, role, banned FROM "user" WHERE id = ?').get(id) as
    | { id: string; username: string; name: string; role: string; banned: number | null }
    | undefined;
}

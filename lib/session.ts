import { headers as nextHeaders } from 'next/headers';
import { auth, authReady, revokeAllSessions } from './auth';
import { config } from './config';
import type { Role } from './types';

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  personName: string;
  role: Role;
  mustChangePassword: boolean;
  sessionToken: string;
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };
export const hasRole = (u: { role: Role }, min: Role) => (RANK[u.role] ?? 0) >= RANK[min];

export async function getUser(h?: Headers): Promise<AppUser | null> {
  await authReady();
  const hdrs = h ?? (await nextHeaders());
  const s = await auth().api.getSession({ headers: hdrs });
  if (!s) return null;
  const u = s.user as typeof s.user & {
    username?: string;
    role?: string;
    banned?: boolean;
    personName?: string;
    mustChangePassword?: boolean;
  };
  if (u.banned) {
    await revokeAllSessions(u.id);
    return null;
  }
  const maxMs = config().SESSION_MAX_DAYS * 86400_000;
  if (Date.now() - new Date(s.session.createdAt).getTime() > maxMs) {
    try {
      const ctx = await auth().$context;
      await ctx.internalAdapter.deleteSession(s.session.token);
    } catch {}
    return null;
  }
  const role = (['admin', 'editor', 'viewer'].includes(u.role ?? '') ? u.role : 'viewer') as Role;
  return {
    id: u.id,
    username: u.username ?? '',
    displayName: u.name,
    personName: u.personName ?? '',
    role,
    mustChangePassword: !!u.mustChangePassword,
    sessionToken: s.session.token,
  };
}

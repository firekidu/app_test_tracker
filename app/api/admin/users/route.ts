import { z } from 'zod';
import { json, jsonError, parseBody, withUser } from '@/lib/api';
import { listUsers } from '@/lib/admin-users';
import { USERNAME_RE, createAccount, normalizeUsername } from '@/lib/auth';
import { randomPassword } from '@/lib/crypto';
import { db } from '@/lib/db';
import { logAuthEvent } from '@/lib/lockout';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withUser(req, 'admin', async () => json(listUsers()));
}

const Body = z.object({
  username: z.string().max(60),
  displayName: z.string().trim().min(1, 'Enter a display name.').max(60),
  personName: z.string().max(80).default(''),
  role: z.enum(['admin', 'editor', 'viewer']),
});

export async function POST(req: Request) {
  return withUser(req, 'admin', async (admin) => {
    const b = await parseBody(req, Body);
    const username = normalizeUsername(b.username);
    if (!USERNAME_RE.test(username)) return jsonError(422, 'Usernames are 3–30 characters: letters, digits, ".", "-" and "_".');
    if (db().prepare('SELECT 1 FROM "user" WHERE username = ?').get(username)) return jsonError(409, 'That username is taken.');
    const temporaryPassword = randomPassword(20);
    const user = await createAccount({ username, displayName: b.displayName, personName: b.personName.trim(), role: b.role, password: temporaryPassword, mustChangePassword: true });
    logAuthEvent('account_created', username, admin.username);
    return json({ user: { id: user.id, username }, temporaryPassword }, 201);
  });
}

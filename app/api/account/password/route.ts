import { z } from 'zod';
import { json, jsonError, parseBody, withUser } from '@/lib/api';
import { setPassword, verifyPassword } from '@/lib/auth';
import { config } from '@/lib/config';
import { auth } from '@/lib/auth';
import { logAuthEvent } from '@/lib/lockout';
import { checkPassword, isPwned } from '@/lib/password-policy';

export const runtime = 'nodejs';

const Body = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(1000), confirmPassword: z.string().max(1000) });

export async function POST(req: Request) {
  return withUser(
    req,
    'viewer',
    async (u) => {
      const b = await parseBody(req, Body);
      if (b.newPassword !== b.confirmPassword) return jsonError(422, 'The two new passwords are different.');
      if (!(await verifyPassword(u.id, b.currentPassword))) return jsonError(422, 'Your current password is wrong.');
      if (b.newPassword === b.currentPassword) return jsonError(422, 'Choose a password different from the current one.');
      const c = config();
      const problem = checkPassword({ password: b.newPassword, username: u.username, displayName: u.displayName, minLength: c.PASSWORD_MIN_LENGTH });
      if (problem) return jsonError(422, problem);
      if (c.PWNED_CHECK && (await isPwned(b.newPassword))) return jsonError(422, 'That password has appeared in a data breach. Try a few unrelated words.');
      await setPassword(u.id, b.newPassword, false);
      // Sign out every other device.
      const ctx = await auth().$context;
      const sessions = await ctx.internalAdapter.listSessions(u.id);
      const others = sessions.filter((s) => s.token !== u.sessionToken).map((s) => s.token);
      if (others.length) await ctx.internalAdapter.deleteSessions(others);
      logAuthEvent('password_changed', u.username, u.username, req.headers.get('x-forwarded-for')?.split(',')[0] ?? null);
      return json({ ok: true });
    },
    { allowMustChange: true },
  );
}

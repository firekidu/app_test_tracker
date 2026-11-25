import { z } from 'zod';
import { json, jsonError, withUser } from '@/lib/api';
import { activeAdminCount, userById } from '@/lib/admin-users';
import { auth, revokeAllSessions, setPassword } from '@/lib/auth';
import { randomPassword } from '@/lib/crypto';
import { clearFailures, logAuthEvent } from '@/lib/lockout';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  return withUser(req, 'admin', async (admin) => {
    const { id, action } = await ctx.params;
    const target = userById(id);
    if (!target) return jsonError(404, 'User not found.');
    const actx = await auth().$context;
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {}
    switch (action) {
      case 'reset-password': {
        if (id === admin.id) return jsonError(409, 'Use Change password (account menu) for your own account.');
        const temporaryPassword = randomPassword(20);
        await setPassword(id, temporaryPassword, true);
        await revokeAllSessions(id);
        clearFailures(target.username);
        logAuthEvent('password_reset_by_admin', target.username, admin.username);
        return json({ temporaryPassword });
      }
      case 'unlock':
        clearFailures(target.username);
        logAuthEvent('unlocked', target.username, admin.username);
        return json({ ok: true });
      case 'disable':
        if (target.role === 'admin' && activeAdminCount(id) === 0) return jsonError(409, 'The last active admin cannot be disabled.');
        await actx.internalAdapter.updateUser(id, { banned: true, banReason: `Disabled by ${admin.username}` });
        await revokeAllSessions(id);
        logAuthEvent('account_disabled', target.username, admin.username);
        return json({ ok: true });
      case 'enable':
        await actx.internalAdapter.updateUser(id, { banned: false, banReason: null, banExpires: null });
        logAuthEvent('account_enabled', target.username, admin.username);
        return json({ ok: true });
      case 'role': {
        const r = z.enum(['admin', 'editor', 'viewer']).safeParse(body.role);
        if (!r.success) return jsonError(422, 'Choose admin, editor or viewer.');
        if (target.role === 'admin' && r.data !== 'admin' && activeAdminCount(id) === 0) return jsonError(409, 'The last active admin cannot be demoted.');
        await actx.internalAdapter.updateUser(id, { role: r.data });
        logAuthEvent('role_changed', target.username, admin.username);
        return json({ ok: true });
      }
      case 'profile': {
        const p = z.object({ displayName: z.string().trim().min(1).max(60).optional(), personName: z.string().trim().max(80).optional() }).safeParse(body);
        if (!p.success) return jsonError(422, 'Check the display name.');
        await actx.internalAdapter.updateUser(id, { ...(p.data.displayName ? { name: p.data.displayName } : {}), ...(p.data.personName !== undefined ? { personName: p.data.personName } : {}) });
        return json({ ok: true });
      }
      case 'sign-out-all':
        await revokeAllSessions(id);
        logAuthEvent('sign_out_all', target.username, admin.username);
        return json({ ok: true });
      default:
        return jsonError(404, 'Unknown action.');
    }
  });
}

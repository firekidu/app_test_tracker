import { toNextJsHandler } from 'better-auth/next-js';
import { auth, authReady, normalizeUsername } from '@/lib/auth';
import { jsonError } from '@/lib/api';
import { db } from '@/lib/db';
import { clearFailures, lockState, logAuthEvent, recordFailure } from '@/lib/lockout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GET_ALLOWED = new Set(['/get-session', '/ok']);
const POST_ALLOWED = new Set(['/sign-in/username', '/sign-out']);
const WRONG = 'Username or password is wrong.';
const LOCKED = 'Too many attempts. Try again in 15 minutes or ask the admin to unlock you.';

function subPath(req: Request) {
  return new URL(req.url).pathname.replace(/^\/api\/auth/, '') || '/';
}
const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? null;

export async function GET(req: Request) {
  await authReady();
  if (!GET_ALLOWED.has(subPath(req))) return jsonError(404, 'Not found');
  return toNextJsHandler(auth()).GET(req);
}

export async function POST(req: Request) {
  await authReady();
  const p = subPath(req);
  if (!POST_ALLOWED.has(p)) return jsonError(404, 'Not found');
  const handler = toNextJsHandler(auth());
  if (p !== '/sign-in/username') return handler.POST(req);

  let body: { username?: string; password?: string; rememberMe?: boolean };
  try {
    body = await req.clone().json();
  } catch {
    return jsonError(400, WRONG);
  }
  const username = normalizeUsername(body.username ?? '');
  const ip = ipOf(req);
  if (!username || !body.password) return jsonError(401, WRONG);
  if (lockState(username).locked) {
    logAuthEvent('sign_in_failed', username, null, ip);
    return jsonError(423, LOCKED, { locked: true });
  }
  const user = db().prepare('SELECT id, banned FROM "user" WHERE username = ?').get(username) as { id: string; banned: number | null } | undefined;
  if (user?.banned) {
    // Only reveal "disabled" when the password is right, so the message can't be used to probe accounts.
    const { verifyPassword } = await import('@/lib/auth');
    if (await verifyPassword(user.id, body.password)) {
      logAuthEvent('sign_in_failed', username, null, ip);
      return jsonError(403, 'This account is disabled. Ask the admin.', { disabled: true });
    }
  }
  const fwd = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ username, password: body.password, rememberMe: true }),
  });
  const res = await handler.POST(fwd);
  if (res.ok) {
    clearFailures(username);
    logAuthEvent('sign_in_ok', username, null, ip);
    return res;
  }
  if (res.status === 429) return jsonError(429, 'Too many attempts from this network. Wait a minute and try again.');
  if (res.status === 403 && user?.banned) return jsonError(403, 'This account is disabled. Ask the admin.', { disabled: true });
  const locked = recordFailure(username);
  logAuthEvent('sign_in_failed', username, null, ip);
  if (locked) {
    logAuthEvent('locked', username, null, ip);
    return jsonError(423, LOCKED, { locked: true });
  }
  return jsonError(401, WRONG);
}

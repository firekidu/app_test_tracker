import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { GoogleError } from './google/oauth';
import { HttpError } from './sheet-store';
import { getUser, hasRole, type AppUser } from './session';
import type { Role } from './types';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ message, ...extra }, status);
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Handler = (user: AppUser) => Promise<Response>;

/** Authenticate, check role, CSRF-check state-changing requests, and map errors to JSON. */
export async function withUser(req: Request, min: Role, fn: Handler, opts: { allowMustChange?: boolean } = {}): Promise<Response> {
  try {
    const user = await getUser(req.headers);
    if (!user) return jsonError(401, 'Please sign in.');
    if (user.mustChangePassword && !opts.allowMustChange) return jsonError(403, 'Change your password first.', { mustChangePassword: true });
    if (!hasRole(user, min)) return jsonError(403, "You don't have permission to do that.");
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return jsonError(403, 'Request blocked (cross-site).');
    return await fn(user);
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return jsonError(e.status, e.message, e.extra);
  if (e instanceof GoogleError) {
    const status = e.status === 429 ? 503 : e.status >= 500 || e.status === 401 ? 503 : e.status === 404 ? 404 : 502;
    return jsonError(status, e.message, { google: e.reason ?? true });
  }
  console.error('[api] unexpected error:', e);
  return jsonError(500, 'Something went wrong. Try again.');
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Send a JSON body.');
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

export function actorOf(u: AppUser) {
  return { username: u.username, displayName: u.displayName, personName: u.personName, role: u.role };
}

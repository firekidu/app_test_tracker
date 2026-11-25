import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { jsonError, withUser } from '@/lib/api';
import { authUrl, googleConfigured } from '@/lib/google/oauth';
import { config } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withUser(req, 'admin', async () => {
    if (!googleConfigured()) return jsonError(503, 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ENCRYPTION_KEY on the server first.');
    const state = crypto.randomBytes(24).toString('base64url');
    const res = NextResponse.redirect(authUrl(state));
    res.cookies.set('smprd_oauth_state', state, {
      httpOnly: true,
      secure: config().APP_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/admin/google',
      maxAge: 600,
    });
    return res;
  });
}

import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { config } from '@/lib/config';
import { handleCallback } from '@/lib/google/oauth';
import { sync } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withUser(req, 'admin', async () => {
    const base = config().APP_URL.replace(/\/$/, '');
    const url = new URL(req.url);
    const cookie = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith('smprd_oauth_state='))?.split('=')[1];
    const back = (q: string) => {
      const r = NextResponse.redirect(`${base}/admin?${q}`);
      r.cookies.delete({ name: 'smprd_oauth_state', path: '/api/admin/google' });
      return r;
    };
    if (url.searchParams.get('error')) return back(`google=error&message=${encodeURIComponent(url.searchParams.get('error')!)}`);
    const code = url.searchParams.get('code');
    if (!code || !cookie || url.searchParams.get('state') !== cookie) return back('google=error&message=state');
    try {
      await handleCallback(code);
      await sync({ forceChangeLog: true });
      return back('google=connected');
    } catch (e) {
      return back(`google=error&message=${encodeURIComponent((e as Error).message)}`);
    }
  });
}

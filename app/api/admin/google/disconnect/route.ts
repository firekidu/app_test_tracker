import { json, withUser } from '@/lib/api';
import { disconnectGoogle } from '@/lib/google/oauth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withUser(req, 'admin', async () => {
    disconnectGoogle();
    return json({ ok: true });
  });
}

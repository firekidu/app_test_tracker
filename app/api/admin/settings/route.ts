import { z } from 'zod';
import { json, parseBody, withUser } from '@/lib/api';
import { setSetting } from '@/lib/db';
import { touchMedia } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  return withUser(req, 'admin', async () => {
    const b = await parseBody(req, z.object({ stallDays: z.number().int().min(1).max(365) }));
    setSetting('stallDays', String(b.stallDays));
    touchMedia(); // bump version so browsers refresh
    return json({ ok: true });
  });
}

import { json, withUser } from '@/lib/api';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withUser(req, 'admin', async () => json(db().prepare('SELECT * FROM auth_events ORDER BY id DESC LIMIT 200').all()));
}

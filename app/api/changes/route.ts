import { json, withUser } from '@/lib/api';
import { allChanges, snapshot } from '@/lib/sheet-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The whole Change log, newest first (every cell edit with timestamp and user). */
export async function GET(req: Request) {
  return withUser(req, 'viewer', async () => {
    await snapshot();
    return json(allChanges());
  });
}

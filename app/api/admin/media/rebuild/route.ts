import { json, withUser } from '@/lib/api';
import { rebuildMediaIndex } from '@/lib/media-jobs';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withUser(req, 'admin', async () => json(await rebuildMediaIndex()));
}

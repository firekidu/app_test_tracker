import { json, withUser } from '@/lib/api';
import { retryFailedUploads } from '@/lib/media-jobs';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withUser(req, 'admin', async () => json({ retried: retryFailedUploads() }));
}

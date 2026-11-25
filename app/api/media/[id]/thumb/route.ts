import { jsonError, withUser } from '@/lib/api';
import { getMedia, thumbStream } from '@/lib/media-jobs';
import { streamResponse } from '@/lib/serve';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'viewer', async () => {
    const m = getMedia((await ctx.params).id);
    if (!m) return jsonError(404, 'File not found.');
    const s = await thumbStream(m);
    if (!s) return jsonError(404, 'No thumbnail yet.');
    return streamResponse(s, { 'Cache-Control': 'private, max-age=86400' });
  });
}

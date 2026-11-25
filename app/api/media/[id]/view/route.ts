import { jsonError, withUser } from '@/lib/api';
import { getMedia, viewStream } from '@/lib/media-jobs';
import { contentDisposition, streamResponse } from '@/lib/serve';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'viewer', async () => {
    const m = getMedia((await ctx.params).id);
    if (!m) return jsonError(404, 'File not found.');
    const s = await viewStream(m, req.headers.get('range'));
    return streamResponse(s, { 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': contentDisposition(m.name, 'inline') });
  });
}

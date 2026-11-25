import { jsonError, withUser } from '@/lib/api';
import { drive } from '@/lib/google/drive';
import { getMedia } from '@/lib/media-jobs';
import { contentDisposition, streamResponse } from '@/lib/serve';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'viewer', async () => {
    const m = getMedia((await ctx.params).id);
    if (!m) return jsonError(404, 'File not found.');
    const s = await drive().stream(m.file_id, req.headers.get('range'));
    return streamResponse(s, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': contentDisposition(m.name), 'Cache-Control': 'private, no-store' });
  });
}

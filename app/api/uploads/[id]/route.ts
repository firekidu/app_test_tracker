import { json, withUser } from '@/lib/api';
import { getMedia } from '@/lib/media-jobs';
import { HttpError, mediaSummary } from '@/lib/sheet-store';
import { cancelUpload, getUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const { id } = await ctx.params;
    const up = getUpload(id);
    if (!up || (up.uploader_username !== u.username && u.role !== 'admin')) throw new HttpError(404, 'Upload not found.');
    const m = up.media_file_id ? getMedia(up.media_file_id) : undefined;
    return json({
      status: up.status,
      error: up.error ?? undefined,
      received: (JSON.parse(up.chunks_received) as number[]).length,
      chunksTotal: up.chunks_total,
      media: m ? mediaSummary(m as unknown as Parameters<typeof mediaSummary>[0]) : undefined,
    });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const { id } = await ctx.params;
    return json(await cancelUpload(id, u.username, u.role === 'admin'));
  });
}

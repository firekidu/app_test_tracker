import { json, withUser } from '@/lib/api';
import { HttpError } from '@/lib/sheet-store';
import { writeChunk } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const { id, index } = await ctx.params;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new HttpError(400, 'Bad chunk index.');
    const ct = req.headers.get('content-type') ?? '';
    if (!ct.startsWith('application/octet-stream')) throw new HttpError(415, 'Send chunks as application/octet-stream.');
    return json(await writeChunk(id, i, req, u.username, u.role === 'admin'));
  });
}

import { z } from 'zod';
import { json, parseBody, withUser } from '@/lib/api';
import { deleteMedia, getMedia, setCaption } from '@/lib/media-jobs';
import { HttpError, actorLabel } from '@/lib/sheet-store';

export const runtime = 'nodejs';

const Body = z.object({ caption: z.string().max(500) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const m = getMedia((await ctx.params).id);
    if (!m) throw new HttpError(404, 'File not found.');
    const b = await parseBody(req, Body);
    await setCaption(m, b.caption, actorLabel(u));
    return json({ ok: true });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const m = getMedia((await ctx.params).id);
    if (!m) throw new HttpError(404, 'File not found.');
    if (u.role !== 'admin' && m.uploader_username !== u.username) throw new HttpError(403, 'Only the uploader or an admin can delete this file.');
    await deleteMedia(m, actorLabel(u));
    return json({ ok: true });
  });
}

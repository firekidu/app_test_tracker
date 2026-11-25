import { json, withUser } from '@/lib/api';
import { mediaForRowKey, scanRowFolder } from '@/lib/media-jobs';
import { HttpError, snapshot } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  return withUser(req, 'viewer', async () => {
    const n = Number((await ctx.params).n);
    const key = new URL(req.url).searchParams.get('rowKey');
    const snap = await snapshot();
    const row = snap.rows.find((r) => (key ? r.rowKey === key : r.rowNumber === n));
    if (!row) throw new HttpError(404, 'Row not found.');
    const list = mediaForRowKey(row.rowKey);
    if (list.length) return json(list);
    // Nothing indexed locally but column K links a folder: rebuild this row from Drive (BUILD.md 7.3).
    if (row.mediaFolderUrl) return json(await scanRowFolder(row.rowKey, row.mediaFolderUrl).catch(() => row.media));
    return json(row.media);
  });
}

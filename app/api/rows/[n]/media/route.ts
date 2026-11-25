import { json, withUser } from '@/lib/api';
import { mediaForRowKey } from '@/lib/media-jobs';
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
    return json(list.length ? list : row.media);
  });
}

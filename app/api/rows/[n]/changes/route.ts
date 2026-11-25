import { json, withUser } from '@/lib/api';
import { HttpError, changesForKey, snapshot } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  return withUser(req, 'viewer', async () => {
    const n = Number((await ctx.params).n);
    const snap = await snapshot();
    const row = snap.rows.find((r) => r.rowNumber === n);
    if (!row) throw new HttpError(404, 'Row not found.');
    return json(changesForKey(row.rowKey).slice().reverse());
  });
}

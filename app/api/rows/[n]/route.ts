import { z } from 'zod';
import { actorOf, json, parseBody, withUser } from '@/lib/api';
import { HttpError, snapshot, updateRow } from '@/lib/sheet-store';

export const runtime = 'nodejs';

const Body = z.object({
  rowKey: z.string().min(1),
  changes: z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    reporter: z.string().max(120).optional(),
    owner: z.string().max(120).optional(),
    title: z.string().max(5000).optional(),
    reportedDate: z.string().max(20).optional(),
    endDate: z.string().max(20).optional(),
    milestone: z.string().max(500).optional(),
    deliverable: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
  }),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ n: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const n = Number((await ctx.params).n);
    if (!Number.isInteger(n) || n < 2) throw new HttpError(400, 'Bad row number.');
    const b = await parseBody(req, Body);
    const r = await updateRow(n, b.rowKey, b.changes, actorOf(u));
    const snap = await snapshot();
    const row = snap.rows.find((x) => x.rowNumber === r.rowNumber);
    return json({ row, movedFrom: r.movedFrom, changed: r.changed });
  });
}

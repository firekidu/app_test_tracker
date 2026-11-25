import { json, withUser } from '@/lib/api';
import { completeUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withUser(req, 'editor', async (u) => {
    const { id } = await ctx.params;
    return json(await completeUpload(id, u.username, u.role === 'admin'), 202);
  });
}

import { z } from 'zod';
import { actorOf, json, parseBody, withUser } from '@/lib/api';
import { updatePerson } from '@/lib/sheet-store';

export const runtime = 'nodejs';

const Body = z.object({
  newName: z.string().max(80).optional(),
  spellings: z.array(z.string().max(200)).max(50).optional(),
  active: z.boolean().optional(),
  mergeInto: z.string().max(80).optional(),
  updateRows: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ name: string }> }) {
  return withUser(req, 'admin', async (u) => {
    const name = decodeURIComponent((await ctx.params).name);
    const b = await parseBody(req, Body);
    return json({ people: await updatePerson(name, b, actorOf(u)) });
  });
}

import { z } from 'zod';
import { actorOf, json, parseBody, withUser } from '@/lib/api';
import { addRow } from '@/lib/sheet-store';

export const runtime = 'nodejs';

const Body = z.object({
  title: z.string().min(1, 'Describe the bug.').max(5000),
  priority: z.string(),
  status: z.string(),
  reporter: z.string().max(120).default(''),
  owner: z.string().max(120).default(''),
  notes: z.string().max(5000).default(''),
});

export async function POST(req: Request) {
  return withUser(req, 'editor', async (u) => {
    const b = await parseBody(req, Body);
    const r = await addRow(b, actorOf(u));
    return json({ row: r }, 201);
  });
}

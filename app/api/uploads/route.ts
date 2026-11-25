import { z } from 'zod';
import { json, parseBody, withUser } from '@/lib/api';
import { createUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

const Body = z.object({
  row: z.number().int().min(2),
  rowKey: z.string().min(1),
  fileName: z.string().min(1).max(500),
  size: z.number().int().nonnegative(),
  mimeType: z.string().max(100).default(''),
});

export async function POST(req: Request) {
  return withUser(req, 'editor', async (u) => {
    const b = await parseBody(req, Body);
    return json(await createUpload(b, u.username), 201);
  });
}

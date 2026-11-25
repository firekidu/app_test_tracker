import { z } from 'zod';
import { actorOf, json, parseBody, withUser } from '@/lib/api';
import { addPerson, peopleNow, snapshot } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withUser(req, 'viewer', async () => {
    await snapshot();
    return json(peopleNow().map((p) => ({ name: p.name, spellings: p.spellings, active: p.active })));
  });
}

const Body = z.object({ name: z.string().max(80), spellings: z.array(z.string().max(200)).max(20).optional() });

export async function POST(req: Request) {
  return withUser(req, 'editor', async (u) => {
    const b = await parseBody(req, Body);
    const person = await addPerson(b.name, b.spellings ?? [], actorOf(u));
    return json({ person }, 201);
  });
}

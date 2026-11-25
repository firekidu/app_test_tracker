import { json, withUser } from '@/lib/api';
import { runSetupStep, setupChecks } from '@/lib/sheet-store';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  return withUser(req, 'admin', async () => {
    await runSetupStep((await ctx.params).step);
    return json({ checks: await setupChecks() });
  });
}

import fs from 'node:fs';
import { json, withUser } from '@/lib/api';
import { config } from '@/lib/config';
import { dataPath, getSetting } from '@/lib/db';
import { googleConfigured, googleConnected, googleLostError, storedToken } from '@/lib/google/oauth';
import { queueLength } from '@/lib/media-jobs';
import { setupChecks, syncStatus } from '@/lib/sheet-store';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, 'admin', async () => {
    const c = config();
    const t = storedToken();
    let disk: { freeMb: number; totalMb: number } | null = null;
    try {
      const s = fs.statfsSync(dataPath());
      disk = { freeMb: Math.round((s.bavail * s.bsize) / 1048576), totalMb: Math.round((s.blocks * s.bsize) / 1048576) };
    } catch {}
    const checks = await setupChecks().catch((e) => [{ step: 'sheet', label: 'Sheet readable', ok: false, detail: (e as Error).message }]);
    const failedUploads = (db().prepare("SELECT COUNT(*) AS n FROM uploads WHERE status = 'failed'").get() as { n: number }).n;
    return json({
      demo: c.demo,
      google: {
        configured: googleConfigured(),
        connected: c.demo || googleConnected(),
        email: t?.email ?? null,
        scopes: t?.scopes ?? [],
        connectedAt: t?.connectedAt ?? null,
        lostError: googleLostError(),
        redirectUri: `${c.APP_URL.replace(/\/$/, '')}/api/admin/google/callback`,
      },
      checks,
      health: { ...syncStatus(), queue: queueLength(), disk, failedUploads },
      settings: { stallDays: Number(getSetting('stallDays') ?? c.STALL_DAYS) },
      sheetId: c.SHEET_ID,
    });
  });
}

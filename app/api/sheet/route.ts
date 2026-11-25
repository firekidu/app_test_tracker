import { json, withUser } from '@/lib/api';
import { config } from '@/lib/config';
import { googleConnected } from '@/lib/google/oauth';
import { snapshot } from '@/lib/sheet-store';
import type { SheetPayload } from '@/lib/types';
import { getSetting } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, 'viewer', async (u) => {
    const c = config();
    const snap = await snapshot();
    const v = new URL(req.url).searchParams.get('v');
    if (v && v === snap.version) return json({ unchanged: true, version: snap.version, syncedAt: snap.syncedAt, sync: { ok: !snap.error, error: snap.error } });
    const payload: SheetPayload = {
      version: snap.version,
      syncedAt: snap.syncedAt,
      lastActivity: snap.lastActivity,
      rows: snap.rows,
      stats: snap.stats,
      people: snap.people,
      me: { name: u.personName || u.displayName, role: u.role, username: u.username, displayName: u.displayName },
      sync: { ok: !snap.error, error: snap.error, googleConnected: c.standalone || googleConnected(), demo: c.demo, mode: c.mode },
      sheetGid: snap.gids.sheet,
      sheetId: c.SHEET_ID,
      openStatuses: c.openStatuses,
      stallDays: Number(getSetting('stallDays') ?? c.STALL_DAYS),
      maxUploadMb: c.MAX_UPLOAD_MB,
    };
    return json(payload);
  });
}

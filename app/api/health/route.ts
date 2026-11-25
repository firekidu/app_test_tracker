import { googleConnected } from '@/lib/google/oauth';
import { config } from '@/lib/config';
import { syncStatus } from '@/lib/sheet-store';
import { queueLength } from '@/lib/media-jobs';
import { db } from '@/lib/db';

import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

let version: string | undefined;
function appVersion() {
  if (version === undefined) {
    try {
      version = fs.readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), 'RELEASE'), 'utf8').trim();
    } catch {
      version = 'dev';
    }
  }
  return version;
}
export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = true;
  try {
    db().prepare('SELECT 1').get();
  } catch {
    dbOk = false;
  }
  const s = syncStatus();
  return Response.json(
    { ok: dbOk, version: appVersion(), mode: config().mode, google: config().standalone ? 'not used' : googleConnected() ? 'connected' : 'missing', lastSync: s.syncedAt, queue: queueLength() },
    { status: dbOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

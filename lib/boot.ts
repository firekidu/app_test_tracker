import { authReady } from './auth';
import { config } from './config';
import { db } from './db';
import { standaloneSetup, startSyncLoop } from './sheet-store';
import { cleanupUploads, startUploadHousekeeping } from './uploads';

export async function boot() {
  const c = config();
  db();
  await authReady();
  if (c.demo) console.log(`[boot] DEMO mode: in-memory sheet from ${c.DEMO_SHEET_CSV}, local-disk media store.`);
  else if (c.standalone) console.log('[boot] Standalone mode: rows in SQLite, media on the server disk (/data/media). Google is not used.');
  if (c.standalone) await standaloneSetup();
  startSyncLoop();
  startUploadHousekeeping();
  void cleanupUploads().catch(() => undefined);
  if (process.env.NODE_ENV === 'production') {
    if (!c.BETTER_AUTH_SECRET) console.warn('[boot] BETTER_AUTH_SECRET is not set!');
    if (!c.ENCRYPTION_KEY && !c.standalone) console.warn('[boot] ENCRYPTION_KEY is not set; Google cannot be connected.');
  }
}
